import pytest

from app.hardware import stm32_protocol as P


def test_crc8_standard_check_value():
    # CRC-8 (poly 0x07, init 0, no reflection) of "123456789" is 0xF4 (catalogued as CRC-8/SMBUS)
    assert P.crc8(b"123456789") == 0xF4


def test_packet_layout_is_exact():
    pkt = P.measurement(25_000, 3300, 7)
    assert len(pkt) == P.PACKET_SIZE == 11
    assert pkt[:2] == b"\xAA\x55"
    assert pkt[2] == 0x01
    assert pkt[3:7] == (25_000).to_bytes(4, "little")
    assert pkt[7:9] == (3300).to_bytes(2, "little")
    assert pkt[9] == 7
    assert pkt[10] == P.crc8(pkt[:10])
    # pinned bytes: any change to the wire format must be deliberate
    assert pkt.hex(" ") == "aa 55 01 a8 61 00 00 e4 0c 07 09"


def test_signed_current_round_trip():
    pkt = P.parse(P.measurement(-150, 3301, 2))
    assert pkt.current_ua == -150
    assert pkt.voltage_mv == 3301


@pytest.mark.parametrize("ua", [0, 1, 3_200_000, -3_200_000, 2**31 - 1, -(2**31)])
def test_current_extremes(ua):
    assert P.parse(P.measurement(ua, 0, 0)).current_ua == ua


def test_encode_rejects_out_of_range():
    with pytest.raises(ValueError):
        P.encode(0x01, 0, 70_000, 0)
    with pytest.raises(ValueError):
        P.encode(0x01, 2**32, 0, 0)


def test_gpio_and_marker_fields():
    g = P.parse(P.gpio_edge(1, 1, 123_456))
    assert (g.type, g.gpio_channel, g.gpio_level, g.value1) == (P.PacketType.GPIO_EDGE, 1, 1, 123_456)
    m = P.parse(P.function_start(3, 99))
    assert (m.function_id, m.value1) == (3, 99)
