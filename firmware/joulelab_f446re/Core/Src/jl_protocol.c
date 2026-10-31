#include "jl_protocol.h"

/* CRC-8, polynomial x^8 + x^2 + x + 1 (0x07), init 0x00, no reflection, no final XOR. */
uint8_t jl_crc8(const uint8_t *data, uint32_t len)
{
    uint8_t crc = 0;
    for (uint32_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (int b = 0; b < 8; b++) {
            crc = (crc & 0x80u) ? (uint8_t)((crc << 1) ^ 0x07u) : (uint8_t)(crc << 1);
        }
    }
    return crc;
}

void jl_build_packet(uint8_t out[JL_PACKET_SIZE], uint8_t type, uint32_t value1, uint16_t value2, uint8_t seq)
{
    out[0] = JL_SYNC0;
    out[1] = JL_SYNC1;
    out[2] = type;
    out[3] = (uint8_t)(value1);
    out[4] = (uint8_t)(value1 >> 8);
    out[5] = (uint8_t)(value1 >> 16);
    out[6] = (uint8_t)(value1 >> 24);
    out[7] = (uint8_t)(value2);
    out[8] = (uint8_t)(value2 >> 8);
    out[9] = seq;
    out[10] = jl_crc8(out, 10);
}
