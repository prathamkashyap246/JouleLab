/* Host test: builds the known-vector packets with the FIRMWARE's jl_protocol.c and prints them
 * as hex, one per line. backend/tests/test_firmware_compat.py compiles this with the PC's C
 * compiler and checks every line against the Python encoder/decoder.
 *   cc -I../Core/Inc host_vectors.c ../Core/Src/jl_protocol.c -o host_vectors && ./host_vectors */
#include <stdio.h>
#include <stdint.h>
#include "jl_protocol.h"

static void emit(uint8_t type, uint32_t v1, uint16_t v2, uint8_t seq)
{
    uint8_t p[JL_PACKET_SIZE];
    jl_build_packet(p, type, v1, v2, seq);
    for (unsigned i = 0; i < JL_PACKET_SIZE; i++) printf("%02x%s", p[i], i + 1 < JL_PACKET_SIZE ? " " : "\n");
}

int main(void)
{
    /* same order and values as KNOWN_VECTORS in backend/scripts/send_test_samples.py */
    emit(JL_PKT_HELLO, JL_PROTOCOL_MAGIC, JL_FLAG_TEST_SOURCE, 0);
    emit(JL_PKT_MEASUREMENT, (uint32_t)(int32_t)25000, 3300, 0);
    emit(JL_PKT_TIME_SYNC, 1000000u, 2000, 0);
    emit(JL_PKT_MEASUREMENT, (uint32_t)(int32_t)25100, 3298, 1);
    emit(JL_PKT_MEASUREMENT, (uint32_t)(int32_t)-150, 3301, 2);
    emit(JL_PKT_FUNC_START, 1004000u, 1, 2);
    emit(JL_PKT_MEASUREMENT, (uint32_t)(int32_t)26000, 3297, 3);
    emit(JL_PKT_FUNC_END, 1005500u, 1, 3);
    emit(JL_PKT_MEASUREMENT, (uint32_t)(int32_t)25000, 3300, 4);
    /* extra: CRC of the standard check string "123456789" for CRC-8/SMBUS is 0xF4 */
    printf("check %02x\n", jl_crc8((const uint8_t *)"123456789", 9));
    return 0;
}
