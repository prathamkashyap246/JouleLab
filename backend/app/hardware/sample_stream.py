"""Packets -> timed samples and events.

Timing model (see docs/PROTOCOL.md §4): the board samples the INA219 on a
hardware timer with a fixed period. MEASUREMENT packets carry an 8-bit
sample counter (seq); TIME_SYNC packets map one seq to the board's 1 MHz
clock and announce the period. The host therefore timestamps each sample as

    t(k) = t_anchor + (k - k_anchor) * period

using the board's crystal, so USB/OS latency never distorts the time axis.

Samples are only released after a HELLO (identifies real hardware vs a
test generator) and a TIME_SYNC have been received.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.hardware.stm32_protocol import (
    DEVICE_STATUS_TEXT,
    FLAG_TEST_SOURCE,
    PROTOCOL_MAGIC,
    DeviceStatus,
    Packet,
    PacketType,
)

WRAP = 1 << 32
HALF = 1 << 31
RESET_BACKSTEP_US = 1_000_000  # board clock jumping back > 1 s (and not a wrap) = board reset
MAX_PENDING = 512


@dataclass
class RawSample:
    index: int  # unwrapped sample number since the stream (epoch) started
    t_us: int  # board time, µs, unwrapped
    current_ua: int
    voltage_mv: int
    epoch: int  # increments on every resync/reset; never integrate across epochs
    contiguous: bool  # True when the previous sample (index - 1, same epoch) was received


@dataclass
class StreamStats:
    measurement_packets: int = 0
    samples_released: int = 0
    lost_samples: int = 0
    duplicates: int = 0
    unsynced_samples: int = 0  # received before HELLO + TIME_SYNC; not used
    resyncs: int = 0
    firmware_resets: int = 0
    device_status_packets: int = 0
    unknown_function_ids: int = 0

    def as_dict(self) -> dict:
        return dict(self.__dict__)


@dataclass
class StreamState:
    hello_seen: bool = False
    test_source: bool = False
    protocol_ok: bool = True
    period_us: int | None = None
    device_errors: list = field(default_factory=list)


class SampleStream:
    def __init__(self) -> None:
        self.stats = StreamStats()
        self.state = StreamState()
        self.epoch = 0
        self._last_seq: int | None = None
        self._k = -1
        self._anchor: tuple[int, int] | None = None  # (k, t_us)
        self._pending: list[tuple[int, int, int]] = []  # (k, current_ua, voltage_mv) awaiting first sync
        self._t_offset = 0
        self._t_last: int | None = None
        self._last_released_k: int | None = None

    # ---- time helpers --------------------------------------------------
    def _unwrap(self, raw: int) -> int:
        t = self._t_offset + raw
        if self._t_last is not None:
            if t < self._t_last - HALF:
                self._t_offset += WRAP
                t += WRAP
            elif t > self._t_last + HALF:
                return t - WRAP  # late packet from just before a wrap
        self._t_last = t if self._t_last is None else max(self._t_last, t)
        return t

    def _new_epoch(self) -> None:
        self.epoch += 1
        self._last_released_k = None

    def _time_of(self, k: int) -> int:
        ak, at = self._anchor  # type: ignore[misc]
        return at + (k - ak) * self.state.period_us  # type: ignore[operator]

    def _release(self, k: int, cur: int, mv: int) -> RawSample:
        contiguous = self._last_released_k is not None and k == self._last_released_k + 1
        self._last_released_k = k
        self.stats.samples_released += 1
        return RawSample(k, self._time_of(k), cur, mv, self.epoch, contiguous)

    @property
    def ready(self) -> bool:
        return self.state.hello_seen and self._anchor is not None

    # ---- main entry ----------------------------------------------------
    def process(self, packets: list[Packet]) -> list[tuple[str, object]]:
        """Return a list of events: ("sample", RawSample), ("marker", dict),
        ("device_status", dict), ("hello", dict), ("resync", dict), ("loss", dict)."""
        out: list[tuple[str, object]] = []
        for p in packets:
            t = p.type
            if t == PacketType.MEASUREMENT:
                self._on_measurement(p, out)
            elif t == PacketType.TIME_SYNC:
                self._on_time_sync(p, out)
            elif t == PacketType.HELLO:
                self._on_hello(p, out)
            elif t in (PacketType.FUNCTION_START, PacketType.FUNCTION_END):
                out.append(("marker", {"source": "firmware", "start": t == PacketType.FUNCTION_START,
                                       "function_id": p.function_id, "t_us": self._unwrap(p.value1)}))
            elif t == PacketType.GPIO_EDGE:
                out.append(("marker", {"source": "gpio", "start": p.gpio_level == 1,
                                       "channel": p.gpio_channel, "t_us": self._unwrap(p.value1)}))
            elif t == PacketType.DEVICE_STATUS:
                self.stats.device_status_packets += 1
                code = p.value2
                try:
                    text = DEVICE_STATUS_TEXT[DeviceStatus(code)]
                except ValueError:
                    text = f"Unknown device status code {code}"
                ev = {"code": code, "detail": p.value1, "message": text}
                self.state.device_errors = (self.state.device_errors + [ev])[-20:]
                out.append(("device_status", ev))
        return out

    def _on_hello(self, p: Packet, out: list) -> None:
        if p.value1 != PROTOCOL_MAGIC:
            self.state.protocol_ok = False
            out.append(("hello", {"ok": False, "magic": p.value1}))
            return
        first = not self.state.hello_seen
        self.state.hello_seen = True
        self.state.protocol_ok = True
        self.state.test_source = bool(p.value2 & FLAG_TEST_SOURCE)
        if first:
            out.append(("hello", {"ok": True, "test_source": self.state.test_source, "flags": p.value2}))

    def _on_measurement(self, p: Packet, out: list) -> None:
        self.stats.measurement_packets += 1
        seq = p.seq
        if self._last_seq is None:
            self._k = 0
        else:
            delta = (seq - self._last_seq) & 0xFF
            if delta == 0:
                self.stats.duplicates += 1
                return
            if delta > 1:
                self.stats.lost_samples += delta - 1
                out.append(("loss", {"lost": delta - 1, "at_index": self._k + 1}))
            self._k += delta
        self._last_seq = seq

        if not self.state.hello_seen:
            self.stats.unsynced_samples += 1
            return
        if self._anchor is None:
            self._pending.append((self._k, p.current_ua, p.voltage_mv))
            if len(self._pending) > MAX_PENDING:
                self._pending.pop(0)
                self.stats.unsynced_samples += 1
            return
        out.append(("sample", self._release(self._k, p.current_ua, p.voltage_mv)))

    def _on_time_sync(self, p: Packet, out: list) -> None:
        period = p.value2
        if period == 0 or self._last_seq is None:
            return
        t = self._unwrap(p.value1)
        # The sync refers to sample `seq`: normally the latest one received, but that measurement itself
        # may have been lost or corrupted, so the difference can be either sign.
        d = ((p.seq - self._last_seq + 128) & 0xFF) - 128
        k_s = self._k + d

        if self._anchor is not None and self.state.period_us:
            ak, at = self._anchor
            if t < at - RESET_BACKSTEP_US:
                # board clock went backwards: firmware restarted
                self.stats.firmware_resets += 1
                self._new_epoch()
                out.append(("resync", {"reason": "firmware reset detected"}))
            else:
                predicted = at + (k_s - ak) * self.state.period_us
                drift = t - predicted
                if abs(drift) > self.state.period_us // 2:
                    missing = round(drift / self.state.period_us)
                    self.stats.resyncs += 1
                    if missing > 0:  # lost a multiple of 256 samples: the 8-bit seq could not show it
                        self.stats.lost_samples += missing
                        self._k += missing
                        k_s += missing
                    self._new_epoch()
                    out.append(("resync", {"reason": "sample counter and board clock disagree",
                                           "missing_samples": missing}))
        self.state.period_us = period
        self._anchor = (k_s, t)

        if self._pending and self.state.hello_seen:
            for k, cur, mv in self._pending:
                out.append(("sample", self._release(k, cur, mv)))
            self._pending.clear()

    def snapshot(self) -> dict:
        return {
            **self.stats.as_dict(),
            "hello_seen": self.state.hello_seen,
            "synced": self._anchor is not None,
            "test_source": self.state.test_source,
            "protocol_ok": self.state.protocol_ok,
            "sample_period_us": self.state.period_us,
            "device_errors": self.state.device_errors[-5:],
        }
