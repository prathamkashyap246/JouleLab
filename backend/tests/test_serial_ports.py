from types import SimpleNamespace

import pytest

from app.hardware import serial_reader as sr


def port(device, desc="n/a", vid=None, pid=None, product=None, serial_number=None):
    return SimpleNamespace(device=device, description=desc, hwid="x", vid=vid, pid=pid,
                           serial_number=serial_number, manufacturer=None, product=product)


@pytest.fixture
def fake_ports(monkeypatch):
    def install(ports, platform="linux"):
        monkeypatch.setattr(sr.list_ports, "comports", lambda: ports)
        monkeypatch.setattr(sr.sys, "platform", platform)
    return install


def test_stlink_detected_by_vid_pid_and_listed_first(fake_ports):
    fake_ports([port("/dev/ttyUSB0", "CP2102", 0x10C4, 0xEA60),
                port("/dev/ttyACM0", "STM32 STLink", 0x0483, 0x374B, serial_number="066")])
    ports = sr.list_serial_ports()
    assert ports[0].device == "/dev/ttyACM0" and ports[0].is_stlink
    assert not ports[1].is_stlink
    assert sr.auto_detect_port() == "/dev/ttyACM0"


def test_windows_description_detected(fake_ports):
    fake_ports([port("COM5", "STMicroelectronics STLink Virtual COM Port (COM5)")], platform="win32")
    assert sr.list_serial_ports()[0].is_stlink


def test_macos_hides_tty_duplicates(fake_ports):
    fake_ports([port("/dev/tty.usbmodem1103", "STM32 STLink", 0x0483, 0x374B),
                port("/dev/cu.usbmodem1103", "STM32 STLink", 0x0483, 0x374B)], platform="darwin")
    assert [p.device for p in sr.list_serial_ports()] == ["/dev/cu.usbmodem1103"]


def test_auto_detect_errors_are_explicit(fake_ports):
    fake_ports([port("/dev/ttyUSB0", "CP2102", 0x10C4, 0xEA60)])
    with pytest.raises(ValueError, match="No ST-LINK"):
        sr.auto_detect_port()
    fake_ports([port("/dev/ttyACM0", "STLink", 0x0483, 0x374B), port("/dev/ttyACM1", "STLink", 0x0483, 0x374B)])
    with pytest.raises(ValueError, match="Several"):
        sr.auto_detect_port()


def test_linux_placeholder_ports_hidden(fake_ports):
    fake_ports([port("/dev/ttyS0"), port("/dev/ttyACM0", "STLink", 0x0483, 0x374B)])
    assert [p.device for p in sr.list_serial_ports()] == ["/dev/ttyACM0"]


def test_open_errors_are_explained(monkeypatch):
    monkeypatch.setattr(sr.sys, "platform", "linux")
    e = PermissionError(13, "Permission denied")
    assert "dialout" in sr.explain_open_error("/dev/ttyACM0", e)
    assert "does not exist" in sr.explain_open_error("/dev/ttyACM9", FileNotFoundError("No such file"))


def test_open_missing_port_raises_readable_error():
    with pytest.raises(sr.serial.SerialException, match="does not exist|Cannot open"):
        sr.open_port("/dev/definitely-not-here", 115200)
