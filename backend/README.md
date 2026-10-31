# JouleLab backend (FastAPI)

Setup and run instructions for macOS, Windows and Linux are in the [main README](../README.md).

```
app/
  main.py                      FastAPI app, lifespan, /ws/live-data
  core/config.py               settings from environment / .env
  hardware/
    stm32_protocol.py          packet format, types, CRC-8, encoders (docs/PROTOCOL.md)
    packet_decoder.py          byte stream -> packets (sync, split packets, CRC, resync)
    sample_stream.py           packets -> timed samples (seq unwrap, loss, duplicates, time sync, resets)
    serial_reader.py           port discovery (ST-LINK VID/PID), open 8N1, reader thread, reconnect
    connection_manager.py      connect/disconnect, status, sessions, wiring everything together
  services/
    energy.py                  power, trapezoidal energy, function windows
    measurement_store.py       live sample buffer + WebSocket broadcaster
    ai_optimizer.py            optional OpenAI suggestions
    serial_monitor.py          monitor text from the shared serial connection (never opens a port)
    platformio_manager.py      pio command, supported boards, per-board projects (data/projects)
    build_manager.py           runs PlatformIO jobs, streams output, Stop (kills the process tree)
    upload_manager.py          upload; lends the serial port to ESP32/Uno uploads and takes it back
    debug_manager.py           pio debug (GDB over ST-LINK) with commands from the console
  database/
    models.py                  SQLite schema
    database.py                connection, background writer, queries, retention
  api/routes/                  hardware, measurements, sessions, optimization, firmware,
                               development (build/upload/projects), debugging
  api/deps.py                  local-only rule for build/upload/debug
scripts/
  test_serial.py               check a real board from the command line
  send_test_samples.py         DEVELOPMENT ONLY: flagged test packets, virtual serial port
tests/                         pytest suite (72 tests)
```

## Data flow and threads

* **Serial thread** (`SerialReader`): blocking `read()` with a 50 ms timeout, so the FastAPI
  event loop never blocks. Bytes → decoder → sample stream → energy engines → live store
  (thread-safe), and decimated rows → database queue.
* **Event loop**: REST endpoints and one broadcaster task that sends the newest samples to every
  WebSocket client about 20 times a second. Each client has its own bounded queue; a slow
  browser drops its own old messages and never holds up acquisition.
* **Database thread**: commits batched inserts so disk I/O never stalls the serial thread.

## Units

| Quantity | Unit |
| --- | --- |
| voltage | V (from mV on the wire) |
| current | mA (from µA on the wire, signed) |
| power | mW = V × mA |
| energy | mJ = trapezoidal integral of mW over seconds |
| time | µs of the board's own clock (`t_us`) |

## Guarantees

* `connected` is true only while valid measurements are arriving (state `streaming`). An open
  port alone is reported as `waiting_for_data`, with the reason.
* No value is ever invented: lost samples leave a gap; energy is not integrated across it
  (`missing_time_s`), and function windows containing a gap are marked incomplete.
* Every discarded byte or packet is counted (`bytes_discarded`, `crc_errors`,
  `unknown_packets`, `lost_samples`, `duplicate_samples`) and logged.
* Packets flagged TEST SOURCE are refused unless `ALLOW_TEST_SOURCES=true`, and are labelled
  `source: "test"` everywhere when accepted.

## Storage

Samples are written only while a session is recording, as averages of `DB_STORE_DECIMATION`
samples (default 10; about 15 MB per hour at 500 Hz). Energy totals use every sample, not the
stored averages. `DB_MAX_SAMPLES_PER_SESSION` caps rows per session, and `RETENTION_DAYS` deletes
old sessions on start-up and hourly. Sessions left `active` by a crash are marked `interrupted`
on the next start.

## Changes from the previous starter backend

* `POST /api/measurements/data` (JSON ingestion) was removed: it let any client inject values
  that would have been displayed as hardware measurements.
* The JSON-lines serial adapter and the placeholder `packet_decoder.py` were replaced by the
  binary protocol decoder.
* `POST /api/firmware/upload` no longer just accepts source: it saves it and runs the real
  upload (same as `/api/development/upload`).
* `test_serial.py` moved from `backend/` to `backend/scripts/` and now decodes packets. The old
  version opened `/dev/cu.usbserial-0001`, which is a CP2102/FTDI adapter name; the NUCLEO's
  ST-LINK port is `/dev/cu.usbmodem…` on macOS.
