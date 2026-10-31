from app.services import circuit_ai, separation


def test_rule_parser_led_and_ble():
    out = circuit_ai._rules("red LED with 220 ohm on GPIO 5 PWM at 37 Hz; green LED 330 ohm at 173 Hz; BLE advertising every 100 ms")
    names = [m["name"] for m in out["modules"]]
    assert len(out["modules"]) == 3 and "BLE" in names
    led = out["modules"][0]
    assert led["type"] == "pwm" and led["freq_hz"] == 37 and 5.5 < led["current_ma"] < 6.5
    assert out["modules"][2]["freq_hz"] == 10


def test_generated_log_round_trips():
    mods = circuit_ai._rules("LED 220 ohm at 37 Hz and BLE every 100 ms")["modules"]
    t, i, v, st, truth, names = separation.simulate_custom(mods, 10, 0, 532)
    text = separation.to_log_text(t, i, v, st, "test")
    T, I, V, ST, sim = separation.parse_log(text)
    assert sim and len(T) == len(t) and ST is not None
