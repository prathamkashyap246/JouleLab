"""`pio debug --interface=gdb` (Debug).

PlatformIO builds a debug build, starts OpenOCD for the ST-LINK, loads the firmware and
stops at main(). The Workspace console sends GDB commands (continue, next, step, bt,
info registers, ...) to GDB's standard input. Only boards with a debugger reachable over
their USB connection are supported (the NUCLEO's ST-LINK).

While the CPU is halted the board sends no measurements, so the Live hardware view
shows "Data stopped" until you `continue`.
"""
from __future__ import annotations

from app.services.build_manager import Job, JobRunner
from app.services.platformio_manager import DevError, PlatformIO, get_board

MAX_COMMAND = 300


class DebugManager:
    def __init__(self, pio: PlatformIO, runner: JobRunner) -> None:
        self.pio = pio
        self.runner = runner

    def start(self, board_id: str, source: str | None) -> Job:
        board = get_board(board_id)
        if not board.debug:
            raise DevError(f"Debugging is not available for {board.name}. {board.debug_note}")
        cmd = self.pio.require()
        project = self.pio.ensure_project(board)
        if self.runner.busy:
            raise DevError(f"A {self.runner.current.kind} is already running. Press Stop first.", 409)  # type: ignore[union-attr]
        saved = self.pio.write_main(board, source) if source is not None else None
        job = self.runner.start("debug", board.id,
                                cmd + ["debug", "-d", str(project), "-e", board.id, "--interface=gdb", "--", "-q"],
                                str(project), stdin=True)
        if saved is not None:
            self.runner.note(f"Saved the editor to {saved.relative_to(project)}", job)
        self.runner.note("Debug build → flash → stop at main(). Send GDB commands below "
                         "(continue, next, step, bt, info locals, info registers). Stop ends the session.", job)
        return job

    def command(self, text: str) -> None:
        job = self.runner.current
        if job is None or job.kind != "debug" or job.status != "running":
            raise DevError("No debug session is running. Press Debug first.", 409)
        line = text.replace("\r", " ").replace("\n", " ").strip()
        if not line:
            raise DevError("Empty command.")
        if len(line) > MAX_COMMAND:
            raise DevError(f"Command longer than {MAX_COMMAND} characters.")
        self.runner.note(f"(gdb) {line}", job)
        self.runner.write_stdin(line + "\n")

    async def stop(self) -> dict | None:
        job = self.runner.current
        if job is None or job.kind != "debug":
            raise DevError("No debug session is running.", 409)
        return await self.runner.stop()

    def status(self) -> dict:
        job = self.runner.current
        active = job is not None and job.kind == "debug" and job.status == "running"
        return {"active": active, "job": job.public() if active else None}
