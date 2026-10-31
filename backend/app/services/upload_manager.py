"""`pio run -t upload` (Upload).

NUCLEO-F446RE: flashed through the on-board ST-LINK, either over SWD (upload_protocol =
stlink, needs the ST-LINK USB driver) or by copying firmware.bin to its NOD_F446RE drive
(upload_protocol = mbed). After a drive copy the ST-LINK re-enumerates its whole USB
device, which leaves an open COM port handle dead on Windows (open, but no bytes). So the
measurement connection is released before every NUCLEO upload and reopened a few seconds
after it ends, whichever protocol is used.

ESP32 / Uno: flashed over the same USB serial port the monitor uses. If the shared
HardwareManager holds that port, it is released first (session and totals kept) and
reopened when the upload ends, successfully or not. No second program ever opens
the port while JouleLab has it.
"""
from __future__ import annotations

import asyncio

from app.hardware.connection_manager import HardwareManager
from app.hardware.serial_reader import port_exists
from app.services.build_manager import Job, JobRunner
from app.services.platformio_manager import DevError, PlatformIO, get_board


NUCLEO_SETTLE_S = 3.0  # ST-LINK USB re-enumeration + board restart after flashing


class UploadManager:
    def __init__(self, pio: PlatformIO, runner: JobRunner, hardware: HardwareManager, logport=None) -> None:
        self.pio = pio
        self.runner = runner
        self.hardware = hardware
        self.logport = logport  # optional second (text-only) connection

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

        lent, owner, settle_s = False, None, 0.0
        if board.serial_upload:
            for candidate in (self.hardware, self.logport):
                if candidate is not None and candidate.holds_port(port):
                    owner = candidate
            if owner is not None:
                lent = await owner.suspend(f"Serial port {port} lent to the {board.name} upload; "
                                           "it reopens automatically afterwards.")
        elif self.hardware.port and self.hardware.holds_port(self.hardware.port):
            owner, port, settle_s = self.hardware, self.hardware.port, NUCLEO_SETTLE_S
            lent = await owner.suspend(f"Serial port {port} released while the {board.name} is flashed; "
                                       "it reopens automatically afterwards.")

        async def after(job: Job) -> None:
            if lent:
                if settle_s:
                    await asyncio.sleep(settle_s)  # let the ST-LINK re-enumerate and the board restart
                st = await owner.resume()
                self.runner.note(f"Serial monitor: {st['message']}", job)

        try:
            job = self.runner.start("upload", board.id, args, str(project), on_exit=after)
        except DevError:
            if lent:
                await owner.resume()
            raise
        if saved is not None:
            self.runner.note(f"Saved the editor to {saved.relative_to(project)}", job)
        if lent:
            self.runner.note(f"Released {port} from the serial monitor for the upload.", job)
        return job
