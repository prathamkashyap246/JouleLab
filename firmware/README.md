# JouleLab firmware: NUCLEO-F446RE + INA219

`joulelab_f446re/` is a complete STM32 HAL project (Makefile + ST's HAL/CMSIS sources).
A ready-to-flash binary is included: **`joulelab_f446re/build/joulelab_f446re.bin`**
(also `.hex` / `.elf`). It was compiled with arm-none-eabi-gcc 13.2 and has **not yet been run on a
physical board**. The first time you flash it, do the checks in "Verify" below.

What it does:

* Reads the INA219 (shunt + bus voltage) every 2 ms (500 Hz) on a hardware timer, using
  interrupt-driven I2C, so sampling stays regular while your code runs.
* Sends 11-byte packets over USART2 → ST-LINK virtual COM port at 115200 8N1 (`docs/PROTOCOL.md`).
* Timestamps everything with a 1 MHz hardware clock (TIM2).
* Reports sensor problems (`INA219 not responding`, I2C errors, overflow) instead of sending
  made-up values, and keeps retrying the sensor once a second.
* Function markers: `JL_FUNCTION_START(id)` / `JL_FUNCTION_END(id)` for code on this STM32, and
  PA0 (A0) / PA1 (A1) edge inputs for an external device.
* With `JL_DEMO_WORKLOAD 1` (default) it runs four example functions in a loop
  (`sensor_read` 20 ms busy, `compute` 50 ms floating point, `send_data` 30 ms with LD2 on,
  `idle_sleep` 100 ms in sleep mode), each wrapped in markers, so you can see function-level
  profiling on real hardware straight away.

## 1. Wiring

### INA219 to the NUCLEO (always)

| INA219 pin | NUCLEO-F446RE | Arduino header name |
| --- | --- | --- |
| VCC | 3V3 (CN6) | 3V3 |
| GND | GND | GND |
| SDA | **PB9** | D14 |
| SCL | **PB8** | D15 |

The firmware expects I2C address **0x40** (A0 and A1 pads open on most breakouts) and a
**0.1 Ω** shunt (resistor marked "R100"). If yours differs, change `JL_INA219_ADDR` /
`JL_SHUNT_MILLIOHM` in `Core/Inc/jl_config.h` and rebuild.

USART2 needs **no wiring**: on the NUCLEO, PA2/PA3 are already connected to the ST-LINK, which
appears on your computer as a USB serial port. No CP2102/FTDI adapter is used.

### What the INA219 measures: pick one setup

The INA219 measures the current that flows **from VIN+ to VIN−**. Something has to be wired
through it; nothing is measured until you do.

**A. Profile the STM32 itself (works with the example workload).**
1. Unplug USB. Remove jumper **JP6 (IDD)** on the NUCLEO. This breaks the 3.3 V supply to the
   STM32 only.
2. Connect the two JP6 pins to the INA219: the pin that carries 3.3 V from the board → **VIN+**,
   the pin going to the microcontroller → **VIN−**.
   To tell them apart: with JP6 removed and USB plugged in, measure each JP6 pin against GND with
   a multimeter. The one at 3.3 V is the supply side (VIN+). If you swap them, the UI shows
   negative current and flags it.
3. Without the INA219 connected, the STM32 has no power while JP6 is out. Put the jumper back
   when you are done.

The reading then includes the measurement firmware's own activity (timer, I2C and UART
interrupts) as a constant baseline. Compare functions with each other, not against zero.

**B. Profile another device (ESP32, sensor board, …).**
1. Supply (+) → INA219 **VIN+**; INA219 **VIN−** → the device's power input.
2. Connect the device's GND, the supply's GND and the NUCLEO's GND together.
3. Optional GPIO-timed markers: device GPIO → **PA0 (A0)** (channel 0) and/or **PA1 (A1)**
   (channel 1). Drive the pin high while the function runs. **3.3 V logic only.**
4. Set `JL_DEMO_WORKLOAD 0` in `jl_config.h` and rebuild, so the NUCLEO only measures.

Keep the current within the INA219's range: ±3.2 A with a 0.1 Ω shunt, bus voltage ≤ 26 V.

## 2. Flash the firmware

Connect the NUCLEO with a **data** USB cable to **CN1** (the mini-USB on the ST-LINK part).

**Option 1: drag and drop (no software needed).** A USB drive called `NOD_F446RE` appears.
Copy `joulelab_f446re/build/joulelab_f446re.bin` onto it. The COM LED (LD1) flashes; when the
drive reappears the board has been programmed and restarts automatically.
If a `FAIL.TXT` file appears on the drive, update the ST-LINK firmware (see Troubleshooting)
and try again.

**Option 2: STM32CubeProgrammer (GUI).** Choose ST-LINK → Connect → Open file
`joulelab_f446re.hex` → Download → Disconnect, then press the black RESET button (B2).

**Option 3: command line.**
```bash
STM32_Programmer_CLI -c port=SWD -w joulelab_f446re/build/joulelab_f446re.bin 0x08000000 -v -rst
```
or, with the open-source stlink tools:
```bash
st-flash --reset write joulelab_f446re/build/joulelab_f446re.bin 0x08000000
```

## 3. Verify

1. **LD2 (green user LED):** with the example workload it flickers about 5 times a second
   (on during `send_data`). If it blinks slowly (1 s on, 1 s off) the firmware is running but
   the **INA219 is not answering**: check SDA/SCL/VCC/GND.
2. **Close the JouleLab backend** (only one program can open the port), then run:
   ```bash
   cd backend
   source venv/bin/activate           # Windows: venv\Scripts\activate
   python scripts/test_serial.py
   ```
   It should print `HELLO: JouleLab firmware`, a list of samples with V, mA and mW, and
   `PASS: live INA219 measurements are arriving from the board.`
3. Start the backend and frontend, open http://localhost:3000/#lab → **Live hardware** →
   choose the port marked `[ST-LINK]` → **Connect**. The badge should read **REAL INA219 DATA**.

## 4. Rebuild from source (optional)

Install the Arm GNU toolchain and `make`:

* macOS: `brew install --cask gcc-arm-embedded` (and Xcode command line tools for `make`)
* Ubuntu/Debian: `sudo apt install gcc-arm-none-eabi libnewlib-arm-none-eabi make`
* Windows: install the "Arm GNU Toolchain (arm-none-eabi)" from developer.arm.com and
  `make` (e.g. `winget install GnuWin32.Make`), or use STM32CubeIDE (below)

```bash
cd firmware/joulelab_f446re
make            # -> build/joulelab_f446re.bin/.hex/.elf
make flash      # uses STM32_Programmer_CLI or st-flash if installed
```

Settings you may want to change are all in `Core/Inc/jl_config.h` (sample period, shunt value,
INA219 address, demo workload, function ids).

### With PlatformIO (what the Workspace's Verify / Upload / Debug use)

`joulelab_f446re/platformio.ini` builds the same files as the Makefile:
```bash
cd firmware/joulelab_f446re
pio run                 # build
pio run -t upload       # flash through the ST-LINK
pio debug --interface=gdb
```
It deliberately has no `framework =` line. `framework = stm32cube` would compile PlatformIO's
own copy of the STM32 HAL, startup file and linker script instead of the ones in this project.
The Workspace works on a copy in `backend/data/projects/nucleo_f446re`, so this folder stays as
the clean template.

## 5. Using STM32CubeMX / STM32CubeIDE instead

If you prefer your own CubeMX project, configure exactly this (Board selector:
**NUCLEO-F446RE**, answer "No" to "initialize all peripherals with default mode" and set them
manually):

| Item | Setting |
| --- | --- |
| RCC / Clock | HSI 16 MHz → PLL: /M 16, ×N 336, /P 4 → **SYSCLK 84 MHz**; AHB /1, APB1 /2 (42 MHz), APB2 /1 |
| USART2 | Mode **Asynchronous**, PA2 = USART2_TX, PA3 = USART2_RX, **115200**, **8 bits, None, 1 stop**, Hardware Flow Control **Disable**, TX+RX; NVIC: USART2 global interrupt **enabled**, priority 3 |
| I2C1 | I2C, **Fast Mode 400 kHz**, PB8 = SCL, PB9 = SDA (move from the default PB6/PB7); NVIC: event + error interrupts **enabled**, priority 1 |
| TIM2 | Clock source Internal, Prescaler **83**, Counter Period **4294967295**, no interrupt |
| TIM3 | Clock source Internal, Prescaler **83**, Counter Period **1999** (2 ms), auto-reload preload Enable; NVIC TIM3 global interrupt **enabled**, priority 2 |
| PA0, PA1 | GPIO_EXTI0 / GPIO_EXTI1, external interrupt **rising/falling edge**, **pull-down**; NVIC EXTI line0/line1 enabled, priority 0 |
| PA5 | GPIO_Output (LD2) |
| NVIC | Priority group 4 bits; Time base: SysTick priority 0 |

Then:
1. Copy `Core/Inc/jl_config.h`, `jl_protocol.h`, `joulelab.h` into your `Core/Inc/`, and
   `Core/Src/jl_protocol.c`, `joulelab.c` into your `Core/Src/`.
2. In `main.c`, `/* USER CODE BEGIN Includes */`: `#include "joulelab.h"`
3. `/* USER CODE BEGIN 2 */`: `jl_init(&huart2, &hi2c1, &htim2, &htim3); jl_start();`
4. Inside `while (1)` `/* USER CODE BEGIN 3 */`: `jl_poll();` plus your code with
   `JL_FUNCTION_START(id); … JL_FUNCTION_END(id);` around the parts you want to profile.
   Keep `jl_poll()` running at least every ~100 ms.
5. `/* USER CODE BEGIN 4 */`: copy the five `HAL_..._Callback` functions from this project's
   `main.c` (they forward to `jl_on_*`). If you already use one of them, call the matching
   `jl_on_*` function from inside yours.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No `NOD_F446RE` drive / no serial port | Use a data cable (many phone cables are charge-only), plug into CN1. Windows: install the ST-LINK driver (STSW-LINK009). |
| Drive shows `FAIL.TXT` or the port drops bytes | Update the ST-LINK firmware: STM32CubeProgrammer → Firmware upgrade (or the standalone STSW-LINK007). |
| `test_serial.py`: "no bytes at all" | Firmware not running: re-flash, press RESET (B2). |
| "bytes arrive but none are valid JouleLab packets" | Another program is flashed, or wrong baud rate. |
| BOARD REPORTS: INA219 not responding | Wiring SDA↔PB9, SCL↔PB8, VCC 3V3, GND; address 0x40. |
| Negative current | VIN+ and VIN− are swapped. |
| Readings stuck near 0 mA | Nothing is wired through VIN+ → VIN−, or JP6 is still fitted (setup A). |
