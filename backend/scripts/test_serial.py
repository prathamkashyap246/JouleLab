"""Check that a NUCLEO-F446RE running the JouleLab firmware is sending valid packets.

    python scripts/test_serial.py --list                 # show serial ports (ST-LINK flagged)
    python scripts/test_serial.py                        # auto-detect the ST-LINK port, read 10 s
    python scripts/test_serial.py --port /dev/cu.usbmodem1103 --seconds 5
    python scripts/test_serial.py --port COM5 --raw      # also print raw bytes in hex

Exit code 0 only when real (non-test) INA219 measurements were decoded.
Run this with the backend STOPPED (only one program can open a serial port).
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import serial  # noqa: E402

from app.hardware.packet_decoder import PacketDecoder  # noqa: E402
from app.hardware.sample_stream import SampleStream  # noqa: E402
from app.hardware.serial_reader import auto_detect_port, list_serial_ports, open_port  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="list serial ports and exit")
    ap.add_argument("--port", default="auto")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--seconds", type=float, default=10)
    ap.add_argument("--raw", action="store_true", help="print received bytes in hex")
    ap.add_argument("--allow-test", action="store_true", help="exit 0 for TEST-source packets too")
    args = ap.parse_args()

    ports = list_serial_ports()
    if args.list:
        if not ports:
            print("No serial ports found.")
        for p in ports:
            print(f"{'*' if p.is_stlink else ' '} {p.device:28} {p.description}  "
                  f"VID:PID={p.vid or 0:04X}:{p.pid or 0:04X}  serial={p.serial_number}")
        print("\n* = ST-LINK virtual COM port (the NUCLEO board)")
        return 0

    port = args.port
    if port == "auto":
        try:
            port = auto_detect_port()
        except ValueError as e:
            print(e)
            return 2
    try:
        ser = open_port(port, args.baud)
    except serial.SerialException as e:
        print(e)
        return 2
    print(f"Opened {port} at {args.baud} 8N1. Reading for {args.seconds:g} s… (press RESET on the board to see HELLO)")

    dec, stream = PacketDecoder(), SampleStream()
    shown = 0
    t_end = time.monotonic() + args.seconds
    try:
        while time.monotonic() < t_end:
            data = ser.read(4096)
            if not data:
                continue
            if args.raw:
                print("RX", data[:64].hex(" "), "…" if len(data) > 64 else "")
            for kind, ev in stream.process(dec.feed(data)):
                if kind == "hello":
                    print("HELLO:", "TEST SOURCE (not hardware)" if ev.get("test_source") else "JouleLab firmware", ev)
                elif kind == "device_status":
                    print("BOARD REPORTS:", ev["message"], f"(code {ev['code']}, detail {ev['detail']})")
                elif kind in ("loss", "resync"):
                    print(kind.upper() + ":", ev)
                elif kind == "marker":
                    print("MARKER:", ev)
                elif kind == "sample" and shown < 15:
                    v, i = ev.voltage_mv / 1000, ev.current_ua / 1000
                    print(f"  t={ev.t_us / 1000:10.3f} ms  V={v:6.3f} V  I={i:9.3f} mA  P={v * i:9.3f} mW")
                    shown += 1
    except KeyboardInterrupt:
        pass
    finally:
        ser.close()

    d, s = dec.stats, stream.snapshot()
    print("\nSummary")
    print(f"  bytes received     {d.bytes_received}")
    print(f"  valid packets      {d.packets_ok}")
    print(f"  checksum errors    {d.crc_errors}   unknown types {d.unknown_type}   bytes skipped {d.bytes_discarded}")
    print(f"  samples decoded    {s['samples_released']}   lost {s['lost_samples']}   duplicates {s['duplicates']}"
          f"   before sync {s['unsynced_samples']}")
    rate = 1e6 / s["sample_period_us"] if s["sample_period_us"] else None
    print(f"  sample period      {s['sample_period_us']} us" + (f" ({rate:g} Hz)" if rate else ""))

    if d.bytes_received == 0:
        print("\nFAIL: no bytes at all. Is the JouleLab firmware flashed? Press RESET (black button B2).")
        return 1
    if d.packets_ok == 0:
        print("\nFAIL: bytes arrive but none are valid JouleLab packets. Check baud rate and firmware.")
        return 1
    if s["samples_released"] == 0:
        print("\nFAIL: packets arrive but no measurements. See BOARD REPORTS above (INA219 wiring?).")
        return 1
    if s["test_source"]:
        print("\nOK, but these are TEST packets from send_test_samples.py, not INA219 measurements.")
        return 0 if args.allow_test else 3
    print("\nPASS: live INA219 measurements are arriving from the board.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
