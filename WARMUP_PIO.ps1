# One-time: download every PlatformIO package JouleLab needs, so the first Upload does not stall.
# Run from the backend folder with the venv active:  .\venv\Scripts\Activate.ps1
Remove-Item Env:PLATFORMIO_OFFLINE -ErrorAction SilentlyContinue
pio pkg install -g -p espressif32
pio pkg install -g -p ststm32
pio run -d data\projects\esp32dev -e esp32dev
pio run -d ..\firmware\platformio_templates\nucleo_f446re_arduino -e nucleo_f446re_arduino
