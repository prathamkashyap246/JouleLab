from app.services.pio_hints import hints_for


def test_no_network_is_recognised():
    h = hints_for(["Error: HTTPClientError: Max retries exceeded"], 1)
    assert h and "download" in h[0]


def test_esp32_boot_mode():
    assert "BOOT" in hints_for(["A fatal error occurred: Failed to connect to ESP32: Wrong boot mode"], 2)[0]


def test_stlink_missing():
    assert "ST-LINK" in hints_for(["Error: open failed", "No ST-LINK detected"], 1)[0]


def test_unknown_output_gives_nothing():
    assert hints_for(["all good"], 1) == []


def test_at_most_three():
    lines = ["HTTPClientError", "PermissionError", "Failed to connect to ESP32", "No ST-LINK detected"]
    assert len(hints_for(lines, 1)) <= 3
