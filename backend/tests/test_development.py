"""Workspace development API: build / upload / debug / stop, output streaming, the shared
serial port, and the local-only rule.

PlatformIO itself is replaced by a small stand-in script (FAKE pio) so these tests check
JouleLab's process handling, not compilers. Real PlatformIO builds need the toolchains."""
import os
import sys
import time

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

pytestmark = pytest.mark.skipif(os.name != "posix", reason="stand-in pio script needs a POSIX shell")

FAKE = f"""#!{sys.executable}
import os, sys, time
a = sys.argv[1:]
if a[:1] == ["--version"]:
    print("PlatformIO Core, version 0.0 (FAKE pio for tests)"); sys.exit(0)
if a[0] == "debug":
    print("FAKE gdb ready", flush=True)
    for line in sys.stdin:
        print("FAKE gdb got: " + line.strip(), flush=True)
        if line.strip() == "quit":
            sys.exit(0)
    sys.exit(0)
print("Processing " + a[a.index("-e") + 1], flush=True)
print("Compiling FAKE", flush=True)
if "--upload-port" in a:
    print("Uploading to " + a[a.index("--upload-port") + 1], flush=True)
time.sleep(float(os.environ.get("FAKE_PIO_SLEEP", "0.2")))
sys.exit(int(os.environ.get("FAKE_PIO_EXIT", "0")))
"""


@pytest.fixture
def client(tmp_path, monkeypatch):
    fake = tmp_path / "pio"
    fake.write_text(FAKE)
    fake.chmod(0o755)
    monkeypatch.setattr(settings, "pio_path", str(fake))
    monkeypatch.setenv("FAKE_PIO_EXIT", "0")
    monkeypatch.setenv("FAKE_PIO_SLEEP", "0.2")
    with TestClient(app) as c:
        c.app.state.pio.projects_dir = tmp_path / "projects"
        yield c


def wait_job(c, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        j = c.get("/api/development/job").json()
        if j["job"] and not j["busy"]:
            return j["job"]
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_boards_and_projects(client):
    d = client.get("/api/development/boards").json()
    assert [b["id"] for b in d["boards"]] == ["nucleo_f446re", "esp32dev", "uno"]
    assert d["platformio"]["installed"] and "FAKE" in d["platformio"]["version"]
    p = client.get("/api/development/project/nucleo_f446re").json()
    assert p["main_file"] == "Core/Src/main.c" and "jl_init" in p["source"]
    proj = client.app.state.pio.projects_dir / "nucleo_f446re"
    assert (proj / "Drivers").is_dir() and (proj / "STM32F446RETX_FLASH.ld").exists()
    assert not (proj / "Makefile").exists()  # PlatformIO project only
    assert "setup()" in client.get("/api/development/project/esp32dev").json()["source"]
    assert client.get("/api/development/project/nope").status_code == 404


def test_build_success_streams_output(client):
    with client.websocket_connect("/ws/build-output") as ws:
        assert ws.receive_json()["type"] == "snapshot"
        r = client.post("/api/development/build", json={"board": "uno", "source": "void setup(){}\nvoid loop(){}\n"})
        assert r.status_code == 200 and r.json()["status"] == "running"
        lines, final = [], None
        while final is None:
            m = ws.receive_json()
            if m["type"] == "line":
                lines.append(m["text"])
            elif m["type"] == "job" and m["job"]["status"] != "running":
                final = m["job"]
    assert final["status"] == "succeeded" and final["exit_code"] == 0
    assert "Processing uno" in lines and any("Saved the editor to src/main.ino" in x for x in lines)
    assert client.get("/api/development/project/uno").json()["source"].startswith("void setup(){}")


def test_build_failure_is_reported_as_failure(client, monkeypatch):
    monkeypatch.setenv("FAKE_PIO_EXIT", "1")
    client.post("/api/development/build", json={"board": "nucleo_f446re"})
    job = wait_job(client)
    assert job["status"] == "failed" and job["exit_code"] == 1


def test_one_job_at_a_time_and_stop(client, monkeypatch):
    monkeypatch.setenv("FAKE_PIO_SLEEP", "30")
    assert client.post("/api/development/build", json={"board": "uno"}).status_code == 200
    r = client.post("/api/development/upload", json={"board": "nucleo_f446re"})
    assert r.status_code == 409
    t = time.time()
    s = client.post("/api/development/stop").json()
    assert s["stopped"] and s["job"]["status"] == "cancelled"
    assert time.time() - t < 8
    assert client.post("/api/development/stop").json()["stopped"] is False


def test_upload_validation(client):
    r = client.post("/api/development/upload", json={"board": "esp32dev"})
    assert r.status_code == 400 and "serial port" in r.json()["detail"]
    r = client.post("/api/development/upload", json={"board": "esp32dev", "port": "/dev/not-a-port"})
    assert r.status_code == 404
    r = client.post("/api/development/build", json={"board": "uno", "source": "   "})
    assert r.status_code == 400 and "empty" in r.json()["detail"]


def test_stlink_upload_needs_no_port(client):
    r = client.post("/api/development/upload", json={"board": "nucleo_f446re"})
    assert r.status_code == 200
    job = wait_job(client)
    assert job["status"] == "succeeded" and "-t upload" in job["command"] and "--upload-port" not in job["command"]


def test_serial_upload_borrows_the_shared_port_and_gives_it_back(client, monkeypatch):
    import pty
    import tty
    master, slave = pty.openpty()
    tty.setraw(slave)
    path = os.ttyname(slave)
    try:
        assert client.post("/api/hardware/connect", json={"port": path}).status_code == 200
        monkeypatch.setenv("FAKE_PIO_SLEEP", "1.0")
        r = client.post("/api/development/upload", json={"board": "esp32dev", "port": path})
        assert r.status_code == 200 and f"--upload-port {path}" in r.json()["command"]
        st = client.get("/api/hardware/status").json()
        assert st["state"] == "paused" and st["port"] == path  # released, nobody else holds it
        job = wait_job(client)
        assert job["status"] == "succeeded"
        st = client.get("/api/hardware/status").json()
        assert st["state"] == "waiting_for_data" and st["port"] == path  # reopened by the same manager
        os.write(master, b"hello from the sketch\n")
        with client.websocket_connect("/ws/serial-monitor") as ws:
            first = ws.receive_json()
            text = first["text"]
            end = time.time() + 5
            while "hello from the sketch" not in text and time.time() < end:
                text += ws.receive_json().get("text", "")
        assert "hello from the sketch" in text and "lent to the ESP32 DevKit upload" in text
    finally:
        client.post("/api/hardware/disconnect")
        os.close(master)
        os.close(slave)


def test_debug_session_takes_gdb_commands(client):
    assert client.post("/api/development/debug/start", json={"board": "uno"}).status_code == 400
    with client.websocket_connect("/ws/build-output") as ws:
        ws.receive_json()
        r = client.post("/api/development/debug/start", json={"board": "nucleo_f446re"})
        assert r.status_code == 200 and "debug" in r.json()["command"] and "--interface=gdb" in r.json()["command"]
        assert client.get("/api/development/debug/status").json()["active"] is True
        assert client.post("/api/development/build", json={"board": "uno"}).status_code == 409
        assert client.post("/api/development/debug/command", json={"command": "info registers"}).status_code == 200
        seen = ""
        end = time.time() + 5
        while "FAKE gdb got: info registers" not in seen and time.time() < end:
            m = ws.receive_json()
            seen += m.get("text", "") + "\n"
        assert "FAKE gdb got: info registers" in seen
    stopped = client.post("/api/development/debug/stop").json()["job"]
    assert stopped["status"] in ("cancelled", "succeeded")
    assert client.post("/api/development/debug/command", json={"command": "bt"}).status_code == 409


def test_remote_clients_are_refused(client):
    r = client.post("/api/development/build", json={"board": "uno"}, headers={"X-Forwarded-For": "192.168.1.50"})
    assert r.status_code == 403 and "DEV_ALLOW_REMOTE" in r.json()["detail"]
    r = client.post("/api/firmware/upload", json={"board": "ESP32", "source_code": "x"},
                    headers={"X-Forwarded-For": "10.0.0.7"})
    assert r.status_code == 403


def test_reset_project_restores_template(client):
    client.put("/api/development/project/uno", json={"source": "broken"})
    assert client.get("/api/development/project/uno").json()["source"] == "broken"
    restored = client.post("/api/development/project/uno/reset").json()["source"]
    assert "JouleLab example for Arduino Uno" in restored


def test_legacy_firmware_upload_really_runs_upload(client):
    r = client.post("/api/firmware/upload", json={"board": "STM32", "source_code": "int main(void){for(;;);}"})
    assert r.status_code == 200 and r.json()["job"]["kind"] == "upload"
    assert wait_job(client)["status"] == "succeeded"


def test_terminal_send_reaches_the_board(client):
    import pty
    import tty
    assert client.post("/api/hardware/send", json={"text": "hi"}).status_code == 409  # not connected
    master, slave = pty.openpty()
    tty.setraw(slave)
    try:
        assert client.post("/api/hardware/connect", json={"port": os.ttyname(slave)}).status_code == 200
        r = client.post("/api/hardware/send", json={"text": "led on", "line_ending": "\r\n"})
        assert r.status_code == 200 and r.json()["sent_bytes"] == 8
        os.set_blocking(master, False)
        got, end = b"", time.time() + 3
        while b"led on\r\n" not in got and time.time() < end:
            try:
                got += os.read(master, 100)
            except BlockingIOError:
                time.sleep(0.05)
        assert got == b"led on\r\n"
        r = client.post("/api/hardware/send", json={"text": "x"}, headers={"X-Forwarded-For": "192.168.1.9"})
        assert r.status_code == 403
    finally:
        client.post("/api/hardware/disconnect")
        os.close(master)
        os.close(slave)
