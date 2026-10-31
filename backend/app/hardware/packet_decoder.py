"""Byte stream -> packets.

Handles: synchronisation on 0xAA 0x55, packets split across reads, garbage
between packets, CRC failures (resync one byte later, because 0xAA 0x55 can
appear inside a payload), and unknown packet types.

Nothing is dropped silently: every discarded byte or frame is counted in
`stats` and the most recent problems are kept in `recent_errors`.
"""
from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import asdict, dataclass
from typing import Callable

from app.hardware.stm32_protocol import PACKET_SIZE, SYNC, Packet, PacketType, crc8, parse

log = logging.getLogger("joulelab.decoder")
_KNOWN_TYPES = {int(t) for t in PacketType}
_MAX_BUFFER = 64 * 1024


@dataclass
class DecoderStats:
    bytes_received: int = 0
    packets_ok: int = 0
    crc_errors: int = 0
    unknown_type: int = 0
    bytes_discarded: int = 0  # bytes skipped while searching for 0xAA 0x55

    @property
    def packet_errors(self) -> int:
        return self.crc_errors + self.unknown_type

    def as_dict(self) -> dict:
        d = asdict(self)
        d["packet_errors"] = self.packet_errors
        return d


class PacketDecoder:
    def __init__(self, on_discard: Callable[[bytes], None] | None = None) -> None:
        # on_discard receives bytes that are not part of any packet (e.g. text printed by
        # firmware) so the serial monitor can show them.
        self._on_discard = on_discard
        self._buf = bytearray()
        self.stats = DecoderStats()
        self.recent_errors: deque[dict] = deque(maxlen=50)
        self._last_log = 0.0

    def reset(self) -> None:
        self._buf.clear()
        self.stats = DecoderStats()
        self.recent_errors.clear()

    def _error(self, kind: str, data: bytes) -> None:
        self.recent_errors.append({"time": time.time(), "kind": kind, "bytes": data.hex(" ")})
        now = time.monotonic()
        if now - self._last_log > 10:  # rate-limit logging, counters keep the full picture
            self._last_log = now
            log.warning("decoder: %s (%s) totals=%s", kind, data.hex(" "), self.stats.as_dict())

    def _discard(self, data: bytes) -> None:
        if self._on_discard is not None:
            try:
                self._on_discard(data)
            except Exception:  # noqa: BLE001 - the monitor must never break decoding
                log.exception("serial monitor callback failed")

    def feed(self, data: bytes) -> list[Packet]:
        self.stats.bytes_received += len(data)
        buf = self._buf
        buf.extend(data)
        out: list[Packet] = []

        while True:
            idx = buf.find(SYNC)
            if idx < 0:
                # keep a trailing 0xAA: it may be the first half of the next sync
                keep = 1 if buf[-1:] == SYNC[:1] else 0
                dropped = len(buf) - keep
                if dropped:
                    self.stats.bytes_discarded += dropped
                    self._error("no sync", bytes(buf[:dropped][:16]))
                    self._discard(bytes(buf[:dropped]))
                    del buf[:dropped]
                break
            if idx:
                self.stats.bytes_discarded += idx
                self._error("bytes before sync", bytes(buf[:idx][:16]))
                self._discard(bytes(buf[:idx]))
                del buf[:idx]
            if len(buf) < PACKET_SIZE:
                break  # incomplete packet: wait for more bytes
            frame = bytes(buf[:PACKET_SIZE])
            if crc8(frame[:10]) != frame[10]:
                self.stats.crc_errors += 1
                self._error("checksum mismatch", frame)
                del buf[:1]  # resync: the real packet may start inside this frame
                continue
            if frame[2] not in _KNOWN_TYPES:
                self.stats.unknown_type += 1
                self._error("unknown packet type", frame)
                del buf[:PACKET_SIZE]
                continue
            del buf[:PACKET_SIZE]
            self.stats.packets_ok += 1
            out.append(parse(frame))

        if len(buf) > _MAX_BUFFER:  # cannot happen with the logic above, but never grow unbounded
            self.stats.bytes_discarded += len(buf)
            buf.clear()
        return out
