"""`pio run -t upload` (Upload).

NUCLEO-F446RE: flashed over SWD through the on-board ST-LINK. That is a different USB
interface from the ST-LINK virtual COM port, so the measurement/monitor connection
stays open; the board resets after flashing and the stream resynchronises by itself.

ESP32 / Uno: flashed over the same USB serial port the monitor uses. If the shared
HardwareManager holds that port, it is released first (session and totals kept) and
reopened when the upload ends, successfully or not. No second program ever opens
the port while JouleLab has it.
"""
from __future__ import annotations

from app.hardware.connection_manager import HardwareManager
from app.hardware.serial_reader import port_exists
from app.services.build_manager import Job, JobRunner
from app.services.platformio_manager import DevError, PlatformIO, get_board


class UploadManager:
    def __init__(self, pio: PlatformIO, runner: JobRunner, hardware: HardwareManager) -> None:
        self.pio = pio
        self.runner = runner
        self.hardware = hardware

    async def upload(self, board_id: str, port: str | None, source: str | None) -> Job:
        board = get_board(board_id)
        cmd = self.pio.require()
        project = self.pio.ensure_project(board)
        if self.runner.busy:
            raise DevError(f"A {self.runner.current.kind} is already running. Press Stop first.", 409)  # type: ignore[union-attr]

        args = cmd + ["run", "-d", str(project), "-e", board.id, "-t", "upload"]
        port = (port or "").strip()
        if board.serial_upload:
            if not port or port == "auto":
                raise DevError(f"Choose the serial port of the {board.name} before uploading.")
            if not port_exists(port):
                raise DevError(f"Serial port {port} was not found. Refresh the list and check the cable.", 404)
            args += ["--upload-port", port]

        saved = self.pio.write_main(board, source) if source is not None else None

        lent = False
        if board.serial_upload and self.hardware.holds_port(port):
            lent = await self.hardware.suspend(f"Serial port {port} lent to the {board.name} upload; "
                                               "it reopens automatically afterwards.")

        async def after(job: Job) -> None:
            if lent:
                st = await self.hardware.resume()
                self.runner.note(f"Serial monitor: {st['message']}", job)

        try:
            job = self.runner.start("upload", board.id, args, str(project), on_exit=after)
        except DevError:
            if lent:
                await self.hardware.resume()
            raise
        if saved is not None:
            self.runner.note(f"Saved the editor to {saved.relative_to(project)}", job)
        if lent:
            self.runner.note(f"Released {port} from the serial monitor for the upload.", job)
        if not board.serial_upload and self.hardware.port and self.hardware.status()["state"] != "disconnected":
            self.runner.note("Flashing over SWD (ST-LINK). The serial connection stays open; the board "
                             "restarts and the measurement stream resynchronises by itself.", job)
        return job
