"""Plain-language hints for failed PlatformIO jobs.

Looks at the job's output for well-known failure signatures and returns short, actionable
lines for the console. Pure functions, no I/O, so it is easy to test.
"""
from __future__ import annotations

import re

# (regex, hint). First hint per matching rule; at most MAX_HINTS are shown.
RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"Could not start .*(No such file|cannot find|not found)|\[WinError 2\]", re.I),
     "The pio command could not be started. Install PlatformIO in the SAME Python as the backend "
     "(activate the venv, then: python -m pip install platformio) and restart the backend, "
     "or set PIO_PATH in backend/.env to the full path of pio."),
    (re.compile(r"HTTPClientError|Could not install|Error: Could not (?:fetch|download)|"
                r"Failed to establish a new connection|Max retries exceeded|Temporary failure in name resolution|"
                r"getaddrinfo failed|SSL: CERTIFICATE_VERIFY_FAILED|ConnectionError", re.I),
     "PlatformIO could not download the board toolchain (no internet, proxy or firewall). The first "
     "build of each board needs the network once. Check your connection / proxy, then press Verify again."),
    (re.compile(r"PermissionError|Access is denied|Permission denied(?!.*ttyACM|.*ttyUSB)", re.I),
     "A file or folder was not writable. Do not run the backend from a read-only or synced "
     "folder (OneDrive/Dropbox); close antivirus scans of .platformio, or move the project."),
    (re.compile(r"(Could not open port|could not open port|PermissionError\(13|Access is denied.*COM|"
                r"Permission denied: '/dev/tty)", re.I),
     "The serial port is busy or not allowed. Close the Arduino IDE / other serial monitors, press "
     "'Close monitor' in JouleLab, and on Linux add yourself to the dialout group."),
    (re.compile(r"Failed to connect to ESP32|Wrong boot mode|No serial data received|Timed out waiting for packet header", re.I),
     "The ESP32 did not enter download mode. Hold the BOOT button while 'Connecting...' is shown, use a "
     "data USB cable, and choose the ESP32's port (not the ST-LINK port)."),
    (re.compile(r"avrdude.*(stk500_recv|not in sync|ser_open)", re.I),
     "The Arduino Uno did not answer. Check the cable and port, and that nothing else has the port open."),
    (re.compile(r"No ST-LINK detected|open failed|Error: init mode failed|LIBUSB_ERROR|"
                r"unable to open ftdi device|Error: .*stlink", re.I),
     "OpenOCD cannot talk to the ST-LINK. Use the CN1 mini-USB on the NUCLEO with a data cable; on Linux "
     "install PlatformIO's udev rules; on Windows install the ST-LINK driver (or set upload_protocol = mbed in "
     "the board's platformio.ini to flash by copying to the NOD_F446RE drive); close STM32CubeProgrammer."),
    (re.compile(r"undefined reference to [`']_(?:sbrk|write|read|close|lseek|fstat|isatty|exit|kill|getpid)", re.I),
     "newlib system stubs are missing. Add the project's syscalls or link with -specs=nosys.specs."),
    (re.compile(r"uses VFP register arguments|conflicting.*float|Source object .* has EABI version", re.I),
     "Mixed hard/soft-float objects. Delete backend/data/projects/nucleo_f446re (or press 'Reset board "
     "project') so the corrected platformio.ini is used, then Verify again."),
    (re.compile(r"fatal error: .*\.h: No such file or directory", re.I),
     "A header or library is missing. For Arduino boards add it to lib_deps in the board's platformio.ini "
     "template (firmware/platformio_templates/<board>/platformio.ini)."),
    (re.compile(r"Error: Unknown board ID|UnknownBoard", re.I),
     "PlatformIO does not know this board ID. Run: pio upgrade && pio pkg update, then retry."),
    (re.compile(r"No such file or directory: .*platformio\.ini|Not a PlatformIO project|"
                r"Error: Could not find .*platformio\.ini", re.I),
     "The project folder is incomplete. Press 'Reset board project' in the Workspace."),
    (re.compile(r"MemoryError|No space left on device|OSError: \[Errno 28\]", re.I),
     "The disk is full. Board toolchains need several GB (ESP32 the most)."),
]

MAX_HINTS = 3


def hints_for(lines: list[str], exit_code: int | None = None) -> list[str]:
    """Hints for a failed job's output lines (empty if nothing recognised)."""
    text = "\n".join(lines)
    out: list[str] = []
    for rx, hint in RULES:
        if rx.search(text) and hint not in out:
            out.append(hint)
        if len(out) >= MAX_HINTS:
            break
    return out
