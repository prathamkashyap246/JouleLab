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


def test_stm32_arduino_board_takes_hal_but_not_esp32_code():
    from app.services.platformio_manager import DevError, check_board_matches, get_board
    b = get_board("nucleo_f446re_arduino")
    hal = "UART_HandleTypeDef huart2;\nvoid setup(){ HAL_UART_Init(&huart2); }\nvoid loop(){}"
    check_board_matches(b, hal)                              # allowed
    esp = "#include <BLEDevice.h>\nvoid setup(){ ledcAttach(5, 37, 14); }\nvoid loop(){}"
    try:
        check_board_matches(b, esp)
        assert False, "ESP32 sketch must be refused on the STM32 Arduino board"
    except DevError as e:
        assert e.status_code == 422


def test_arduino_sketch_with_hal_calls_is_refused_on_the_c_nucleo_project():
    from app.services.platformio_manager import DevError, check_board_matches, get_board
    src = ("UART_HandleTypeDef huart1;\nString buf;\nvoid setup(){ Serial.begin(115200); HAL_UART_Init(&huart1); }\n"
           "void loop(){}")
    try:
        check_board_matches(get_board("nucleo_f446re"), src)
        assert False
    except DevError as e:
        assert "Arduino" in str(e)
    check_board_matches(get_board("nucleo_f446re_arduino"), src)
