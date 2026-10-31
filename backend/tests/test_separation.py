from app.services import separation


def test_simulated_three_modules_are_separated():
    t, i, v, states, truth = separation.simulate(60, seed=0, sample_period_us=2000)
    r = separation.separate(t, i, v, None, states, truth)
    assert r["k"] == 3
    assert sorted(c["module"] for c in r["components"]) == ["BLE", "LED A", "LED B"]
    assert all(s["on_off_accuracy"] > 0.85 for s in r["scoring"])
    peaks = sorted(round(c["peak_hz"]) for c in r["components"])
    assert peaks[0] <= 12 and 34 <= peaks[1] <= 40 and 168 <= peaks[2] <= 176


def test_parse_profiler_log_format():
    text = "#VBUS,4.98\n#CFG,0x199D\nE,0,1\nS,532,450\nS,1064,451\n"
    t, i, v, states, sim = separation.parse_log(text)
    assert v == 4.98 and len(t) == 2 and abs(i[0] - 45.0) < 1e-9 and states is not None and not sim


def test_separation_on_recorded_sessions():
    from fastapi.testclient import TestClient

    from app.database.database import SAMPLE_INSERT
    from app.main import app
    with TestClient(app) as c:
        db = c.app.state.hardware.db
        t, i, v, _, _ = separation.simulate(20, seed=1, sample_period_us=2000)
        full = db.create_session("full", None, "p", "test", 2000, 1)
        db.enqueue(SAMPLE_INSERT, [(full["id"], k, int(t[k] * 1e6), v, float(i[k]), v * float(i[k]), 0.0, None, 1)
                                   for k in range(len(t))])
        db.flush()
        r = c.post("/api/analysis/separate", json={"source": "session", "session_id": full["id"], "k": 3})
        assert r.status_code == 200 and r.json()["k"] == 3 and r.json()["simulated"] is True
        avg = db.create_session("avg", None, "p", "hardware", 2000, 10)
        r = c.post("/api/analysis/separate", json={"source": "session", "session_id": avg["id"]})
        assert r.status_code == 400 and "Full rate" in r.json()["detail"]


def test_manual_k_recovers_weak_led_next_to_ble():
    """Real-board case: two ~3 mA LEDs next to 70 mA BLE bursts. With K fixed, BLE's harmonics must
    not use up the components meant for the small LED."""
    mods = [dict(name="LED A", type="pwm", freq_hz=37, current_ma=3),
            dict(name="LED B", type="pwm", freq_hz=173, current_ma=3),
            dict(name="BLE", type="pulse", freq_hz=10, current_ma=70, width_ms=3)]
    t, i, v, st, tr, names = separation.simulate_custom(mods, 60, 0, 2000, 0.25, 45)
    r = separation.separate(t, i, v, 3, st, tr, names=names)
    peaks = sorted(round(c["peak_hz"]) for c in r["components"])
    assert r["k"] == 3
    assert any(abs(p - 10) <= 2 for p in peaks)
    assert any(abs(p - 37) <= 3 for p in peaks)
    assert any(abs(p - 173) <= 3 for p in peaks)
