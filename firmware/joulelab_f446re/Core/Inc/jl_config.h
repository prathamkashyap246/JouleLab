/* JouleLab firmware settings. Change these, rebuild, re-flash. */
#ifndef JL_CONFIG_H
#define JL_CONFIG_H

/* Sampling period in microseconds (500 Hz). 115200 baud carries ~1000 packets/s,
 * so keep this >= 1500 us. The INA219 needs ~1.06 ms per shunt+bus conversion pair
 * at 12-bit, so faster sampling would only repeat readings. */
#define JL_SAMPLE_PERIOD_US      2000u

/* INA219 */
#define JL_INA219_ADDR           0x40u   /* A0 = A1 = GND on most breakouts */
#define JL_SHUNT_MILLIOHM        100u    /* "R100" resistor on Adafruit/clone breakouts = 0.1 ohm */
/* Config register: bus range 32 V, PGA /8 (+-320 mV shunt), 12-bit bus & shunt, continuous shunt+bus.
 * Shunt voltage LSB is 10 uV at every PGA setting, so with 0.1 ohm the current resolution is 100 uA. */
#define JL_INA219_CONFIG         0x399Fu

/* Packets */
#define JL_TIME_SYNC_EVERY       100u    /* samples between TIME_SYNC packets */
#define JL_HELLO_INTERVAL_MS     1000u
#define JL_STATUS_INTERVAL_MS    250u    /* how often error counters are reported */
#define JL_TX_BUFFER_SIZE        2048u   /* bytes; must be a power of two */

/* 1 = run the built-in example workload (sensor_read / compute / send_data / idle_sleep)
 * wrapped in function markers. Use with the INA219 across the IDD jumper (JP6) to profile
 * the STM32 itself. 0 = only measure (e.g. an external device on the INA219). */
#define JL_DEMO_WORKLOAD         1

/* Function ids sent in FUNCTION_START/END. Must match FUNCTION_NAMES in backend/.env */
#define JL_FN_SENSOR_READ        1u
#define JL_FN_COMPUTE            2u
#define JL_FN_SEND_DATA          3u
#define JL_FN_IDLE_SLEEP         4u

#endif /* JL_CONFIG_H */
