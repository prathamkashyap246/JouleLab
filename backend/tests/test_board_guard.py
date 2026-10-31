import pytest

from app.services.platformio_manager import BOARDS, DevError, check_board_matches

ESP32_SKETCH = "#include <BLEDevice.h>\nvoid setup() { Serial.begin(115200); }\nvoid loop() {}\n"
STM32_MAIN = '#include "main.h"\n#include "stm32f4xx_hal.h"\nint main(void) { HAL_Init(); while (1) {} }\n'


def test_esp32_sketch_refused_for_nucleo():
    with pytest.raises(DevError) as e:
        check_board_matches(BOARDS["nucleo_f446re"], ESP32_SKETCH)
    assert "ESP32 DevKit" in e.value.message


def test_stm32_code_refused_for_esp32():
    with pytest.raises(DevError):
        check_board_matches(BOARDS["esp32dev"], STM32_MAIN)


def test_matching_code_accepted():
    check_board_matches(BOARDS["nucleo_f446re"], STM32_MAIN)
    check_board_matches(BOARDS["esp32dev"], ESP32_SKETCH)
    check_board_matches(BOARDS["uno"], "void setup(){}\nvoid loop(){}\n")
