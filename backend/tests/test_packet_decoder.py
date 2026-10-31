from app.hardware import stm32_protocol as P
from app.hardware.packet_decoder import PacketDecoder


def test_decodes_back_to_back_packets():
    d = PacketDecoder()
    data = P.hello() + P.measurement(1000, 3300, 0) + P.time_sync(5, 2000, 0)
    pk = d.feed(data)
    assert [p.type for p in pk] == [P.PacketType.HELLO, P.PacketType.MEASUREMENT, P.PacketType.TIME_SYNC]
    assert d.stats.packets_ok == 3 and d.stats.packet_errors == 0


def test_incomplete_packets_across_reads():
    d = PacketDecoder()
    data = P.measurement(1234, 3300, 5) * 3
    out = []
    for i in range(len(data)):  # one byte at a time
        out += d.feed(data[i:i + 1])
    assert len(out) == 3 and all(p.current_ua == 1234 for p in out)
    assert d.stats.bytes_discarded == 0


def test_garbage_before_and_between_packets_is_counted():
    d = PacketDecoder()
    out = d.feed(b"\x00\x13garbage" + P.measurement(1, 3300, 0) + b"\xFF\xFF" + P.measurement(2, 3300, 1))
    assert [p.current_ua for p in out] == [1, 2]
    assert d.stats.bytes_discarded == 11
    assert d.recent_errors  # never silent


def test_corrupted_packet_rejected_and_next_one_recovered():
    d = PacketDecoder()
    bad = bytearray(P.measurement(5000, 3300, 0))
    bad[4] ^= 0x01
    out = d.feed(bytes(bad) + P.measurement(6000, 3300, 1))
    assert [p.current_ua for p in out] == [6000]
    assert d.stats.crc_errors >= 1


def test_sync_bytes_inside_payload_do_not_break_framing():
    # value1 = 0x55AA55AA contains the sync pattern inside the payload
    pkt = P.encode(P.PacketType.FUNCTION_START, 0x55AA55AA, 0xAA55, 0xAA)
    d = PacketDecoder()
    out = d.feed(b"\xAA" + pkt + pkt)  # stray 0xAA first
    assert len(out) == 2 and out[0].value1 == 0x55AA55AA and out[0].value2 == 0xAA55


def test_truncated_packet_followed_by_good_one():
    d = PacketDecoder()
    good = P.measurement(7, 3300, 3)
    out = d.feed(good[:6] + good)  # first copy cut off mid-packet
    assert [p.current_ua for p in out] == [7]
    assert d.stats.crc_errors + d.stats.bytes_discarded > 0


def test_unknown_type_counted():
    d = PacketDecoder()
    out = d.feed(P.encode(0x55, 1, 2, 3) + P.measurement(9, 3300, 0))
    assert [p.current_ua for p in out] == [9]
    assert d.stats.unknown_type == 1


def test_trailing_sync_byte_kept_for_next_read():
    d = PacketDecoder()
    pkt = P.measurement(42, 3300, 0)
    assert d.feed(b"\x01\x02" + pkt[:1]) == []
    assert [p.current_ua for p in d.feed(pkt[1:])] == [42]


def test_known_vectors_decode():
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    from send_test_samples import KNOWN_VECTORS
    d = PacketDecoder()
    out = d.feed(b"".join(p for _, p in KNOWN_VECTORS))
    assert len(out) == len(KNOWN_VECTORS) and d.stats.packet_errors == 0
