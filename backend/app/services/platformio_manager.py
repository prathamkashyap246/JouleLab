"""PlatformIO: finding the `pio` command, supported boards, and per-board projects.

Each board has a PlatformIO project under PROJECTS_DIR, created on first use from a
template in firmware/. The Workspace editor edits that project's main source file.
platformio.ini always comes from the template, never from the browser: PlatformIO
can run Python scripts listed in platformio.ini, so accepting it from a client would
let anyone run code on this computer.
"""
from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings


class DevError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class Board:
    id: str  # PlatformIO environment name
    name: str
    template: str  # folder under firmware/
    main_file: str  # file the Workspace editor edits, relative to the project
    language: str
    upload_method: str  # "stlink" (SWD through the on-board ST-LINK) or "serial"
    debug: bool
    debug_note: str
    copy_ignore: tuple[str, ...] = ()

    @property
    def serial_upload(self) -> bool:
        return self.upload_method == "serial"

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "main_file": self.main_file, "language": self.language,
                "upload_method": self.upload_method, "needs_upload_port": self.serial_upload,
                "debug_supported": self.debug, "debug_note": self.debug_note}


BOARDS: dict[str, Board] = {
    "nucleo_f446re": Board(
        "nucleo_f446re", "STM32 NUCLEO-F446RE", "joulelab_f446re", "Core/Src/main.c", "c", "stlink", True,
        "Uses the on-board ST-LINK (OpenOCD + GDB, downloaded by PlatformIO).",
        ("build", "tests", ".pio", ".gitignore", "Makefile")),
    "nucleo_f446re_arduino": Board(
        "nucleo_f446re_arduino", "STM32 NUCLEO-F446RE (Arduino)", "platformio_templates/nucleo_f446re_arduino",
        "src/main.ino", "arduino", "stlink", True,
        "Uses the on-board ST-LINK (OpenOCD + GDB, downloaded by PlatformIO)."),
    "esp32dev": Board(
        "esp32dev", "ESP32 DevKit", "platformio_templates/esp32dev", "src/main.ino", "arduino", "serial", False,
        "Needs an external JTAG probe (e.g. ESP-Prog); not available over the DevKit's USB port."),
    "uno": Board(
        "uno", "Arduino Uno R3", "platformio_templates/uno", "src/main.ino", "arduino", "serial", False,
        "The Uno has no on-chip debugger reachable over USB."),
}


def get_board(board_id: str) -> Board:
    b = BOARDS.get(board_id)
    if b is None:
        raise DevError(f"Unknown board '{board_id}'. Supported: {', '.join(BOARDS)}.", 404)
    return b


class PlatformIO:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.projects_dir = Path(settings.projects_dir).resolve()
        self.firmware_dir = Path(settings.firmware_dir).resolve()
        self._version: str | None = None

    # ---- the pio command ----------------------------------------------------
    def command(self) -> list[str] | None:
        if self.settings.pio_path:
            return [self.settings.pio_path]
        exe = "pio.exe" if os.name == "nt" else "pio"
        beside = Path(sys.executable).parent / exe  # installed in this venv: python -m pip install platformio
        if beside.exists():
            return [str(beside)]
        found = shutil.which("pio") or shutil.which("platformio")
        if found:
            return [found]
        if importlib.util.find_spec("platformio") is not None:
            return [sys.executable, "-m", "platformio"]
        return None

    def require(self) -> list[str]:
        cmd = self.command()
        if cmd is None:
            raise DevError("PlatformIO is not installed. In backend/ with the venv active run: "
                           "python -m pip install platformio   (then restart the backend)", 503)
        return cmd

    def version(self) -> str | None:
        if self._version is None:
            cmd = self.command()
            if cmd is None:
                return None
            try:
                out = subprocess.run(cmd + ["--version"], capture_output=True, text=True, timeout=30)
                self._version = (out.stdout or out.stderr).strip() or None
            except (OSError, subprocess.TimeoutExpired):
                return None
        return self._version

    # ---- projects -------------------------------------------------------------
    def project_dir(self, board: Board) -> Path:
        return self.projects_dir / board.id

    # Files that configure the build. They always come from the template (see the module docstring),
    # so a project created by an older version picks up fixes instead of keeping a stale copy.
    CONFIG_FILES = ("platformio.ini", "pio_build.py")

    def ensure_project(self, board: Board) -> Path:
        dest = self.project_dir(board)
        src = self.firmware_dir / board.template
        if not (dest / "platformio.ini").exists():
            if not (src / "platformio.ini").exists():
                raise DevError(f"Project template missing: {src}", 500)
            self.projects_dir.mkdir(parents=True, exist_ok=True)
            shutil.copytree(src, dest, ignore=shutil.ignore_patterns(*board.copy_ignore), dirs_exist_ok=True)
        else:
            for name in self.CONFIG_FILES:
                t, d = src / name, dest / name
                if t.is_file() and (not d.is_file() or t.read_bytes() != d.read_bytes()):
                    shutil.copyfile(t, d)
        return dest

    def reset_project(self, board: Board) -> Path:
        dest = self.project_dir(board)
        if dest.exists():
            if self.projects_dir not in dest.resolve().parents:  # never delete outside PROJECTS_DIR
                raise DevError("Refusing to delete a folder outside the projects directory.", 500)
            shutil.rmtree(dest)
        return self.ensure_project(board)

    def main_path(self, board: Board) -> Path:
        return self.ensure_project(board) / board.main_file

    def read_main(self, board: Board) -> str:
        return self.main_path(board).read_text(encoding="utf-8")

    def write_main(self, board: Board, source: str) -> Path:
        if not source.strip():
            raise DevError("The editor is empty. Open the board's project file or paste code first.")
        if len(source) > self.settings.dev_max_source_chars:
            raise DevError(f"Source is larger than {self.settings.dev_max_source_chars} characters.", 413)
        check_board_matches(board, source)
        path = self.main_path(board)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(source, encoding="utf-8", newline="\n")
        os.replace(tmp, path)
        return path


_ARDUINO_HINTS = ("#include <arduino.h>", "#include <bledevice.h>", "#include <wifi.h>", "#include <wire.h>",
                  "serial.begin(", "digitalwrite(", "ledcattach(", "ledcwrite(", "esp_sleep_", "bledevice::")
_ESP32_HINTS = ("#include <bledevice.h>", "#include <wifi.h>", "ledcattach(", "ledcwrite(", "esp_sleep_",
                "bledevice::", "esp_random(", "#include <esp_")
_STM32_HINTS = ("stm32f4xx_hal.h", "hal_init(", "systemclock_config(", "main.h\"", "huart", "hi2c")


def check_board_matches(board: Board, source: str) -> None:
    """Refuse to save code written for a different board into this board's project.

    Saving an ESP32 sketch into the NUCLEO project (or the reverse) overwrites that project's main
    file, and every later Verify of that board then fails with a missing-header error."""
    low = source.lower()
    looks_arduino = any(h in low for h in _ARDUINO_HINTS) or ("void setup(" in low and "void loop(" in low)
    looks_stm32 = any(h in low for h in _STM32_HINTS)
    if board.language == "c" and looks_arduino and not looks_stm32:
        raise DevError(f"This looks like an Arduino/ESP32 sketch, but the selected board is {board.name}. "
                       "Choose 'ESP32 DevKit' (or 'Arduino Uno R3') in the Board menu. Nothing was saved.", 422)
    if board.id == "nucleo_f446re_arduino" and any(h in low for h in _ESP32_HINTS):
        raise DevError(f"This sketch uses ESP32-only features (BLE, Wi-Fi, ledc, esp_...), but the selected "
                       f"board is {board.name}. Choose 'ESP32 DevKit' in the Board menu. Nothing was saved.", 422)
    if board.id == "nucleo_f446re_arduino":
        return                                    # HAL calls inside an Arduino sketch are fine on STM32duino
    if board.language == "arduino" and looks_stm32 and not looks_arduino:
        raise DevError(f"This looks like STM32 HAL code, but the selected board is {board.name}. "
                       "Choose 'STM32 NUCLEO-F446RE' in the Board menu. Nothing was saved.", 422)
