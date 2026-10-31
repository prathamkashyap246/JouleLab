"""Serial monitor text, fed by the ONE shared serial connection (HardwareManager).

The board's port is opened only by HardwareManager. Bytes that are not JouleLab
packets (e.g. Serial.println() text from an ESP32/Uno sketch, or boot messages)
are passed here as text; JouleLab events (HELLO, board errors, connection
changes) are added as "[JouleLab] ..." lines. The monitor never opens a port.
"""
from __future__ import annotations

import asyncio
import codecs
import logging
import threading
import time
from collections import deque

log = logging.getLogger("joulelab.monitor")


class MonitorHub:
    def __init__(self, hz: float = 20.0, backlog_chars: int = 20_000) -> None:
        self._lock = threading.Lock()
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self._pending: list[str] = []
        self._backlog: deque[str] = deque()
        self._backlog_len = 0
        self._backlog_max = backlog_chars
        self.period = 1.0 / hz
        self.clients: set[asyncio.Queue] = set()
        self._task: asyncio.Task | None = None

    # ---- producers (any thread) -------------------------------------------
    def push_bytes(self, data: bytes) -> None:
        text = self._decoder.decode(data)
        if text:
            self._add(text.replace("\r\n", "\n").replace("\r", "\n"))

    def push_line(self, line: str) -> None:
        self._add(f"\n[JouleLab {time.strftime('%H:%M:%S')}] {line}\n")

    def _add(self, text: str) -> None:
        with self._lock:
            self._pending.append(text)
            self._backlog.append(text)
            self._backlog_len += len(text)
            while self._backlog_len > self._backlog_max and self._backlog:
                self._backlog_len -= len(self._backlog.popleft())

    def backlog(self) -> str:
        with self._lock:
            return "".join(self._backlog)

    # ---- consumers ---------------------------------------------------------
    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self.clients.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.clients.discard(q)

    async def run(self) -> None:
        while True:
            await asyncio.sleep(self.period)
            with self._lock:
                chunks, self._pending = self._pending, []
            if not chunks:
                continue
            msg = {"type": "text", "text": "".join(chunks)}
            for q in list(self.clients):
                if q.full():
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                q.put_nowait(msg)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self.run(), name="serial-monitor")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
