/*
 * JouleLab binary protocol v1 (docs/PROTOCOL.md). Must match
 * backend/app/hardware/stm32_protocol.py exactly.
 *
 *   [0..1] 0xAA 0x55   [2] type   [3..6] value1 u32 LE   [7..8] value2 u16 LE
 *   [9] seq            [10] CRC-8 (poly 0x07, init 0x00) over bytes 0..9
 *
 * This file has no HAL dependency so it can be unit-tested on a PC.
 */
#ifndef JL_PROTOCOL_H
#define JL_PROTOCOL_H

#include <stdint.h>

#define JL_PACKET_SIZE        11u
#define JL_SYNC0              0xAAu
#define JL_SYNC1              0x55u
#define JL_PROTOCOL_MAGIC     0x4A4C0001u /* "JL" + version 1, sent in HELLO.value1 */

/* Packet types */
#define JL_PKT_MEASUREMENT    0x01u /* v1 = current µA (int32 two's complement), v2 = bus voltage mV */
#define JL_PKT_FUNC_START     0x02u /* v1 = time µs, v2 = function id */
#define JL_PKT_FUNC_END       0x03u /* v1 = time µs, v2 = function id */
#define JL_PKT_GPIO_EDGE      0x04u /* v1 = time µs, v2 = (channel << 8) | level */
#define JL_PKT_TIME_SYNC      0x10u /* v1 = time µs of sample `seq`, v2 = sample period µs */
#define JL_PKT_HELLO          0x11u /* v1 = JL_PROTOCOL_MAGIC, v2 = flags */
#define JL_PKT_DEVICE_STATUS  0x7Eu /* v1 = detail, v2 = status code */

/* HELLO flags */
#define JL_FLAG_TEST_SOURCE   0x0001u /* never set by this firmware: it only sends real INA219 data */

/* DEVICE_STATUS codes */
#define JL_ST_INA219_NOT_FOUND   1u
#define JL_ST_I2C_READ_FAILED    2u
#define JL_ST_TX_OVERFLOW        3u
#define JL_ST_INA219_OVERFLOW    4u
#define JL_ST_SAMPLE_OVERRUN     5u
#define JL_ST_INA219_RECOVERED   6u

uint8_t jl_crc8(const uint8_t *data, uint32_t len);
void jl_build_packet(uint8_t out[JL_PACKET_SIZE], uint8_t type, uint32_t value1, uint16_t value2, uint8_t seq);

#endif /* JL_PROTOCOL_H */
