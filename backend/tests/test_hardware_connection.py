"""Real serial I/O through a pseudo-terminal pair (macOS/Linux)."""
import asyncio
import os
import time

import pytest

from app.core.config import Settings
from app.database.database import Database
from app.hardware.connection_manager import HardwareError, HardwareManager
from app.services.measurement_store import LiveStore
from helpers import stream

pytestmark = pytest.mark.skipif(os.name != "posix", reason="needs a POSIX pseudo-terminal")


@pytest.fixture
def pty_port():
    import pty
    import tty
    master, slave = pty.openpty()
    tty.setraw(slave)
    yield master, os.ttyname(slave)
    for fd in (master, slave):
        try:
            os.close(fd)
        except OSError:
            pass


def manager(tmp_path, allow_test):
    s = Settings()
    s.allow_test_sources = allow_test
    s.stall_timeout_s = 0.5
    return HardwareManager(s, Database(str(tmp_path / "hw.db")), LiveStore())


def wait_for(cond, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


def test_streams_over_serial_and_reports_counts(tmp_path, pty_port):
    master, path = pty_port
    hw = manager(tmp_path, allow_test=True)

    async def go():
        st = await hw.connect(path, 115200)
        assert st["state"] == "waiting_for_data" and st["connected"] is False  # open port != connected board
        os.write(master, stream(300, flags=1))
        assert await asyncio.to_thread(wait_for, lambda: hw.status()["connected"])
        st = hw.status()
        assert st["state"] == "streaming" and st["test_source"] is True and st["source"] == "test"
        assert st["packet_count"] > 300 and st["packet_errors"] == 0
        assert hw.store.latest()["source"] == "test"
        assert await asyncio.to_thread(wait_for, lambda: hw.status()["state"] == "stalled", 3)
        st = await hw.disconnect()
        assert st["state"] == "disconnected" and st["port"] is None

    asyncio.run(go())


def test_test_source_rejected_by_default(tmp_path, pty_port):
    master, path = pty_port
    hw = manager(tmp_path, allow_test=False)

    async def go():
        hw.attach_loop(asyncio.get_running_loop())
        await hw.connect(path, 115200)
        os.write(master, stream(300, flags=1))
        for _ in range(60):
            await asyncio.sleep(0.05)
            if hw.status()["state"] == "error":
                break
        st = hw.status()
        assert st["state"] == "error" and "TEST packets" in st["message"]
        assert hw.store.latest() is None  # nothing from the test source reached the live data
        for _ in range(60):  # the manager closes the port itself; wait for that before the loop ends
            if hw._reader is None:
                break
            await asyncio.sleep(0.05)
        await hw.disconnect()

    asyncio.run(go())


def test_bytes_without_valid_packets_explained(tmp_path, pty_port):
    master, path = pty_port
    hw = manager(tmp_path, allow_test=True)

    async def go():
        await hw.connect(path, 115200)
        os.write(master, b"Hello from some other firmware\r\n" * 5)
        assert await asyncio.to_thread(wait_for, lambda: hw.decoder.stats.bytes_received > 0)
        st = hw.status()
        assert st["state"] == "waiting_for_data" and "none are valid" in st["message"]
        await hw.disconnect()

    asyncio.run(go())


def test_connect_errors(tmp_path):
    hw = manager(tmp_path, allow_test=True)

    async def go():
        with pytest.raises(HardwareError) as e:
            await hw.connect("/dev/nope-not-a-port", 115200)
        assert e.value.status_code == 404
        with pytest.raises(HardwareError, match="baud"):
            await hw.connect("/dev/nope", 12345)
        with pytest.raises(HardwareError, match="Connect the board"):
            hw.start_session("x", None)

    asyncio.run(go())


def test_session_saved_with_summary(tmp_path, pty_port):
    master, path = pty_port
    hw = manager(tmp_path, allow_test=True)

    async def go():
        await hw.connect(path, 115200)
        os.write(master, stream(50, flags=1))
        assert await asyncio.to_thread(wait_for, lambda: hw.status()["connected"])
        sess = hw.start_session("bench", "notes")
        os.write(master, stream(400, flags=1, start_seq=50, t0=1_000_000 + 50 * 2000)[11:])
        assert await asyncio.to_thread(wait_for, lambda: hw._session_engine.sample_count >= 390)
        done = hw.stop_session()
        assert done["status"] == "completed" and done["source"] == "test"
        assert done["energy_mj"] > 0 and done["stored_samples"] >= 39
        assert hw.db.session_samples(sess["id"], 10)
        await hw.disconnect()

    asyncio.run(go())


def test_full_rate_session_feeds_module_separation(tmp_path, pty_port):
    master, path = pty_port
    hw = manager(tmp_path, allow_test=True)

    async def go():
        await hw.connect(path, 115200)
        os.write(master, stream(50, flags=1))
        assert await asyncio.to_thread(wait_for, lambda: hw.status()["connected"])
        sess = hw.start_session("full", None, full_rate=True)
        assert sess["store_decimation"] == 1
        os.write(master, stream(400, flags=1, start_seq=50, t0=1_000_000 + 50 * 2000)[11:])
        assert await asyncio.to_thread(wait_for, lambda: hw._session_engine.sample_count >= 390)
        done = hw.stop_session()
        assert done["stored_samples"] >= 390  # one row per sample
        await hw.disconnect()

    asyncio.run(go())
