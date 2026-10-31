# JouleLab: STM32 NUCLEO-F446RE live energy profiling

```
STM32F446RE + INA219 ──I2C──> firmware ──USART2 (PA2/PA3)──> ST-LINK USB virtual COM port
   ──> backend (FastAPI): PySerial reader → packet decoder → energy engine → SQLite
   ──> WebSocket /ws/live-data ──> frontend (Express + EJS + React) → browser
```

| Folder | What it is |
| --- | --- |
| `firmware/` | STM32 HAL firmware for the NUCLEO-F446RE, ready-to-flash `.bin`, wiring and flashing guide → [`firmware/README.md`](firmware/README.md) |
| `backend/` | FastAPI: serial connection, protocol decoder, energy maths, sessions (SQLite), WebSocket, AI suggestions → [`backend/README.md`](backend/README.md) |
| `frontend/` | The JouleLab website. Lab → **Live hardware** tab shows the board's data |
| `docs/PROTOCOL.md` | The 11-byte binary protocol shared by firmware and backend |

## 1. Hardware

1. Wire the INA219 to the NUCLEO: VCC→3V3, GND→GND, **SDA→PB9 (D14)**, **SCL→PB8 (D15)**.
2. Wire what you want to measure **through** the INA219 (VIN+ → VIN−). Without this the
   reading is ~0. Two setups are described in [`firmware/README.md`](firmware/README.md#1-wiring):
   the STM32 itself (via the IDD jumper JP6) or an external device.
3. Plug the NUCLEO into your computer at **CN1** (the ST-LINK mini-USB) with a data cable.
   The STM32's USART2 is already connected to the ST-LINK; **no USB-serial adapter (CP2102 etc.)
   is needed.**
4. Flash `firmware/joulelab_f446re/build/joulelab_f446re.bin`: copy it onto the `NOD_F446RE`
   USB drive that appears. (Other methods: firmware/README.md §2.)

## 2. Find the board's serial port

| OS | How | Looks like |
| --- | --- | --- |
| macOS | `ls /dev/cu.usbmodem*` | `/dev/cu.usbmodem1103` (use `cu.`, not `tty.`) |
| Windows | Device Manager → Ports (COM & LPT) → "STMicroelectronics STLink Virtual COM Port" | `COM5` |
| Linux | `ls /dev/ttyACM*` (or `dmesg \| grep ttyACM` after plugging in) | `/dev/ttyACM0` |
| Any | `python scripts/test_serial.py --list` (in backend/, venv active) | ST-LINK marked with `*` |

The ST-LINK has USB ID `0483:374B`; the backend uses it to find and highlight the board
automatically.

## 3. Install and run

You need Python 3.11+ and Node.js 18+.

### macOS
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```
Second terminal:
```bash
cd frontend
npm install
npm start
```

### Linux
Same commands as macOS. Once, allow your user to open serial ports, then log out and in:
```bash
sudo usermod -aG dialout $USER
```

### Windows (PowerShell)
```powershell
cd backend
py -3 -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```
Second terminal:
```powershell
cd frontend
npm install
npm start
```
If `venv\Scripts\activate` is blocked, run once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

`npm start` first compiles the lab page (`src/app.jsx` → `public/js/app.js`). React is served
from `node_modules`, so after `npm install` the site works without internet.

### Access and security

By default everything is reachable **only from this computer**: the frontend listens on
127.0.0.1:3000 and uvicorn (as started above) on 127.0.0.1:8000.

* The frontend proxy and the backend share a random key (`backend/data/proxy.key`, created on the
  backend's first start, readable only by you). The backend answers other machines only when
  they come through the proxy with that key, and only then trusts the forwarded browser address.
* To open JouleLab to other computers, set a password and a host, e.g.
  `JOULELAB_PASSWORD='a long passphrase' HOST=0.0.0.0 npm start`. The frontend refuses to listen on
  a public address without a password. Login cookies are signed, HttpOnly and SameSite=Strict;
  10 wrong passwords lock an address out for 15 minutes. Use HTTPS (a reverse proxy) beyond your
  own network.
* Build, upload, debug and terminal input stay limited to this computer even when logged in from
  elsewhere, unless `DEV_ALLOW_REMOTE=true` is set in `backend/.env`.

## 4. See live measurements

1. Open http://localhost:3000/#lab and choose the **Live hardware** tab.
2. Pick the port marked **[ST-LINK]** (or type it), keep **115200**, press **Connect**.
3. The status changes to **Streaming** and the badge says **REAL INA219 DATA**. Voltage,
   current, power and energy update live, with the graph, packet count, packet errors and lost
   samples underneath. With the example firmware, "Energy by function" fills with
   `sensor_read`, `compute`, `send_data` and `idle_sleep`.
4. **Start session** records to SQLite (`backend/data/joulelab.db`); **Stop & save** stores the
   energy summary and per-function results. Tick **Full rate** to keep every sample (needed for
   Module separation on that recording; about 10× the disk space, ~150 MB per hour at 500 Hz).
5. **Above idle**: each function's energy per call minus what the idle floor
   (`BASELINE_FUNCTION`, default `idle_sleep`) would use in the same time. When the INA219 sits on
   the STM32's own supply (JP6), that floor includes the measurement firmware's own timer, I2C
   and UART work, so "Above idle" is the number to compare.

**Resolution.** The INA219 measures shunt voltage in 10 µV steps, so current resolution is
10 µV ÷ shunt: 100 µA with the usual 0.1 Ω shunt, 10 µA with 1 Ω (max current then 320 mA).
Software cannot improve this; for sleep currents fit a larger shunt and set `JL_SHUNT_MILLIOHM`
in `firmware/joulelab_f446re/Core/Inc/jl_config.h`.

Status meanings: *Port open · waiting for data* (port works, no valid packets yet; the message
says why), *Streaming* (valid data within 2 s, the only state shown as connected), *Data stopped*,
*Board disconnected · reconnecting* (USB unplugged; it reconnects by itself), *Error*.

Quick check without the browser (stop the backend first, only one program can use the port):
```bash
cd backend && python scripts/test_serial.py
```

## 5. Workspace: write, build, flash, debug

Open http://localhost:3000/workspace. Above the editor:

| Control | What it does |
| --- | --- |
| **Board** | STM32 NUCLEO-F446RE, ESP32 DevKit or Arduino Uno R3. Picks the PlatformIO environment, upload method and debugger. |
| **Serial port** | Port for the Serial monitor, and the upload port for ESP32/Uno. "Type a port…" for ports the OS list misses. |
| **Open board project in editor** | Loads the board's main file (`Core/Src/main.c` for the NUCLEO = the JouleLab firmware, `src/main.ino` for ESP32/Uno). |
| **✓ Verify** | Saves the editor as that main file and runs `pio run -e <board>`. |
| **→ Upload** | `pio run -e <board> -t upload`. NUCLEO: copies firmware.bin to the NOD_F446RE drive (`upload_protocol = mbed`, no driver needed; switch to `stlink` once the ST-LINK USB driver is installed). The measurement port is released during the upload and reopened after. ESP32/Uno: through the chosen serial port. |
| **⏯ Debug** | NUCLEO only: `pio debug` (debug build, flash, stop at `main()`), then GDB commands from the console (`continue`, `next`, `step`, `bt`, …). |
| **▶ Run** | Upload, then opens the terminal on the board's port so you see what the program prints. Type into the terminal's input line to send text to the board. |
| **Log port** (console tab) | A second board's text output (e.g. ESP32 logs) while the NUCLEO keeps measuring on the main connection. **▶ Run** on an ESP32/Uno uses it automatically when the main connection is busy measuring another board. |
| **■ Stop** | Ends the running build, upload or debug session (including OpenOCD/GDB). |
| **Serial monitor** | Opens the port through JouleLab's one serial connection and shows the text the board prints. |

Output streams live into the console. A job is shown as **SUCCEEDED** only when PlatformIO exits
with code 0. "Reset board project" restores the board's project from the template.

**One serial connection.** The board's port is opened only by the backend's serial manager. The
Live hardware tab, the Serial monitor and the uploader all go through it. Uploading to an ESP32
or Uno over the port the monitor has open: the manager lends the port to the uploader and
reopens it afterwards, keeping your session. NUCLEO uploads go over SWD, so the port stays open.
With the JouleLab firmware the port carries binary packets: they appear in Lab → Live hardware,
and the monitor shows only text and JouleLab events.

**Install PlatformIO** (once, inside the backend venv; it is in requirements.txt):
```bash
cd backend
source venv/bin/activate
python -m pip install platformio
pio --version
```
The first Verify for each board downloads that board's toolchain (hundreds of MB; ESP32 is the
largest), so it can take several minutes. Later builds are quick.
PlatformIO includes OpenOCD and ARM GDB for the NUCLEO's ST-LINK, so no separate ST-LINK GDB
server is needed. Linux only: install PlatformIO's udev rules
(https://docs.platformio.org/en/latest/core/installation/udev-rules.html) so OpenOCD can use
the ST-LINK. Windows: Debug (and `upload_protocol = stlink`) need the ST-LINK USB driver
(STSW-LINK009 or STM32CubeProgrammer); without it OpenOCD fails with "Error: open failed".

**Debugging** is available for the NUCLEO-F446RE only. The ESP32 DevKit needs an external JTAG
probe (e.g. ESP-Prog), and the Uno has no debugger over USB. While the CPU is halted the board
sends no measurements, so Live hardware shows "Data stopped" until you `continue`.

**Security.** Verify/Upload/Debug run programs on your computer and flash boards, so they only
accept requests from this computer (also through port 3000). `DEV_ALLOW_REMOTE=true` in
`backend/.env` lifts that. `platformio.ini` always comes from JouleLab's templates, never from
the browser, because PlatformIO can run scripts named in it.

### Module separation (Lab → Module separation)

Splits ONE current trace into the loads inside it (spectrogram + NMF, numpy only): each module's
frequency signature, when it is on, its current, energy share and the battery life without it.
Sources: live data from the board, an uploaded log, a simulated 3-module ESP32 demo, or a
"virtual room" of up to 8 modules you define. `POST /api/analysis/separate`. Live separation needs
the full-rate stream (500 Hz from the JouleLab firmware); signatures above ~250 Hz cannot be seen
at that rate.

In the virtual room you can also **describe the circuit in plain English** ("two red LEDs with 220 ohm,
one PWM at 37 Hz and one at 173 Hz, plus BLE every 100 ms"). `POST /api/analysis/describe` turns the
description into the module list (OpenAI if `OPENAI_API_KEY`/`OPENAI_MODEL` are set, otherwise an
offline rule parser) and lists every assumption it made; the user checks the table. The AI never
writes samples: `POST /api/analysis/virtual-log` runs the physics simulator and returns a log in the
`profiler.ino` format (`#SIM`, `S,t_us,raw`, `E,t_us,state`), which can be uploaded back for separation.
Pieces of one broadband module that switch on and off together (e.g. jittered BLE bursts) are merged.

## 6. Testing without a board (development only)

`backend/scripts/send_test_samples.py` sends correctly formatted packets whose HELLO is flagged
**TEST SOURCE**. The backend refuses them unless `ALLOW_TEST_SOURCES=true` is set in
`backend/.env`, and when accepted they are labelled **TEST DATA · NOT FROM HARDWARE** in the UI
and `source: "test"` in the API and database. They are never sent to the AI as measurements.

```bash
cd backend
python scripts/send_test_samples.py --virtual      # macOS/Linux: prints a port like /dev/ttys004
```
Type that port into the Live hardware tab. (Windows: create a virtual pair with com0com and use
`--port COM11`.)

## 7. Tests

**Browser tests** (real backend + frontend + Chromium, with virtual boards; macOS/Linux):
```bash
cd frontend
npm i -D playwright && npx playwright install chromium   # once
npm run test:e2e
```
They cover the offline lab page, live streaming, full-rate session → separation, Verify, Run on the
log port while measuring, terminal echo, and debug/Stop. PlatformIO and both boards are simulated.

**Backend tests:**

```bash
cd backend && pytest -q
```
83 tests: protocol and CRC, decoder (split, corrupt and garbage input), sequence/loss/wrap
handling, energy and function windows, port detection, real serial I/O through a virtual port,
the REST API and WebSockets, access rules (proxy key, forged headers), the log port, and module separation, the Workspace build/upload/debug/stop handling (with a stand-in
for the `pio` command, so they check JouleLab's process handling, not the compilers). `test_firmware_compat.py` compiles the firmware's C packet code with
your PC's C compiler and checks it against the Python decoder byte for byte (skipped if no C
compiler is installed).

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/hardware/status` | state, `connected`, message, packet/error/loss counters |
| GET | `/api/hardware/ports` | serial ports, ST-LINK first |
| POST | `/api/hardware/connect` | `{"port": "auto" \| "COM5" \| "/dev/cu.usbmodem…", "baudrate": 115200}` |
| POST | `/api/hardware/disconnect` | |
| GET | `/api/measurements/latest` | last sample + status |
| GET | `/api/measurements/history` | `?seconds=10` (live buffer) or `?session_id=3` (stored) |
| GET | `/api/measurements/summary` | energy totals + per-function results (`?session_id=`) |
| POST | `/api/sessions/start` | `{"name": "...", "notes": "..."}` (board must be streaming) |
| POST | `/api/sessions/stop` | |
| GET | `/api/sessions` | list; `/api/sessions/{id}` for one |
| POST | `/api/optimizer/suggest` | AI suggestions (needs `OPENAI_API_KEY`); reports are saved |
| GET | `/api/development/boards` | boards + PlatformIO status |
| GET | `/api/development/ports` | serial ports + the port the shared serial manager holds |
| GET/PUT | `/api/development/project/{board}` | read / save the board project's main file; `POST …/reset` restores it |
| POST | `/api/development/build` | `{"board": "nucleo_f446re", "source": "..."}` → `pio run` |
| POST | `/api/development/upload` | `{"board": "esp32dev", "port": "/dev/cu.usbserial-0001", "source": "..."}` → `pio run -t upload` |
| POST | `/api/development/stop` | stop the running job |
| GET | `/api/development/job` | running / last job and its exit code |
| POST | `/api/development/debug/start` · `/stop` · `/command` | GDB session (NUCLEO) |
| WS | `/ws/build-output` | compiler/upload/GDB output lines + job status |
| WS | `/ws/serial-monitor` | text printed by the board (from the shared serial connection) |
| WS | `/ws/live-data` | `snapshot`, then `live` messages ~20×/s: samples (t, V, mA, mW, mJ, function, source) + status |

Interactive docs: http://127.0.0.1:8000/docs. The frontend reaches all of these through its
`/backend/...` proxy, so the browser only talks to port 3000.
