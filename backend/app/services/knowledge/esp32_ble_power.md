# ESP32 BLE power knowledge base (rules the AI applies)

Treat these as hypotheses to check against the MEASURED per-phase energy. Never claim a saving is
guaranteed. Always keep behaviour, UUIDs and data format unchanged.

## Phases of a typical BLE sketch
- advertising: radio on, waiting for the phone to connect
- connection: link maintenance between data packets
- transmit: notify()/indicate()/write of data (e.g. INA219 voltage/current/power)
- idle: delay(), polling loops, waiting between readings
- sensor: I2C reads (INA219)

## Rules
1. Advertising interval: very short intervals (about 20-100 ms) keep the radio busy. Use 500-1000 ms
   where connection-setup latency allows. Stop advertising once connected; restart only after disconnect.
2. Connection parameters: a longer connection interval and some slave latency reduce radio wake-ups.
   Request them from the ESP32 (esp_ble_gap_update_conn_params / NimBLE updateConnParams). The phone
   decides the final values (iOS restricts them), so say so in caveats.
3. Notify rate: do not notify faster than the app needs. Skip notify when the value did not change
   (or changed less than a threshold). Batch several readings into one packet.
4. MTU: negotiate a larger MTU so a batch fits in one packet instead of many.
5. TX power: lower it (esp_ble_tx_power_set) if range allows. Mention the range trade-off.
6. Idle waiting: delay() and busy loops keep the CPU at full speed. Prefer light sleep between events
   (esp_sleep_enable_timer_wakeup + esp_light_sleep_start) or let BLE modem sleep work. Light sleep
   with BLE needs the right sdkconfig / a 32 kHz clock source; flag this as something to verify.
7. CPU frequency: setCpuFrequencyMhz(80) (or lower) is often enough for BLE + I2C reads.
8. Radios and peripherals: turn off Wi-Fi if unused (WiFi.mode(WIFI_OFF)), disable unused pins/LEDs.
9. Serial: Serial.print inside hot loops costs CPU time and energy; remove or rate-limit it.
10. Sampling: do not read the INA219 / sensors more often than the data is sent.
11. Stack: NimBLE-Arduino generally uses less RAM/flash than the default Bluedroid stack. Suggest only
    as an option to measure, since it changes the API.
12. Disconnect when finished: if the app only needs occasional data, disconnect and sleep deeply.

## Output rules
- Cite exact line_start/line_end using the numbers in the input.
- Prefer ranking by measured energy share; with no measurements mark confidence low/medium.
- optimized_code must be a complete, compilable Arduino/PlatformIO sketch.
