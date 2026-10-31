#!/usr/bin/env python3
"""Check PlatformIO outside the website and print the exact reason a build fails.

Run from backend/ with the SAME venv the backend uses:

    python scripts/pio_doctor.py                 # environment checks only
    python scripts/pio_doctor.py --build uno     # also build a board: uno | esp32dev | nucleo_f446re

Paste the whole output when asking for help. Uses only the standard library.
"""
from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATES = {"uno": ROOT / "firmware/platformio_templates/uno",
             "esp32dev": ROOT / "firmware/platformio_templates/esp32dev",
             "nucleo_f446re": ROOT / "firmware/joulelab_f446re",
             "nucleo_f446re_arduino": ROOT / "firmware/platformio_templates/nucleo_f446re_arduino"}
IGNORE = shutil.ignore_patterns("build", "tests", ".pio", ".gitignore", "Makefile")


def ok(msg): print(f"  [ OK ] {msg}")
def bad(msg): print(f"  [FAIL] {msg}")
def info(msg): print(f"         {msg}")


def find_pio() -> list[str] | None:
    exe = "pio.exe" if os.name == "nt" else "pio"
    beside = Path(sys.executable).parent / exe
    if beside.exists():
        return [str(beside)]
    found = shutil.which("pio") or shutil.which("platformio")
    if found:
        return [found]
    try:
        import platformio  # noqa: F401
        return [sys.executable, "-m", "platformio"]
    except ImportError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", choices=sorted(TEMPLATES), help="also compile this board's project")
    args = ap.parse_args()
    problems = 0

    print("1. Python")
    ok(f"{sys.version.split()[0]} at {sys.executable}")
    if sys.version_info < (3, 9):
        bad("PlatformIO needs Python 3.9 or newer"); problems += 1
    if sys.version_info >= (3, 14):
        info("Python 3.14 is very new; if PlatformIO fails to install or run, use Python 3.11-3.13")

    print("2. pio command")
    cmd = find_pio()
    if not cmd:
        bad("pio not found. Run: python -m pip install platformio"); return 1
    ok("found: " + " ".join(cmd))
    r = subprocess.run(cmd + ["--version"], capture_output=True, text=True)
    if r.returncode:
        bad("pio --version failed:\n" + (r.stdout + r.stderr)); return 1
    ok(r.stdout.strip())

    print("3. Folders")
    home = Path(os.getenv("PLATFORMIO_CORE_DIR") or Path.home() / ".platformio")
    try:
        home.mkdir(parents=True, exist_ok=True)
        (home / ".w").write_text("x"); (home / ".w").unlink()
        ok(f"PlatformIO core folder is writable: {home}")
    except OSError as e:
        bad(f"cannot write to {home}: {e}"); problems += 1
    if any(s in str(ROOT) for s in ("OneDrive", "Dropbox", "iCloud")):
        bad(f"project is inside a synced folder ({ROOT}); move it, syncing breaks builds"); problems += 1
    if " " in str(home) and os.name == "nt":
        info("core folder path contains spaces; if a build fails with 'is not recognized', set "
             "PLATFORMIO_CORE_DIR=C:\\pio")

    print("4. Internet (needed once per board, to download its toolchain)")
    for host in ("registry.platformio.org", "dl.registry.platformio.org"):
        try:
            socket.create_connection((host, 443), timeout=8).close(); ok(host)
        except OSError as e:
            bad(f"{host}: {e}. Check network/proxy/firewall."); problems += 1

    print("5. Serial ports")
    try:
        from serial.tools import list_ports
        ports = list(list_ports.comports())
        for p in ports:
            ok(f"{p.device}  {p.description}")
        if not ports:
            info("no serial ports found (cable? driver? On Linux: dialout group)")
    except ImportError:
        info("pyserial not installed in this Python (backend requirement)")

    if args.build:
        print(f"6. Build {args.build} (first run downloads the toolchain; this can take minutes)")
        work = Path(tempfile.mkdtemp(prefix="jl_doctor_")) / args.build
        shutil.copytree(TEMPLATES[args.build], work, ignore=IGNORE)
        res = subprocess.run(cmd + ["run", "-d", str(work), "-e", args.build])
        if res.returncode:
            bad(f"build failed with exit code {res.returncode} (see output above)"); problems += 1
        else:
            ok("build succeeded")
    print("\nResult:", "all checks passed" if not problems else f"{problems} problem(s) found")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
