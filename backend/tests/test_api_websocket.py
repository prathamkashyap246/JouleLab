import time

from fastapi.testclient import TestClient

from app.main import app
from helpers import stream


def test_endpoints_validate_and_explain():
    with TestClient(app) as c:
        assert c.get("/").json()["hardware_connected"] is False
        assert "ports" in c.get("/api/hardware/ports").json()
        st = c.get("/api/hardware/status").json()
        assert st["state"] == "disconnected" and st["connected"] is False
        r = c.post("/api/hardware/connect", json={"port": "/dev/does-not-exist"})
        assert r.status_code == 404 and "not found" in r.json()["detail"]
        assert c.post("/api/hardware/connect", json={"port": "x", "baudrate": "fast"}).status_code == 422
        assert c.post("/api/sessions/start", json={}).status_code == 409
        assert c.post("/api/sessions/stop").status_code == 409
        assert c.get("/api/sessions/99999").status_code == 404
        assert c.get("/api/measurements/history?session_id=99999").status_code == 404
        assert c.get("/api/measurements/history?seconds=0").status_code == 422
        assert c.get("/api/measurements/latest").json()["sample"] is None
        s = c.get("/api/measurements/summary").json()
        assert s["scope"] == "connection" and s["functions"] == []
        r = c.post("/api/optimizer/suggest", json={"source_code": "void loop(){}"})
        assert r.status_code == 200 and "not configured" in r.json()["report"]["summary"]
        assert r.json()["report_id"] >= 1


def test_websocket_streams_measurements_to_multiple_clients():
    with TestClient(app) as c:
        hw = c.app.state.hardware
        hw.settings.allow_test_sources = True
        try:
            with c.websocket_connect("/ws/live-data") as a, c.websocket_connect("/ws/live-data") as b:
                assert a.receive_json()["type"] == "snapshot"
                assert b.receive_json()["type"] == "snapshot"
                hw._on_bytes(stream(200, flags=1))  # feed packets as the serial thread would
                for ws in (a, b):
                    got = []
                    end = time.time() + 5
                    while time.time() < end and not got:
                        m = ws.receive_json()
                        if m["type"] == "live" and m["samples"]:
                            got = m["samples"]
                            status = m["status"]
                    s = got[-1]
                    for key in ("t_us", "voltage_v", "current_ma", "power_mw", "energy_mj", "function", "source"):
                        assert key in s
                    assert s["voltage_v"] == 3.3 and s["current_ma"] == 10.0 and s["source"] == "test"
                    for key in ("state", "connected", "packet_count", "packet_errors", "lost_samples"):
                        assert key in status
                    assert status["packet_count"] >= 200
        finally:
            hw.settings.allow_test_sources = False
