"""A second, text-only serial connection: e.g. ESP32 logs while the NUCLEO streams measurements
on the main connection. Like the main one, it is owned by the backend only; the two never open
the same port, and uploads borrow it the same way (suspend / resume)."""
from __future__ import annotations

import asyncio
import logging

import serial

from app.core.config import ALLOWED_BAUDRATES
from app.hardware.connection_manager import HardwareError, HardwareManager
from app.hardware.serial_reader import SerialReader, list_serial_ports, open_port, port_exists
from app.services.serial_monitor import MonitorHub

log = logging.getLogger("joulelab.logport")


class LogPort:
    def __init__(self, main: HardwareManager, monitor: MonitorHub, auto_reconnect: bool = True) -> None:
        self.main = main
        self.monitor = monitor
        self.auto_reconnect = auto_reconnect
        self._reader: SerialReader | None = None
        self.port: str | None = None
        self.baudrate = 115200
        self.state = "disconnected"
        self.message = "Not connected."
        self._suspended: tuple[str, int] | None = None
        self.bytes_received = 0
        main.other_owner = self.holds_port  # the main manager must not open our port

    def holds_port(self, device: str) -> bool:
        return self._reader is not None and self.port == device

    def status(self) -> dict:
        return {"state": self.state, "port": self.port if (self._reader or self._suspended) else None,
                "baudrate": self.baudrate, "message": self.message, "bytes_received": self.bytes_received}

    def _on_bytes(self, data: bytes) -> None:
        self.bytes_received += len(data)
        if self.state != "open":
            self.state = "open"
        self.monitor.push_bytes(data)

    def _on_state(self, kind: str, message: str) -> None:
        self.message = message
        self.state = {"reconnecting": "reconnecting", "reconnected": "open", "error": "error"}.get(kind, self.state)
        if kind == "error":
            self._reader = None
        self.monitor.push_line(message)

    async def connect(self, port: str, baudrate: int | None) -> dict:
        baud = baudrate or 115200
        if baud not in ALLOWED_BAUDRATES:
            raise HardwareError(f"Unsupported baud rate {baud}.")
        if self._reader is not None:
            raise HardwareError(f"The log port is already open on {self.port}. Disconnect it first.", 409)
        device = (port or "").strip()
        if not device:
            raise HardwareError("Choose the log port (e.g. the ESP32's USB serial port).")
        if self.main.status()["port"] == device:
            raise HardwareError(f"{device} is already used by the main connection (measurements). "
                                "Pick the other board's port.", 409)
        if not port_exists(device):
            raise HardwareError(f"Serial port {device} was not found.", 404)
        try:
            ser = await asyncio.to_thread(open_port, device, baud)
        except serial.SerialException as e:
            raise HardwareError(str(e), 409) from e
        sn = next((p.serial_number for p in list_serial_ports() if p.device == device), None)
        self.port, self.baudrate, self._suspended = device, baud, None
        self.state, self.message = "open", f"Log port {device} open at {baud} baud."
        self._reader = SerialReader(ser, baud, sn, self._on_bytes, self._on_state, self.auto_reconnect)
        self._reader.start()
        self.monitor.push_line(self.message)
        return self.status()

    async def disconnect(self) -> dict:
        r, self._reader, self._suspended = self._reader, None, None
        if r is not None:
            await asyncio.to_thread(r.stop)
            self.monitor.push_line(f"Log port {self.port} closed.")
        self.state, self.message = "disconnected", "Not connected."
        return self.status()

    async def send(self, text: str, line_ending: str = "\n") -> dict:
        if self._reader is None:
            raise HardwareError("The log port is not connected.", 409)
        try:
            n = await asyncio.to_thread(self._reader.write, (text + line_ending).encode("utf-8"))
        except (serial.SerialException, OSError) as e:
            raise HardwareError(f"Could not send to {self.port}: {e}", 409) from e
        self.monitor.push_line(f"sent: {text!r}")
        return {"sent_bytes": n, "port": self.port}

    # uploads over this port (ESP32 / Uno)
    async def suspend(self, reason: str) -> bool:
        if self._reader is None:
            return False
        r, self._reader = self._reader, None
        await asyncio.to_thread(r.stop)
        self._suspended = (self.port, self.baudrate)  # type: ignore[assignment]
        self.state, self.message = "paused", reason
        self.monitor.push_line(reason)
        return True

    async def resume(self, timeout_s: float = 15.0) -> dict:
        if not self._suspended:
            return self.status()
        device, baud = self._suspended
        loop = asyncio.get_running_loop()
        deadline, last = loop.time() + timeout_s, "port not present"
        while loop.time() < deadline and self._suspended:
            if port_exists(device):
                try:
                    ser = await asyncio.to_thread(open_port, device, baud)
                    break
                except serial.SerialException as e:
                    last = str(e)
            await asyncio.sleep(0.5)
        else:
            self._suspended = None
            self.state, self.message = "error", f"Could not reopen {device} after the upload: {last}"
            self.monitor.push_line(self.message)
            return self.status()
        if not self._suspended:
            ser.close()
            return self.status()
        self._suspended = None
        self.state, self.message = "open", f"Reopened {device} after upload"
        self._reader = SerialReader(ser, baud, None, self._on_bytes, self._on_state, self.auto_reconnect)
        self._reader.start()
        self.monitor.push_line(self.message)
        return self.status()
