# JouleLab serial protocol, version 1

Used between the NUCLEO-F446RE firmware (`firmware/joulelab_f446re/Core/Src/jl_protocol.c`)
and the backend decoder (`backend/app/hardware/stm32_protocol.py`, `packet_decoder.py`,
`sample_stream.py`). `backend/tests/test_firmware_compat.py` compiles the C encoder on your
PC and checks it byte-for-byte against the Python decoder.

## 1. Link

| Setting | Value |
| --- | --- |
| Peripheral | USART2, PA2 = TX, PA3 = RX (wired to the ST-LINK virtual COM port on the NUCLEO) |
| Baud | 115200 |
| Format | 8 data bits, no parity, 1 stop bit (8N1), no flow control |
| Direction | board → PC only (the PC never sends anything) |
| Capacity | 115200 / 10 bits = 11 520 bytes/s ≈ 1047 packets/s |

## 2. Packet format (11 bytes, little-endian)

| Byte | Field | Type |
| --- | --- | --- |
| 0–1 | sync | `0xAA 0x55` |
| 2 | packet type | uint8 |
| 3–6 | value1 | uint32, little-endian |
| 7–8 | value2 | uint16, little-endian |
| 9 | seq | uint8 sample counter (see §4) |
| 10 | checksum | CRC-8 over bytes 0–9 |

**Checksum:** CRC-8, polynomial `0x07` (x⁸+x²+x+1), initial value `0x00`, no reflection, no
final XOR (catalogued as CRC-8/SMBUS; check value for `"123456789"` is `0xF4`). A CRC was
chosen over a plain XOR because XOR misses any two bit-flips in the same bit position and any
reordering of bytes.

## 3. Packet types

| Type | Name | value1 | value2 | seq |
| --- | --- | --- | --- | --- |
| `0x01` | MEASUREMENT | **current in µA, int32 two's complement** | **bus voltage in mV** | sample counter |
| `0x02` | FUNCTION_START | board time, µs | function id | last sample's seq |
| `0x03` | FUNCTION_END | board time, µs | function id | last sample's seq |
| `0x04` | GPIO_EDGE | board time, µs | `(channel << 8) \| level` | last sample's seq |
| `0x10` | TIME_SYNC | board time (µs) of sample `seq` | sample period, µs | the sample it describes |
| `0x11` | HELLO | `0x4A4C0001` ("JL" + protocol version 1) | flags (bit 0 = TEST SOURCE) | last sample's seq |
| `0x7E` | DEVICE_STATUS | detail | status code (below) | last sample's seq |

### Scaling: why µA, not mA

Your draft protocol specified current in milliamps. That would discard everything below 1 mA:
sleep-mode currents (STM32 Stop mode is tens of µA, ESP32 deep sleep ~10 µA) would read 0 and
their energy would vanish. The same 4-byte field holds microamps instead, with the same byte
layout. Current is **signed** because the INA219 shunt reading is signed; a negative value means
the shunt is wired backwards and is shown, not clipped.

Real resolution is set by the sensor: the INA219 shunt-voltage LSB is 10 µV, so with the common
0.1 Ω shunt it is **100 µA**. For finer resolution use a larger shunt (1 Ω gives 10 µA) and set
`JL_SHUNT_MILLIOHM` in `jl_config.h`. Voltage is the INA219 bus voltage (4 mV LSB), measured at
VIN− (the load side), so power = bus voltage × current is the power delivered to the load.

### DEVICE_STATUS codes

| Code | Meaning | detail |
| --- | --- | --- |
| 1 | INA219 not responding (start-up or after 25 failed reads) | HAL I2C error code |
| 2 | I2C read failed (sample skipped) | HAL I2C error code |
| 3 | Firmware TX buffer overflowed, packets dropped on the board | total dropped |
| 4 | INA219 overflow or shunt at full scale; sample withheld | raw shunt value |
| 5 | Sample overrun: previous I2C read still busy | total overruns |
| 6 | INA219 responding again | 0 |

## 4. Timing and sequence numbers

* TIM3 triggers one sample every `period` µs (default 2000 µs = 500 Hz). Each trigger
  increments the 8-bit `seq`, **even if that sample is never sent** (I2C error, overflow, TX
  buffer full). A gap in `seq` therefore always means lost samples.
* TIME_SYNC (every 100 samples) gives the board time of one sample. The PC timestamps sample
  *k* as `t(k) = t_sync + (k − k_sync) × period`, using the board's crystal, so USB and OS
  latency never distort the time axis. 32-bit board time wraps every 71.6 min; the PC unwraps it.
* If 256 or more samples in a row are lost, the 8-bit `seq` alone cannot show it; the next
  TIME_SYNC disagrees with the expected time and the PC adds the missing samples (`resync`).
* A board clock that jumps backwards by more than 1 s means the firmware restarted.
* Marker packets (FUNCTION_*, GPIO_EDGE) carry their own µs timestamp from the same TIM2 clock,
  so function windows line up with samples to the microsecond.
* Each sample is the INA219's most recent completed conversion (≈1.06 ms for shunt + bus at
  12-bit), so a sample describes the ~1 ms *before* its timestamp.

## 5. Host rules (what the backend does)

1. Search for `AA 55`; bytes before it are counted as `bytes_discarded`.
2. Wait for 11 bytes (packets may arrive split across reads).
3. CRC mismatch → count `crc_errors`, drop **one** byte and search again (the real packet may
   start inside the bad frame, since `AA 55` can occur in payloads).
4. Unknown type → count `unknown_packets`, skip the frame.
5. Same `seq` twice in a row → duplicate, ignored and counted.
6. No measurement is used before a HELLO **and** a TIME_SYNC have been received.
7. HELLO with flag bit 0 (TEST SOURCE) → rejected unless `ALLOW_TEST_SOURCES=true`; accepted
   test data is labelled "TEST DATA · NOT FROM HARDWARE" everywhere.
8. Energy is the trapezoidal integral of V × I between **consecutive** samples only. Intervals
   with a lost sample are never integrated; they are reported as `missing_time_s`.

## 6. Function windows

| Source | How it is timed | Use when |
| --- | --- | --- |
| **Firmware marker** (`FUNCTION_START/END`) | the STM32's own code calls `JL_FUNCTION_START(id)` / `JL_FUNCTION_END(id)` | profiling code running on the NUCLEO itself |
| **GPIO-timed** (`GPIO_EDGE`) | an external device drives PA0 (A0) or PA1 (A1) high during the function; the NUCLEO timestamps each edge in an interrupt | profiling another board (ESP32, …) powered through the INA219 |

Window energy = integral of the interpolated power trace from start to end. The result is
marked incomplete (and excluded from totals) if any sample inside the window was lost. Max
power uses samples strictly inside the window.

Names come from `FUNCTION_NAMES` (`1:sensor_read,...`) and `GPIO_MARKER_NAMES` in
`backend/.env`; ids must match `JL_FN_*` in `jl_config.h`.

## 7. Example bytes

```
aa 55 11 01 00 4c 4a 01 00 00 fa   HELLO (test source flag set)
aa 55 01 a8 61 00 00 e4 0c 07 09   MEASUREMENT 25000 µA, 3300 mV, seq 7
```
Run `python scripts/send_test_samples.py --virtual --known` to print all known vectors with
their CRCs.
