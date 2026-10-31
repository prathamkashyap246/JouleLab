"""SQLite access. Writes go through one background thread so the serial
reader and the event loop never block on disk I/O."""
from __future__ import annotations

import json
import logging
import queue
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.database.models import SCHEMA

log = logging.getLogger("joulelab.db")


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, path: str) -> None:
        self.path = path
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(SCHEMA)
        self._q: queue.Queue = queue.Queue(maxsize=10000)
        self.dropped_writes = 0
        self._thread = threading.Thread(target=self._writer, name="db-writer", daemon=True)
        self._thread.start()

    # ---- low level -------------------------------------------------------
    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, params)

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def _writer(self) -> None:
        while True:
            item = self._q.get()
            try:
                if item is None:
                    return
                sql, rows = item
                with self._lock:
                    try:
                        self._conn.execute("BEGIN")
                        self._conn.executemany(sql, rows)
                        self._conn.execute("COMMIT")
                    except sqlite3.Error:
                        log.exception("database write failed; %d rows not stored", len(rows))
                        if self._conn.in_transaction:
                            self._conn.execute("ROLLBACK")
            finally:
                self._q.task_done()

    def enqueue(self, sql: str, rows: list[tuple]) -> None:
        try:
            self._q.put_nowait((sql, rows))
        except queue.Full:
            self.dropped_writes += len(rows)
            log.error("database write queue full; %d rows not stored", len(rows))

    def flush(self) -> None:
        """Block until every queued write has been committed."""
        self._q.join()

    def close(self) -> None:
        self.flush()
        self._q.put(None)
        self._thread.join(timeout=5)
        with self._lock:
            self._conn.close()

    # ---- sessions --------------------------------------------------------
    def mark_interrupted(self) -> int:
        cur = self.execute("UPDATE sessions SET status='interrupted', ended_at=? WHERE status='active'", (utcnow(),))
        return cur.rowcount

    def create_session(self, name: str, notes: str | None, port: str | None, source: str,
                       period_us: int | None, decimation: int) -> dict:
        cur = self.execute(
            "INSERT INTO sessions(name, notes, status, started_at, port, source, sample_period_us, store_decimation)"
            " VALUES (?,?,?,?,?,?,?,?)", (name, notes, "active", utcnow(), port, source, period_us, decimation))
        return self.get_session(cur.lastrowid)  # type: ignore[arg-type]

    def finish_session(self, sid: int, status: str, summary: dict, lost: int, packet_errors: int,
                       stored: int, capped: bool) -> None:
        self.flush()
        self.execute("UPDATE sessions SET status=?, ended_at=?, stored_samples=?, storage_capped=? WHERE id=?",
                     (status, utcnow(), stored, int(capped), sid))
        self.execute(
            "INSERT OR REPLACE INTO energy_summaries(session_id, energy_mj, integrated_time_s, missing_time_s,"
            " average_power_mw, average_current_ma, peak_power_mw, peak_current_ma, sample_count, lost_samples,"
            " packet_errors, summary_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (sid, summary["energy_mj"], summary["integrated_time_s"], summary["missing_time_s"],
             summary["average_power_mw"], summary["average_current_ma"], summary["peak_power_mw"],
             summary["peak_current_ma"], summary["sample_count"], lost, packet_errors,
             json.dumps(summary), utcnow()))

    def get_session(self, sid: int) -> dict | None:
        rows = self.query(
            "SELECT s.*, e.energy_mj, e.average_power_mw, e.integrated_time_s, e.missing_time_s, e.lost_samples,"
            " e.packet_errors, e.summary_json FROM sessions s LEFT JOIN energy_summaries e ON e.session_id = s.id"
            " WHERE s.id=?", (sid,))
        if not rows:
            return None
        r = rows[0]
        r["summary"] = json.loads(r.pop("summary_json")) if r.get("summary_json") else None
        return r

    def list_sessions(self, limit: int = 50) -> list[dict]:
        return self.query(
            "SELECT s.id, s.name, s.status, s.started_at, s.ended_at, s.source, s.port, s.sample_period_us,"
            " s.stored_samples, e.energy_mj, e.average_power_mw, e.integrated_time_s, e.lost_samples"
            " FROM sessions s LEFT JOIN energy_summaries e ON e.session_id = s.id ORDER BY s.id DESC LIMIT ?",
            (limit,))

    def session_samples(self, sid: int, limit: int) -> list[dict]:
        return self.query(
            "SELECT sample_index AS \"index\", t_us, voltage_v, current_ma, power_mw, energy_mj,"
            " function_name AS function, n_averaged FROM samples WHERE session_id=? ORDER BY t_us LIMIT ?",
            (sid, limit))

    def session_functions(self, sid: int, limit: int = 1000) -> list[dict]:
        return self.query("SELECT * FROM function_measurements WHERE session_id=? ORDER BY start_us LIMIT ?",
                          (sid, limit))

    def save_report(self, session_id: int | None, board: str, request: dict, report: dict) -> int:
        cur = self.execute(
            "INSERT INTO optimization_reports(session_id, created_at, board, request_json, report_json)"
            " VALUES (?,?,?,?,?)", (session_id, utcnow(), board, json.dumps(request), json.dumps(report)))
        return cur.lastrowid  # type: ignore[return-value]

    def apply_retention(self, days: float) -> int:
        if days <= 0:
            return 0
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        cur = self.execute("DELETE FROM sessions WHERE status != 'active' AND started_at < ?", (cutoff,))
        if cur.rowcount:
            log.info("retention: deleted %d sessions older than %s days", cur.rowcount, days)
        return cur.rowcount


SAMPLE_INSERT = ("INSERT INTO samples(session_id, sample_index, t_us, voltage_v, current_ma, power_mw, energy_mj,"
                 " function_name, n_averaged) VALUES (?,?,?,?,?,?,?,?,?)")
FUNCTION_INSERT = ("INSERT INTO function_measurements(session_id, function_name, source, start_us, end_us,"
                   " duration_us, complete, energy_mj, avg_power_mw, max_power_mw, note)"
                   " VALUES (?,?,?,?,?,?,?,?,?,?,?)")
