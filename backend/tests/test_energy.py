import numpy as np
import pytest

from app.services.energy import EnergyEngine, Sample, integrate_energy_mj, integrate_window


def test_constant_power_energy():
    # 3.3 V * 100 mA = 0.33 W for 1 second = 330 mJ
    samples = [
        {"timestamp_us": 0, "voltage_v": 3.3, "current_ma": 100},
        {"timestamp_us": 1_000_000, "voltage_v": 3.3, "current_ma": 100},
    ]
    assert integrate_energy_mj(samples) == 330.0


def test_not_enough_samples():
    assert integrate_energy_mj([]) == 0.0
    assert integrate_energy_mj([{"timestamp_us": 0}]) == 0.0


def mk(k, t, v=3.3, i=10.0, contiguous=True, epoch=0):
    return Sample(k, t, v, i, v * i, epoch, contiguous)


def test_engine_trapezoid_and_units():
    e = EnergyEngine()
    # ramp 0 -> 100 mA at 1 V over 1 s: average 50 mW for 1 s = 50 mJ
    e.add(mk(0, 0, 1.0, 0.0, contiguous=False))
    e.add(mk(1, 1_000_000, 1.0, 100.0))
    assert e.energy_mj == pytest.approx(50.0)
    assert e.summary()["average_current_ma"] == pytest.approx(50.0)


def test_engine_never_integrates_across_gaps():
    e = EnergyEngine()
    e.add(mk(0, 0, contiguous=False))
    e.add(mk(1, 1000))
    e.add(mk(5, 5000, contiguous=False))  # samples 2..4 lost
    e.add(mk(6, 6000))
    assert e.integrated_time_us == 2000
    assert e.missing_time_us == 4000 and e.gaps == 1
    assert e.energy_mj == pytest.approx(33.0 * 2000 / 1e6)


def test_window_interpolates_boundaries_exactly():
    t = np.array([0, 1000, 2000, 3000], dtype=np.int64)
    p = np.array([0.0, 100.0, 100.0, 0.0])
    ok = np.array([False, True, True, True])
    r = integrate_window(t, p, ok, 500, 2500)
    # piecewise linear: 500-1000 avg 75 mW (0.5 ms), 1000-2000 100 mW (1 ms), 2000-2500 avg 75 mW (0.5 ms)
    assert r["complete"] and r["energy_mj"] == pytest.approx((75 * 500 + 100 * 1000 + 75 * 500) / 1e6)
    assert r["max_power_mw"] == pytest.approx(100.0)


def test_window_with_lost_sample_is_incomplete():
    t = np.array([0, 1000, 3000], dtype=np.int64)
    p = np.array([1.0, 1.0, 1.0])
    ok = np.array([False, True, False])
    r = integrate_window(t, p, ok, 500, 2500)
    assert r["complete"] is False and "lost" in r["reason"]


def test_window_max_ignores_neighbouring_function_on_boundary():
    t = np.array([0, 1000, 2000, 3000], dtype=np.int64)
    p = np.array([10.0, 10.0, 10.0, 500.0])  # 500 mW sample exactly at window end belongs to the next function
    ok = np.array([False, True, True, True])
    assert integrate_window(t, p, ok, 0, 3000)["max_power_mw"] == pytest.approx(10.0)


def test_function_windows_from_firmware_markers():
    e = EnergyEngine(function_names={1: "sensor_read"})
    for k in range(11):
        e.add(mk(k, k * 1000, 1.0, 20.0, contiguous=k > 0))
    e.marker({"source": "firmware", "start": True, "function_id": 1, "t_us": 2000})
    done = e.marker({"source": "firmware", "start": False, "function_id": 1, "t_us": 6000})
    assert done and done[0]["complete"]
    assert done[0]["energy_mj"] == pytest.approx(20.0 * 4000 / 1e6)
    f = e.summary()["functions"][0]
    assert f["function_name"] == "sensor_read" and f["source"] == "firmware"
    assert f["avg_duration_ms"] == pytest.approx(4.0) and f["average_power_mW"] == pytest.approx(20.0)


def test_window_waits_for_samples_after_end_marker():
    e = EnergyEngine()
    for k in range(5):
        e.add(mk(k, k * 1000, contiguous=k > 0))
    e.marker({"source": "gpio", "start": True, "channel": 0, "t_us": 1000})
    assert e.marker({"source": "gpio", "start": False, "channel": 0, "t_us": 6500}) == []  # trace not there yet
    e.add(mk(5, 5000))
    done = e.add(mk(6, 7000 - 0))
    assert done and done[0]["complete"] and done[0]["source"] == "gpio"


def test_unmatched_end_marker_counted():
    e = EnergyEngine()
    e.marker({"source": "firmware", "start": False, "function_id": 9, "t_us": 10})
    assert e.unmatched_markers == 1


def test_negative_current_kept_and_flagged():
    e = EnergyEngine()
    e.add(mk(0, 0, 3.3, -1.0, contiguous=False))
    assert e.summary()["negative_current_samples"] == 1
