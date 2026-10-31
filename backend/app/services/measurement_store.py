"""Recent live samples (thread-safe) and the WebSocket broadcaster.

The serial thread pushes samples here; one asyncio task drains them at
WS_BROADCAST_HZ and fans the batch out to every connected browser. Each
browser has a bounded queue: a slow client loses its own oldest messages
and never stalls acquisition or other clients.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections import deque
from typing import Callable

log = logging.getLogger("joulelab.live")


class LiveStore:
    def __init__(self, max_samples: int = 120_000) -> None:
        self._lock = threading.Lock()
        self._recent: deque[dict] = deque(maxlen=max_samples)
        self._pending: list[dict] = []
        self._events: list[dict] = []

    def clear(self) -> None:
        with self._lock:
            self._recent.clear()
            self._pending.clear()
            self._events.clear()

    def push_samples(self, samples: list[dict]) -> None:
        if not samples:
            return
        with self._lock:
            self._recent.extend(samples)
            self._pending.extend(samples)
            if len(self._pending) > 50_000:  # no broadcaster running (e.g. tests): keep memory bounded
                del self._pending[:-50_000]

    def push_event(self, event: dict) -> None:
        with self._lock:
            self._events.append({**event, "received_at": time.time()})
            if len(self._events) > 1000:
                del self._events[:-1000]

    def drain(self) -> tuple[list[dict], list[dict]]:
        with self._lock:
            s, e = self._pending, self._events
            self._pending, self._events = [], []
        return s, e

    def latest(self) -> dict | None:
        with self._lock:
            return self._recent[-1] if self._recent else None

    def history(self, seconds: float | None, limit: int) -> list[dict]:
        with self._lock:
            data = list(self._recent)
        if seconds and data:
            t_end = data[-1]["t_us"]
            start = t_end - seconds * 1e6
            data = [x for x in data if x["t_us"] >= start]
        return data[-limit:]


def thin(samples: list[dict], max_n: int) -> list[dict]:
    """Keep at most max_n samples for display (every k-th, always including the last)."""
    if len(samples) <= max_n:
        return samples
    step = len(samples) / max_n
    out = [samples[int(i * step)] for i in range(max_n)]
    out[-1] = samples[-1]
    return out


class LiveHub:
    def __init__(self, store: LiveStore, status_fn: Callable[[], dict], hz: float, max_per_msg: int) -> None:
        self.store = store
        self.status_fn = status_fn
        self.period = 1.0 / max(hz, 1.0)
        self.max_per_msg = max_per_msg
        self.clients: set[asyncio.Queue] = set()
        self._task: asyncio.Task | None = None
        self.dropped_messages = 0

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self.clients.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.clients.discard(q)

    def snapshot(self, seconds: float = 5.0) -> dict:
        return {"type": "snapshot", "status": self.status_fn(),
                "samples": thin(self.store.history(seconds, 100_000), 2000)}

    def _offer(self, msg: dict) -> None:
        for q in list(self.clients):
            if q.full():
                try:
                    q.get_nowait()
                    self.dropped_messages += 1
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(msg)

    async def run(self) -> None:
        last_status_sent = 0.0
        while True:
            await asyncio.sleep(self.period)
            try:
                samples, events = self.store.drain()
                now = time.monotonic()
                if not samples and not events and now - last_status_sent < 1.0:
                    continue
                last_status_sent = now
                if not self.clients:
                    continue
                self._offer({"type": "live", "status": self.status_fn(),
                             "samples": thin(samples, self.max_per_msg),
                             "sample_count": len(samples), "events": events})
            except Exception:  # noqa: BLE001 - the broadcaster must never die
                log.exception("live broadcast failed")

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self.run(), name="live-broadcaster")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
