"""Serial port discovery and a background reader thread (PySerial).

The reader runs in its own thread so blocking reads never touch the FastAPI
event loop. It reports bytes and state changes through callbacks, and
reconnects automatically when the board is unplugged and plugged back in.
"""
from __future__ import annotations

import logging
import os
import sys
import threading
import time
from dataclasses import dataclass
from typing import Callable

import serial
from serial.tools import list_ports

log = logging.getLogger("joulelab.serial")

ST_VID = 0x0483
# ST-LINK V2-1 (NUCLEO-F446RE uses 0x374B), V3 variants
ST_LINK_PIDS = {0x374B, 0x3752, 0x374E, 0x374F, 0x3753, 0x3754, 0x3755, 0x3757}


@dataclass
class PortInfo:
    device: str
    description: str
    hwid: str
    vid: int | None
    pid: int | None
    serial_number: str | None
    manufacturer: str | None
    product: str | None
    is_stlink: bool

    def public(self) -> dict:
        d = dict(self.__dict__)
        d["vid"] = f"{self.vid:04X}" if self.vid is not None else None
        d["pid"] = f"{self.pid:04X}" if self.pid is not None else None
        d["label"] = f"{self.device} — {self.description}" + ("  [ST-LINK]" if self.is_stlink else "")
        return d


def _is_stlink(p) -> bool:
    text = " ".join(filter(None, [p.description, p.product, p.manufacturer])).lower()
    return (p.vid == ST_VID and (p.pid in ST_LINK_PIDS or "stlink" in text or "st-link" in text)) or \
        "stlink" in text or "st-link" in text


def list_serial_ports() -> list[PortInfo]:
    ports = []
    for p in list_ports.comports():
        dev = p.device
        # macOS lists every device twice; /dev/cu.* is the one to open (tty.* waits for carrier detect)
        if sys.platform == "darwin" and dev.startswith("/dev/tty."):
            continue
        if dev.endswith(("Bluetooth-Incoming-Port", "debug-console")):
            continue
        if sys.platform.startswith("linux") and dev.startswith("/dev/ttyS") and p.vid is None:
            continue  # legacy on-board UART placeholders; never a USB board
        ports.append(PortInfo(dev, p.description or "", p.hwid or "", p.vid, p.pid, p.serial_number,
                              p.manufacturer, p.product, _is_stlink(p)))
    ports.sort(key=lambda x: (not x.is_stlink, x.device))
    return ports


def auto_detect_port() -> str:
    """Return the single ST-LINK virtual COM port, or raise ValueError with a helpful message."""
    ports = list_serial_ports()
    st = [p for p in ports if p.is_stlink]
    if len(st) == 1:
        return st[0].device
    if len(st) > 1:
        raise ValueError("Several ST-LINK ports found (" + ", ".join(p.device for p in st) + "). Choose one.")
    others = ", ".join(p.device for p in ports) or "none"
    raise ValueError("No ST-LINK virtual COM port found. Plug the NUCLEO-F446RE into USB (CN1, the ST-LINK "
                     f"connector) and check the cable carries data. Ports seen: {others}")


def port_exists(device: str) -> bool:
    if any(p.device == device for p in list_serial_ports()):
        return True
    if os.name == "posix":
        return os.path.exists(device)
    return device.upper().startswith("COM") or device.startswith("\\\\.\\")


def find_port_by_serial(serial_number: str | None) -> str | None:
    if not serial_number:
        return None
    for p in list_serial_ports():
        if p.serial_number == serial_number:
            return p.device
    return None


def explain_open_error(device: str, err: Exception) -> str:
    msg = str(err)
    low = msg.lower()
    if "permission" in low or "access is denied" in low or getattr(err, "errno", None) == 13:
        if sys.platform.startswith("linux"):
            return (f"Permission denied opening {device}. Add your user to the 'dialout' group "
                    "(sudo usermod -aG dialout $USER), then log out and back in.")
        return (f"Cannot open {device}: it is in use or access is denied. Close STM32CubeIDE's serial "
                "console, PuTTY, screen, Arduino Serial Monitor or any other program using the port.")
    if "busy" in low or "resource busy" in low:
        return f"{device} is busy. Close any other serial monitor using it."
    if "no such file" in low or "could not open port" in low or "filenotfound" in low:
        return f"{device} does not exist. The board may be unplugged; refresh the port list."
    return f"Cannot open {device}: {msg}"


def open_port(device: str, baudrate: int) -> serial.Serial:
    """Open with 8N1, no flow control. Raises serial.SerialException with a readable message."""
    try:
        ser = serial.Serial()
        ser.port = device
        ser.baudrate = baudrate
        ser.bytesize = serial.EIGHTBITS
        ser.parity = serial.PARITY_NONE
        ser.stopbits = serial.STOPBITS_ONE
        ser.xonxoff = False
        ser.rtscts = False
        ser.dsrdtr = False
        ser.timeout = 0.05
        ser.open()
        try:
            ser.reset_input_buffer()  # drop stale bytes buffered by the OS before we opened
        except (serial.SerialException, OSError):
            pass
        return ser
    except (serial.SerialException, OSError, ValueError) as e:
        raise serial.SerialException(explain_open_error(device, e)) from e


class SerialReader:
    """Reads bytes in a thread. Callbacks run in the reader thread."""

    def __init__(self, ser: serial.Serial, baudrate: int, serial_number: str | None,
                 on_bytes: Callable[[bytes], None], on_state: Callable[[str, str], None],
                 auto_reconnect: bool = True) -> None:
        self._ser: serial.Serial | None = ser
        self.device = ser.port
        self.baudrate = baudrate
        self.serial_number = serial_number
        self._on_bytes = on_bytes
        self._on_state = on_state
        self.auto_reconnect = auto_reconnect
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="serial-reader", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=3)
        self._close()

    def write(self, data: bytes) -> int:
        """Send bytes to the board (PySerial allows a write while the reader thread reads)."""
        ser = self._ser
        if ser is None:
            raise serial.SerialException("The port is not open (the board may be reconnecting).")
        n = ser.write(data) or 0
        ser.flush()
        return n

    def _close(self) -> None:
        if self._ser is not None:
            try:
                self._ser.close()
            except Exception:  # noqa: BLE001 - closing a vanished device can raise anything
                pass
            self._ser = None

    def _run(self) -> None:
        while not self._stop.is_set():
            if self._ser is None:
                if not self._reconnect_once():
                    self._stop.wait(1.0)
                    continue
            try:
                data = self._ser.read(4096)  # returns after 50 ms or when bytes are available
                if data:
                    self._on_bytes(data)
            except (serial.SerialException, OSError, TypeError, AttributeError) as e:
                if self._stop.is_set():
                    break
                log.warning("serial read failed on %s: %s", self.device, e)
                self._close()
                if not self.auto_reconnect:
                    self._on_state("error", f"Lost connection to {self.device}: {e}")
                    return
                self._on_state("reconnecting", f"Board disconnected from {self.device}. Waiting for it to come back…")

    def _reconnect_once(self) -> bool:
        device = find_port_by_serial(self.serial_number) or self.device
        if not port_exists(device):
            return False
        try:
            self._ser = open_port(device, self.baudrate)
        except serial.SerialException as e:
            self._on_state("reconnecting", str(e))
            return False
        self.device = device
        log.info("reconnected to %s", device)
        self._on_state("reconnected", f"Reconnected to {device}")
        return True
