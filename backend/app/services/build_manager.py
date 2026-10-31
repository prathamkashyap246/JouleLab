"""Runs PlatformIO as a subprocess and streams its output.

Only one job (build, upload or debug) runs at a time: they share the project folder
and, for the NUCLEO, the ST-LINK. A job is reported as succeeded only when the
process exits with code 0.

Processes are started with subprocess.Popen and read in a thread (not asyncio
subprocesses), because asyncio subprocesses do not work under uvicorn --reload on
Windows. Each job runs in its own process group so Stop also ends the tools PlatformIO
starts (OpenOCD, GDB, esptool, avrdude).
"""
from __future__ import annotations

import asyncio
import itertools
import logging
import os
import re
import signal
import subprocess
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from app.services.pio_hints import hints_for
from app.services.platformio_manager import DevError, PlatformIO, get_board

log = logging.getLogger("joulelab.dev")
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
_ids = itertools.count(1)


@dataclass
class Job:
    id: int
    kind: str  # build | upload | debug
    board: str
    command: list[str]
    cwd: str
    status: str = "running"  # running | succeeded | failed | cancelled | timeout
    exit_code: int | None = None
    started_at: float = field(default_factory=time.time)
    ended_at: float | None = None
    message: str = ""
    proc: subprocess.Popen | None = None
    lines: deque = field(default_factory=lambda: deque(maxlen=5000))
    cancel_requested: bool = False
    timed_out: bool = False

    def public(self) -> dict:
        return {"id": self.id, "kind": self.kind, "board": self.board, "status": self.status,
                "exit_code": self.exit_code, "message": self.message, "command": " ".join(self.command),
                "started_at": self.started_at, "ended_at": self.ended_at,
                "duration_s": round((self.ended_at or time.time()) - self.started_at, 1)}


class JobRunner:
    def __init__(self, timeout_s: float) -> None:
        self.timeout_s = timeout_s
        self.current: Job | None = None
        self.last: Job | None = None
        self.clients: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    @property
    def busy(self) -> bool:
        return self.current is not None and self.current.status == "running"

    # ---- output fan-out --------------------------------------------------------
    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self.clients.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.clients.discard(q)

    def _publish(self, msg: dict) -> None:  # event-loop thread only
        for q in list(self.clients):
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(msg)

    def _emit(self, msg: dict) -> None:  # any thread
        if self._loop is not None and self._loop.is_running():
            self._loop.call_soon_threadsafe(self._publish, msg)

    def note(self, text: str, job: Job | None = None) -> None:
        """A JouleLab line in the output console (not from the tool)."""
        job = job or self.current
        line = f"[JouleLab] {text}"
        if job:
            job.lines.append(line)
        self._emit({"type": "line", "job": job.id if job else None, "text": line, "source": "joulelab"})

    # ---- running -------------------------------------------------------------
    def start(self, kind: str, board: str, command: list[str], cwd: str,
              on_exit: Callable[[Job], Awaitable[None]] | None = None, stdin: bool = False) -> Job:
        if self.busy:
            raise DevError(f"A {self.current.kind} is already running. Press Stop first.", 409)  # type: ignore[union-attr]
        job = Job(next(_ids), kind, board, command, cwd)
        env = dict(os.environ, PLATFORMIO_DISABLE_COLOR="true", PYTHONUNBUFFERED="1",
                   PLATFORMIO_SETTING_ENABLE_PROMPTS="false")
        kwargs: dict = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
        else:
            kwargs["start_new_session"] = True
        try:
            job.proc = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        stdin=subprocess.PIPE if stdin else subprocess.DEVNULL, bufsize=0, **kwargs)
        except OSError as e:
            raise DevError(f"Could not start {command[0]}: {e}", 500) from e
        self.current = job
        self._emit({"type": "job", "job": job.public()})
        self.note(f"{kind} started: {' '.join(command)}", job)
        threading.Thread(target=self._pump, args=(job, on_exit), name=f"job-{job.id}", daemon=True).start()
        return job

    def _pump(self, job: Job, on_exit) -> None:
        assert job.proc and job.proc.stdout
        buf = b""
        timer = threading.Timer(self.timeout_s, self._on_timeout, args=(job,))
        timer.daemon = True
        timer.start()
        try:
            while True:
                chunk = job.proc.stdout.read1(4096) if hasattr(job.proc.stdout, "read1") else job.proc.stdout.read(4096)
                if not chunk:
                    break
                buf += chunk
                parts = re.split(rb"\r\n|\n|\r", buf)
                buf = parts.pop()
                for raw in parts:
                    self._line(job, raw)
            if buf:
                self._line(job, buf)
            code = job.proc.wait()
        finally:
            timer.cancel()
        job.exit_code = code
        job.ended_at = time.time()
        if job.timed_out:
            job.status, job.message = "timeout", f"Stopped after {self.timeout_s:g} s (DEV_JOB_TIMEOUT_S)."
        elif job.cancel_requested:
            job.status, job.message = "cancelled", "Stopped by user."
        elif code == 0:
            job.status, job.message = "succeeded", f"{job.kind.capitalize()} succeeded (exit code 0)."
        else:
            job.status, job.message = "failed", f"{job.kind.capitalize()} failed (exit code {code})."
        self.note(job.message, job)
        if job.status in ("failed", "timeout") and job.kind != "debug":
            found = hints_for(list(job.lines), code)
            if not found and len(job.lines) <= 2:
                found = ["PlatformIO printed nothing. Run `pio --version` in the backend's terminal; if that "
                         "fails, reinstall: python -m pip install --upgrade platformio"]
            for h in found:
                self.note("Hint: " + h, job)
        log.info("job %s %s: %s", job.id, job.kind, job.message)
        if self._loop is not None and self._loop.is_running():
            fut = asyncio.run_coroutine_threadsafe(self._finish(job, on_exit), self._loop)
            try:
                fut.result(timeout=60)
            except Exception:  # noqa: BLE001
                log.exception("job %s post-processing failed", job.id)
        else:
            self._finish_sync(job)

    async def _finish(self, job: Job, on_exit) -> None:
        if on_exit is not None:
            try:
                await on_exit(job)
            except Exception as e:  # noqa: BLE001
                log.exception("after-%s step failed", job.kind)
                self.note(f"After {job.kind}: {e}", job)
        self._finish_sync(job)
        self._publish({"type": "job", "job": job.public()})

    def _finish_sync(self, job: Job) -> None:
        self.last = job
        if self.current is job:
            self.current = None

    def _line(self, job: Job, raw: bytes) -> None:
        text = ANSI.sub("", raw.decode("utf-8", errors="replace")).rstrip()
        if not text:
            return
        job.lines.append(text)
        self._emit({"type": "line", "job": job.id, "text": text, "source": job.kind})

    def write_stdin(self, text: str) -> None:
        job = self.current
        if job is None or job.proc is None or job.proc.stdin is None or job.status != "running":
            raise DevError("No interactive session is running.", 409)
        try:
            job.proc.stdin.write(text.encode("utf-8"))
            job.proc.stdin.flush()
        except OSError as e:
            raise DevError(f"Could not send to the process: {e}", 409) from e

    def _kill_tree(self, job: Job, sig: int) -> None:
        p = job.proc
        if p is None or p.poll() is not None:
            return
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True, timeout=15)
            else:
                os.killpg(p.pid, sig)
        except (ProcessLookupError, PermissionError, OSError, subprocess.TimeoutExpired):
            pass

    def _on_timeout(self, job: Job) -> None:
        if job.proc and job.proc.poll() is None:
            job.timed_out = True
            self._kill_tree(job, signal.SIGTERM if os.name != "nt" else 0)

    async def stop(self, grace_s: float = 3.0) -> dict | None:
        job = self.current
        if job is None or job.status != "running":
            return None
        job.cancel_requested = True
        self.note(f"Stopping {job.kind}…", job)
        if job.kind == "debug" and job.proc and job.proc.stdin:
            try:  # let GDB detach cleanly from the target first
                job.proc.stdin.write(b"quit\n")
                job.proc.stdin.flush()
            except OSError:
                pass
        await asyncio.sleep(0)
        end = time.time() + grace_s
        if job.kind != "debug":
            self._kill_tree(job, signal.SIGTERM if os.name != "nt" else 0)
        while job.proc and job.proc.poll() is None and time.time() < end:
            await asyncio.sleep(0.1)
        if job.proc and job.proc.poll() is None:
            self._kill_tree(job, signal.SIGKILL if os.name != "nt" else 0)
        for _ in range(50):  # wait for _pump to record the result
            if job.status != "running":
                break
            await asyncio.sleep(0.1)
        return job.public()

    def snapshot(self) -> dict:
        job = self.current or self.last
        return {"type": "snapshot", "job": job.public() if job else None,
                "lines": list(job.lines)[-500:] if job else []}


class BuildManager:
    """`pio run` (Verify)."""

    def __init__(self, pio: PlatformIO, runner: JobRunner) -> None:
        self.pio = pio
        self.runner = runner

    def build(self, board_id: str, source: str | None) -> Job:
        board = get_board(board_id)
        cmd = self.pio.require()
        project = self.pio.ensure_project(board)
        if self.runner.busy:
            raise DevError(f"A {self.runner.current.kind} is already running. Press Stop first.", 409)  # type: ignore[union-attr]
        if source is not None:
            path = self.pio.write_main(board, source)
        job = self.runner.start("build", board.id, cmd + ["run", "-d", str(project), "-e", board.id], str(project))
        if source is not None:
            self.runner.note(f"Saved the editor to {path.relative_to(project)}", job)
        return job
