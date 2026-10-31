"""Owns the hardware connection: serial reader -> decoder -> sample stream
-> energy engines -> live store / database. Also owns measurement sessions.

Connection states (status()["state"]):
    disconnected      no port open
    waiting_for_data  port open, no valid JouleLab packets (or no HELLO/TIME_SYNC) yet
    streaming         valid measurements received within SERIAL_STALL_TIMEOUT_S  -> connected = True
    stalled           port open, valid data stopped arriving
    reconnecting      the board vanished; retrying automatically
    error             fatal problem (see message)

`connected` is True only in `streaming`: an open port alone is never
reported as a connected board.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime, timezone

import serial

from app.core.config import ALLOWED_BAUDRATES, Settings
from app.database.database import FUNCTION_INSERT, SAMPLE_INSERT, Database
from app.hardware.packet_decoder import PacketDecoder
from app.hardware.sample_stream import RawSample, SampleStream
from app.hardware.serial_reader import (
    SerialReader,
    auto_detect_port,
    list_serial_ports,
    open_port,
    port_exists,
)
from app.services.energy import EnergyEngine, Sample
from app.services.measurement_store import LiveStore
from app.services.serial_monitor import MonitorHub

log = logging.getLogger("joulelab.hardware")


class HardwareError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class _Decimator:
    """Averages N contiguous samples into one stored row (keeps storage bounded)."""

    def __init__(self, session_id: int, n: int, cap: int) -> None:
        self.sid, self.n, self.cap = session_id, n, cap
        self.buf: list[Sample] = []
        self.rows: list[tuple] = []
        self.stored = 0
        self.capped = False

    def add(self, s: Sample) -> None:
        if self.buf and not (s.contiguous and s.index == self.buf[-1].index + 1 and s.epoch == self.buf[-1].epoch):
            self.flush_group()
        self.buf.append(s)
        if len(self.buf) >= self.n:
            self.flush_group()

    def flush_group(self) -> None:
        b = self.buf
        if not b:
            return
        self.buf = []
        if self.stored >= self.cap:
            self.capped = True
            return
        k = len(b)
        self.rows.append((self.sid, b[0].index, round(sum(x.t_us for x in b) / k),
                          sum(x.voltage_v for x in b) / k, sum(x.current_ma for x in b) / k,
                          sum(x.power_mw for x in b) / k, b[-1].energy_mj, b[-1].function, k))
        self.stored += 1

    def take_rows(self) -> list[tuple]:
        r, self.rows = self.rows, []
        return r


class HardwareManager:
    def __init__(self, settings: Settings, db: Database, store: LiveStore,
                 monitor: MonitorHub | None = None) -> None:
        self.settings = settings
        self.db = db
        self.store = store
        self.monitor = monitor or MonitorHub()
        self._suspended: tuple[str, int, str | None] | None = None
        self.other_owner = lambda device: False  # set by LogPort: never open its port twice
        self._lock = threading.RLock()
        self._reader: SerialReader | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self.port: str | None = None
        self.baudrate = settings.serial_baudrate
        self._state = "disconnected"
        self._message = "Not connected. Choose the ST-LINK port and press Connect."
        self._connected_since: str | None = None
        self._last_valid_t = 0.0
        self._last_byte_t = 0.0
        self._ever_streamed = False
        self._rejected = False
        self._new_pipeline()
        self.session: dict | None = None
        self._session_engine: EnergyEngine | None = None
        self._decimator: _Decimator | None = None
        self._session_base: dict = {}

    def _engine(self) -> EnergyEngine:
        return EnergyEngine(self.settings.live_buffer_seconds, self.settings.function_names, self.settings.gpio_names,
                            self.settings.baseline_function)

    def _new_pipeline(self) -> None:
        self.decoder = PacketDecoder(on_discard=self.monitor.push_bytes)
        self.stream = SampleStream()
        self.engine = self._engine()  # scope: since connect
        self.store.clear()

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    # ---- connect / disconnect ----------------------------------------------
    @staticmethod
    def ports() -> list[dict]:
        return [p.public() for p in list_serial_ports()]

    async def connect(self, port: str | None, baudrate: int | None) -> dict:
        if self.settings.hardware_mode == "off":
            raise HardwareError("Hardware is disabled (HARDWARE_MODE=off).", 409)
        baud = baudrate or self.settings.serial_baudrate
        if baud not in ALLOWED_BAUDRATES:
            raise HardwareError(f"Unsupported baud rate {baud}. Use one of {ALLOWED_BAUDRATES}.")
        if self._reader is not None:
            raise HardwareError(f"Already connected to {self.port}. Disconnect first.", 409)
        device = (port or "").strip() or "auto"
        if device == "auto":
            try:
                device = auto_detect_port()
            except ValueError as e:
                raise HardwareError(str(e), 404) from e
        elif not port_exists(device):
            raise HardwareError(f"Serial port {device} was not found. Refresh the list and check the USB cable.", 404)
        if self.other_owner(device):
            raise HardwareError(f"{device} is open as the log port. Close it there first, or pick the other board.", 409)

        try:
            ser = await asyncio.to_thread(open_port, device, baud)
        except serial.SerialException as e:
            with self._lock:
                self._state, self._message = "error", str(e)
            raise HardwareError(str(e), 409) from e

        serial_number = next((p.serial_number for p in list_serial_ports() if p.device == device), None)
        with self._lock:
            self._new_pipeline()
            self._connected_since = datetime.now(timezone.utc).isoformat()
            self._suspended = None
            self._start_reader(ser, device, baud, serial_number)
        log.info("opened %s at %d baud", device, baud)
        self.monitor.push_line(f"Opened {device} at {baud} baud (8N1)")
        return self.status()

    def _start_reader(self, ser, device: str, baud: int, serial_number: str | None) -> None:
        """Call with the lock held."""
        self.port, self.baudrate = device, baud
        self._state = "waiting_for_data"
        self._message = f"Port {device} opened at {baud} 8N1. Waiting for JouleLab packets…"
        self._last_valid_t = 0.0
        self._last_byte_t = 0.0
        self._ever_streamed = False
        self._rejected = False
        self._serial_number = serial_number
        self._reader = SerialReader(ser, baud, serial_number, self._on_bytes, self._on_reader_state,
                                    self.settings.auto_reconnect)
        self._reader.start()

    # ---- lending the port to a firmware upload (ESP32 / Uno upload over the same USB serial) ----
    async def send(self, text: str, line_ending: str = "\n") -> dict:
        """Type into the board from the web terminal, through the one shared connection."""
        reader = self._reader
        if reader is None:
            raise HardwareError("The serial monitor is not connected. Press Serial monitor (or Run) first.", 409)
        data = (text + line_ending).encode("utf-8")
        try:
            n = await asyncio.to_thread(reader.write, data)
        except (serial.SerialException, OSError) as e:
            raise HardwareError(f"Could not send to {self.port}: {e}", 409) from e
        self.monitor.push_line(f"sent: {text!r}")
        return {"sent_bytes": n, "port": self.port}

    def holds_port(self, device: str) -> bool:
        return self._reader is not None and self.port == device

    async def suspend(self, reason: str) -> bool:
        """Close the port but keep the session and totals, so another tool (the uploader) can use it."""
        reader = self._reader
        if reader is None:
            return False
        await asyncio.to_thread(reader.stop)
        with self._lock:
            self._reader = None
            self._suspended = (self.port, self.baudrate, getattr(self, "_serial_number", None))  # type: ignore[assignment]
            self._state, self._message = "paused", reason
        self.monitor.push_line(reason)
        log.info("serial port %s released: %s", self.port, reason)
        return True

    async def resume(self, timeout_s: float = 15.0) -> dict:
        """Reopen the port released by suspend(). The board usually resets after an upload."""
        if not self._suspended:
            return self.status()
        device, baud, serial_number = self._suspended
        deadline = asyncio.get_running_loop().time() + timeout_s
        last_err = "port not present"
        ser = None
        while asyncio.get_running_loop().time() < deadline and self._suspended:
            if port_exists(device):
                try:
                    ser = await asyncio.to_thread(open_port, device, baud)
                    break
                except serial.SerialException as e:
                    last_err = str(e)
            await asyncio.sleep(0.5)
        with self._lock:
            if not self._suspended:  # user pressed Disconnect meanwhile
                if ser is not None:
                    ser.close()
                return self.status()
            self._suspended = None
            if ser is None:
                self._state = "error"
                self._message = f"Could not reopen {device} after the upload: {last_err}"
                self.monitor.push_line(self._message)
                return self.status()
            # new board run: require fresh HELLO + TIME_SYNC, never integrate across the gap
            self.decoder.reset()
            self.stream = SampleStream()
            self.stream.epoch = (self.engine.last.epoch + 1) if self.engine.last else 0
            self._start_reader(ser, device, baud, serial_number)
        self.monitor.push_line(f"Reopened {device} after upload")
        return self.status()

    async def disconnect(self, reason: str | None = None) -> dict:
        reader = self._reader
        if reader is not None:
            await asyncio.to_thread(reader.stop)
        with self._lock:
            self._reader = None
            self._suspended = None
            if self.session:
                self._finish_session("completed")
            if self._state != "error" or reason is None:
                self._state = "disconnected" if reason is None else "error"
            self._message = reason or "Disconnected."
            log.info("disconnected from %s (%s)", self.port, self._message)
        self.monitor.push_line(f"Disconnected from {self.port}: {self._message}")
        return self.status()

    def _on_reader_state(self, kind: str, message: str) -> None:
        with self._lock:
            self.monitor.push_line(message)
            if kind == "reconnecting":
                self._state, self._message = "reconnecting", message
                self.store.push_event({"type": "connection", "state": "reconnecting", "message": message})
            elif kind == "reconnected":
                # the board may have reset: require a fresh HELLO + TIME_SYNC before trusting data
                self.decoder.reset()
                self.stream = SampleStream()
                self.stream.epoch = (self.engine.last.epoch + 1) if self.engine.last else 0
                self._state, self._message = "waiting_for_data", message
                self.store.push_event({"type": "connection", "state": "reconnected", "message": message})
            elif kind == "error":
                self._state, self._message = "error", message
                self._reader = None

    # ---- data path (runs in the serial thread) ------------------------------
    def _on_bytes(self, data: bytes) -> None:
        abort: str | None = None
        with self._lock:
            if self._rejected:
                return  # source refused (e.g. test packets): nothing from it may reach the UI
            self._last_byte_t = time.monotonic()
            packets = self.decoder.feed(data)
            if not packets:
                return
            events = self.stream.process(packets)
            live: list[dict] = []
            windows: list[dict] = []
            source = "test" if self.stream.state.test_source else "hardware"
            for kind, ev in events:
                if abort:
                    break
                if kind == "sample":
                    s = self._to_sample(ev)  # type: ignore[arg-type]
                    windows += self.engine.add(s)
                    if self._session_engine is not None:
                        ss = Sample(**{**s.__dict__})
                        windows_s = self._session_engine.add(ss)
                        self._store_windows(windows_s)
                        self._decimator.add(ss)  # type: ignore[union-attr]
                    pub = s.public()
                    pub["source"] = source
                    live.append(pub)
                    self._last_valid_t = time.monotonic()
                elif kind == "marker":
                    windows += self.engine.marker(ev)  # type: ignore[arg-type]
                    if self._session_engine is not None:
                        self._store_windows(self._session_engine.marker(ev))  # type: ignore[arg-type]
                elif kind == "hello":
                    if not ev["ok"]:  # type: ignore[index]
                        abort = (f"Unsupported protocol (HELLO magic {ev['magic']:#010x}). "  # type: ignore[index]
                                 "Flash the JouleLab firmware that matches this backend.")
                    elif ev["test_source"] and not self.settings.allow_test_sources:  # type: ignore[index]
                        abort = ("This port is sending TEST packets (from send_test_samples.py), not INA219 "
                                 "measurements. Set ALLOW_TEST_SOURCES=true in backend/.env to accept them "
                                 "for development.")
                    if abort:
                        self._rejected = True
                        live.clear()
                        windows.clear()
                    self.store.push_event({"type": "hello", **ev})  # type: ignore[dict-item]
                    if ev["ok"]:  # type: ignore[index]
                        self.monitor.push_line("HELLO from " + ("TEST source" if ev["test_source"]  # type: ignore[index]
                                                                else "JouleLab firmware"))
                    else:
                        self.monitor.push_line("HELLO with an unknown protocol version")
                elif kind in ("device_status", "resync", "loss"):
                    self.store.push_event({"type": kind, **ev})  # type: ignore[dict-item]
                    if kind == "device_status":
                        log.warning("board reported: %s", ev)
                        self.monitor.push_line("Board: " + ev["message"])  # type: ignore[index]
                    elif kind == "resync":
                        self.monitor.push_line("Resync: " + ev["reason"])  # type: ignore[index]
            if live and not self._ever_streamed:
                self._ever_streamed = True
                self.monitor.push_line(f"Receiving {source} measurements (binary packets are decoded, "
                                       "not printed here; see Lab → Live hardware)")
                log.info("receiving valid measurements from %s (%s)", self.port, source)
            self.store.push_samples(live)
            for w in windows:
                self.store.push_event({"type": "function_window", **w})
            if self._decimator is not None:
                rows = self._decimator.take_rows()
                if rows:
                    self.db.enqueue(SAMPLE_INSERT, rows)
        if abort:
            self._abort(abort)

    def _abort(self, reason: str) -> None:
        log.error(reason)
        with self._lock:
            self._state, self._message = "error", reason
        if self._loop is not None:
            asyncio.run_coroutine_threadsafe(self.disconnect(reason), self._loop)
        else:  # no event loop (tests): stop from a helper thread, never from the reader thread itself
            threading.Thread(target=lambda: self._reader and self._reader.stop(), daemon=True).start()

    @staticmethod
    def _to_sample(r: RawSample) -> Sample:
        v = r.voltage_mv / 1000.0
        i = r.current_ua / 1000.0
        return Sample(r.index, r.t_us, v, i, v * i, r.epoch, r.contiguous)

    def _store_windows(self, windows: list[dict]) -> None:
        if not windows or not self.session:
            return
        self.db.enqueue(FUNCTION_INSERT, [
            (self.session["id"], w["name"], w["source"], w["start_us"], w["end_us"], w["duration_us"],
             int(w["complete"]), w.get("energy_mj"), w.get("avg_power_mw"), w.get("max_power_mw"),
             w.get("reason")) for w in windows])

    # ---- sessions ------------------------------------------------------------
    def start_session(self, name: str, notes: str | None, full_rate: bool = False) -> dict:
        with self._lock:
            if self.session:
                raise HardwareError(f"Session {self.session['id']} is already running. Stop it first.", 409)
            if not self.status()["connected"]:
                raise HardwareError("No live measurements are arriving. Connect the board before starting a session.",
                                    409)
            source = "test" if self.stream.state.test_source else "hardware"
            self.session = self.db.create_session(name, notes, self.port, source, self.stream.state.period_us,
                                                  1 if full_rate else self.settings.db_store_decimation)
            self._session_engine = self._engine()
            self._decimator = _Decimator(self.session["id"], 1 if full_rate else self.settings.db_store_decimation,
                                         self.settings.db_max_samples_per_session)
            self._session_base = {"lost": self.stream.stats.lost_samples,
                                  "errors": self.decoder.stats.packet_errors}
            log.info("session %s started", self.session["id"])
            return self.session

    def stop_session(self) -> dict:
        with self._lock:
            if not self.session:
                raise HardwareError("No session is running.", 409)
            sid = self.session["id"]
            self._finish_session("completed")
        return self.db.get_session(sid)  # type: ignore[return-value]

    def _finish_session(self, status: str) -> None:
        assert self.session and self._session_engine and self._decimator
        self._decimator.flush_group()
        rows = self._decimator.take_rows()
        if rows:
            self.db.enqueue(SAMPLE_INSERT, rows)
        summary = self._session_engine.summary()
        self.db.finish_session(self.session["id"], status, summary,
                               self.stream.stats.lost_samples - self._session_base.get("lost", 0),
                               self.decoder.stats.packet_errors - self._session_base.get("errors", 0),
                               self._decimator.stored, self._decimator.capped)
        log.info("session %s %s: %.3f mJ", self.session["id"], status, summary["energy_mj"])
        self.session, self._session_engine, self._decimator = None, None, None

    def summary(self) -> dict:
        with self._lock:
            if self._session_engine is not None:
                return {"scope": "session", "session_id": self.session["id"], **self._session_engine.summary()}  # type: ignore[index]
            return {"scope": "connection", "session_id": None, **self.engine.summary()}

    def recent_windows(self, limit: int = 50) -> list[dict]:
        with self._lock:
            eng = self._session_engine or self.engine
            return list(eng.recent_windows)[-limit:]

    # ---- status ----------------------------------------------------------------
    def _derive_state(self) -> tuple[str, str]:
        state, msg = self._state, self._message
        if self._reader is None or state in ("reconnecting", "error", "disconnected"):
            return state, msg
        now = time.monotonic()
        fresh = self._last_valid_t and now - self._last_valid_t < self.settings.stall_timeout_s
        if fresh and self.stream.ready:
            src = "TEST packets (not hardware)" if self.stream.state.test_source else "INA219 measurements"
            return "streaming", f"Receiving {src} from {self.port}."
        if self._ever_streamed:
            return "stalled", (f"No valid data from {self.port} for more than {self.settings.stall_timeout_s:g} s. "
                               "The board may have stopped, reset or lost power.")
        d = self.decoder.stats
        if d.bytes_received == 0:
            return "waiting_for_data", (f"Port {self.port} is open but the board is sending nothing. Check that the "
                                        "JouleLab firmware is flashed, then press the black RESET button (B2).")
        if d.packets_ok == 0:
            return "waiting_for_data", (f"Receiving bytes from {self.port} but none are valid JouleLab packets. "
                                        "That is expected for a sketch that prints text (see the Serial monitor). "
                                        f"For measurements, check the baud rate ({self.baudrate}) and that the "
                                        "JouleLab firmware is flashed.")
        if not self.stream.state.hello_seen:
            return "waiting_for_data", "Valid packets received; waiting for the board's HELLO packet (sent every second)."
        if self.stream.state.device_errors and self.stream.stats.measurement_packets == 0:
            return "waiting_for_data", "Board is running but reports: " + self.stream.state.device_errors[-1]["message"]
        return "waiting_for_data", "Waiting for TIME_SYNC from the board…"

    def status(self) -> dict:
        with self._lock:
            state, msg = self._derive_state()
            st, d = self.stream.snapshot(), self.decoder.stats
            period = st["sample_period_us"]
            now = time.monotonic()
            return {
                "state": state,
                "connected": state == "streaming",
                "message": msg,
                "hardware_mode": self.settings.hardware_mode,
                "port": self.port if (self._reader is not None or self._suspended) else None,
                "baudrate": self.baudrate,
                "connected_since": self._connected_since if self._reader is not None else None,
                "source": (("test" if st["test_source"] else "hardware")
                           if st["hello_seen"] and self._reader is not None else None),
                "test_source": st["test_source"] and self._reader is not None,
                "packet_count": d.packets_ok,
                "packet_errors": d.packet_errors,
                "crc_errors": d.crc_errors,
                "unknown_packets": d.unknown_type,
                "bytes_received": d.bytes_received,
                "bytes_discarded": d.bytes_discarded,
                "samples_received": st["samples_released"],
                "lost_samples": st["lost_samples"],
                "duplicate_samples": st["duplicates"],
                "unsynced_samples": st["unsynced_samples"],
                "resyncs": st["resyncs"],
                "firmware_resets": st["firmware_resets"],
                "sample_period_us": period,
                "sample_rate_hz": round(1e6 / period, 3) if period else None,
                "last_data_age_s": round(now - self._last_valid_t, 3) if self._last_valid_t else None,
                "device_errors": st["device_errors"],
                "recent_decoder_errors": list(self.decoder.recent_errors)[-5:],
                "energy_mj": round((self._session_engine or self.engine).energy_mj, 6),
                "energy_scope": "session" if self._session_engine else "connection",
                "session": {k: self.session[k] for k in ("id", "name", "started_at")} if self.session else None,
            }
