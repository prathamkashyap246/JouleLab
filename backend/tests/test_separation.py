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
