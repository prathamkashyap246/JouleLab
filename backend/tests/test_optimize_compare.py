"""Rule-based code proposals (VS Code style) and the measured before/after comparison."""
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.services import code_optimizer, separation

SKETCH = """#include <BLEDevice.h>
void setup() {
  BLEDevice::init("x");
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->setMinInterval(160);
}
void loop() {
  delay(5000);
}"""


def test_propose_flags_lines_with_before_and_after():
    ch = code_optimizer.propose(SKETCH)
    ids = {c["id"] for c in ch}
    assert {"cpu", "adv", "delay"} <= ids
    cpu = next(c for c in ch if c["id"] == "cpu")
    assert cpu["line"] == 2 and cpu["before"] == ["void setup() {"] and "setCpuFrequencyMhz(80)" in cpu["after"][1]
    fixed = code_optimizer.apply(SKETCH, ch)
    assert "setCpuFrequencyMhz(80)" in fixed and "setMinInterval(1600)" in fixed and "esp_deep_sleep_start" in fixed
    assert code_optimizer.propose(fixed) == [] or all(c["id"] != "cpu" for c in code_optimizer.propose(fixed))


def test_propose_endpoint():
    with TestClient(app) as c:
        r = c.post("/api/optimizer/propose", json={"code": SKETCH})
        assert r.status_code == 200 and r.json()["engine"] == "rules" and r.json()["changes"]


def _record(db, name, mean_ma, seed, seconds=30):
    from app.database.database import SAMPLE_INSERT
    mods = [dict(name="LED A", type="pwm", freq_hz=36, current_ma=3),
            dict(name="LED B", type="pwm", freq_hz=172.7, current_ma=6)]
    t, i, v, *_ = separation.simulate_custom(mods, seconds, seed, 2000, 0.25, mean_ma)
    s = db.create_session(name, None, "p", "test", 2000, 1)
    db.enqueue(SAMPLE_INSERT, [(s["id"], k, int(t[k] * 1e6), v, float(i[k]), v * float(i[k]), 0.0, None, 1)
                               for k in range(len(t))])
    db.flush()
    p = float(np.mean(i)) * v
    db.finish_session(s["id"], "completed", {"energy_mj": p * seconds, "integrated_time_s": seconds,
                                             "missing_time_s": 0, "average_power_mw": p,
                                             "average_current_ma": float(np.mean(i)), "peak_power_mw": p,
                                             "peak_current_ma": 0, "sample_count": len(t)}, 0, 0, len(t), False)
    return s["id"]


def test_compare_detects_a_real_saving_and_rejects_noise():
    with TestClient(app) as c:
        db = c.app.state.hardware.db
        b1 = _record(db, "before", 48, 1)
        b2 = _record(db, "before again", 48, 2)
        a = _record(db, "after 80MHz", 30, 3)
        r = c.get(f"/api/sessions/compare?before={b1}&after={a}&k=2").json()
        assert r["significant"] and r["delta_pct"] < -20
        assert r["modules"] and any(abs(m["peak_hz"] - 36) <= 3 for m in r["modules"])
        same = c.get(f"/api/sessions/compare?before={b1}&after={b2}").json()
        assert not same["significant"] and "NOT larger" in same["verdict"]
        assert c.get(f"/api/sessions/compare?before={b1}&after=99999").status_code == 404
