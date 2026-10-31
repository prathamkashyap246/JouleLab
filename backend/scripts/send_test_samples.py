"""DEVELOPMENT / TEST ONLY: transmit JouleLab protocol packets that do NOT come from an INA219.

Every stream starts with a HELLO packet carrying FLAG_TEST_SOURCE, so the
backend labels the data "TEST" and rejects it unless ALLOW_TEST_SOURCES=true.
Use it to verify the decoder, the serial path and the UI without a board.

Modes
  --virtual          create a virtual serial port (macOS/Linux) and stream to it.
                     The script prints the port path; connect to it from the UI or
                     with scripts/test_serial.py --port <path> --allow-test.
  --port PATH        write to a real serial port (e.g. one end of a com0com pair on
                     Windows, or a USB-UART looped into another port).
  --known            send the fixed known-vector packets (also used in tests) and exit.

Examples
  python scripts/send_test_samples.py --virtual
  python scripts/send_test_samples.py --port COM11 --rate 500 --corrupt-every 200 --drop-every 300
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.hardware import stm32_protocol as P  # noqa: E402

# A repeating firmware-like loop: (function id, name, duration ms, current mA)
LOOP = [(1, "sensor_read", 20, 12.0), (2, "compute", 50, 31.0), (3, "send_data", 30, 88.0), (4, "idle_sleep", 100, 4.2)]

# Known vectors: (description, packet bytes). Shared with tests/test_packet_decoder.py.
KNOWN_VECTORS = [
    ("HELLO test source", P.hello(P.FLAG_TEST_SOURCE, 0)),
    ("MEASUREMENT 25000 uA @ 3300 mV seq 0", P.measurement(25_000, 3300, 0)),
    ("TIME_SYNC t=1000000 us period=2000 us seq 0", P.time_sync(1_000_000, 2000, 0)),
    ("MEASUREMENT 25100 uA @ 3298 mV seq 1", P.measurement(25_100, 3298, 1)),
    ("MEASUREMENT -150 uA @ 3301 mV seq 2", P.measurement(-150, 3301, 2)),
    ("FUNCTION_START id 1 t=1004000", P.function_start(1, 1_004_000, 2)),
    ("MEASUREMENT 26000 uA @ 3297 mV seq 3", P.measurement(26_000, 3297, 3)),
    ("FUNCTION_END id 1 t=1005500", P.function_end(1, 1_005_500, 3)),
    ("MEASUREMENT 25000 uA @ 3300 mV seq 4", P.measurement(25_000, 3300, 4)),
]


class Sink:
    """Writes bytes to a serial port or the master side of a pseudo-terminal."""

    def __init__(self, args) -> None:
        self.dropped = 0
        self.sent = 0
        self.ser = None
        self.fd = None
        if args.virtual:
            if os.name != "posix":
                sys.exit("--virtual needs macOS or Linux. On Windows install com0com and use --port COMx.")
            import pty
            import termios
            import tty
            master, slave = pty.openpty()
            tty.setraw(slave)  # no newline translation: this carries binary data
            attrs = termios.tcgetattr(slave)
            attrs[3] &= ~termios.ECHO
            termios.tcsetattr(slave, termios.TCSANOW, attrs)
            os.set_blocking(master, False)
            self.fd, self._slave = master, slave
            self.path = os.ttyname(slave)
        else:
            import serial
            self.ser = serial.Serial(args.port, args.baud, timeout=0, write_timeout=0)
            self.path = args.port

    def write(self, data: bytes) -> None:
        if self.fd is not None:
            try:
                n = os.write(self.fd, data)
                self.sent += n
                self.dropped += len(data) - n
            except BlockingIOError:  # nobody reading: bytes are lost, like a UART with no listener
                self.dropped += len(data)
        else:
            try:
                self.sent += self.ser.write(data) or 0
            except Exception:  # noqa: BLE001
                self.dropped += len(data)


def stream(args, sink: Sink) -> None:
    period_us = int(1e6 / args.rate)
    t_us = 0
    seq = 0
    k = 0
    loop_ms = sum(x[2] for x in LOOP)
    start = time.perf_counter()
    end_at = start + args.duration if args.duration else None
    current_fn = None
    print(f"Streaming TEST packets at {args.rate} Hz to {sink.path} (Ctrl+C to stop)", flush=True)
    last_report = start
    while end_at is None or time.perf_counter() < end_at:
        # figure out which "function" the fake loop is in at time t_us
        pos_ms = (t_us / 1000) % loop_ms
        acc = 0
        for fid, _name, dur, ma in LOOP:
            if pos_ms < acc + dur:
                break
            acc += dur
        out = bytearray()
        if current_fn != fid:
            if current_fn is not None:
                out += P.function_end(current_fn, t_us, seq)
            out += P.function_start(fid, t_us, seq)
            current_fn = fid
        if k % 500 == 0:
            out += P.hello(P.FLAG_TEST_SOURCE, seq)
        ripple = 1 + 0.03 * math.sin(k * 0.7)
        cur_ua = int(ma * 1000 * ripple)
        mv = 3300 - int(cur_ua / 1000 * 0.4)  # small droop under load
        if not (args.drop_every and k and k % args.drop_every == 0):
            pkt = bytearray(P.measurement(cur_ua, mv, seq))
            if args.corrupt_every and k and k % args.corrupt_every == 0:
                pkt[5] ^= 0x40  # flip a bit: the CRC must reject it
            out += pkt
        if k % 100 == 0:
            out += P.time_sync(t_us, period_us, seq)
        sink.write(bytes(out))
        k += 1
        seq = (seq + 1) & 0xFF
        t_us += period_us
        # real-time pacing
        target = start + k * period_us / 1e6
        delay = target - time.perf_counter()
        if delay > 0:
            time.sleep(delay)
        now = time.perf_counter()
        if now - last_report > 5:
            last_report = now
            print(f"  {k} samples, {sink.sent} bytes sent, {sink.dropped} bytes dropped (no reader)", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--virtual", action="store_true", help="create a virtual serial port (macOS/Linux)")
    g.add_argument("--port", help="serial port to write to")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--rate", type=float, default=500, help="samples per second (default 500)")
    ap.add_argument("--duration", type=float, default=0, help="seconds to run (0 = forever)")
    ap.add_argument("--known", action="store_true", help="send the known-vector packets once and exit")
    ap.add_argument("--corrupt-every", type=int, default=0, help="corrupt every Nth measurement (tests CRC)")
    ap.add_argument("--drop-every", type=int, default=0, help="skip every Nth measurement (tests loss detection)")
    ap.add_argument("--wait", type=float, default=0, help="seconds to wait before sending (time to connect)")
    args = ap.parse_args()

    sink = Sink(args)
    print(f"TEST SOURCE port: {sink.path}", flush=True)
    if args.wait:
        time.sleep(args.wait)
    try:
        if args.known:
            for desc, pkt in KNOWN_VECTORS:
                print(f"  {pkt.hex(' ')}   {desc}")
                sink.write(pkt)
                time.sleep(0.01)
            time.sleep(0.5)
        else:
            stream(args, sink)
    except KeyboardInterrupt:
        pass
    print(f"Done: {sink.sent} bytes sent, {sink.dropped} dropped.")


if __name__ == "__main__":
    main()
