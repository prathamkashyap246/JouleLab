from app.hardware import stm32_protocol as P
from app.hardware.packet_decoder import PacketDecoder
from app.hardware.sample_stream import SampleStream
from helpers import stream


def run(data):
    s = SampleStream()
    ev = s.process(PacketDecoder().feed(data))
    return s, [e for k, e in ev if k == "sample"], ev


def test_samples_timestamped_from_board_clock():
    s, samples, _ = run(stream(10, period_us=2000, t0=1_000_000))
    assert [x.t_us for x in samples] == [1_000_000 + 2000 * k for k in range(10)]
    assert samples[0].contiguous is False and all(x.contiguous for x in samples[1:])
    assert s.state.period_us == 2000


def test_nothing_released_before_hello():
    data = stream(5)[11:]  # strip the HELLO
    s, samples, _ = run(data)
    assert samples == [] and s.stats.unsynced_samples == 5


def test_samples_before_first_sync_are_released_once_synced():
    data = P.hello() + P.measurement(1, 3300, 0) + P.measurement(2, 3300, 1) + P.time_sync(500, 1000, 1)
    _, samples, _ = run(data)
    assert [(x.index, x.t_us) for x in samples] == [(0, -500), (1, 500)]


def test_lost_samples_detected_and_marked_non_contiguous():
    s, samples, ev = run(stream(20, drop={7, 8}))
    assert s.stats.lost_samples == 2
    after = [x for x in samples if x.index == 9][0]
    assert after.contiguous is False
    assert any(k == "loss" and e["lost"] == 2 for k, e in ev)


def test_duplicate_measurement_ignored():
    data = stream(3) + P.measurement(10_000, 3300, 2)  # seq 2 repeated
    s, samples, _ = run(data)
    assert s.stats.duplicates == 1 and len(samples) == 3


def test_sequence_wraps_at_256():
    s, samples, _ = run(stream(600, start_seq=250))
    assert len(samples) == 600 and s.stats.lost_samples == 0
    assert samples[-1].index == 599 and samples[-1].t_us == 1_000_000 + 599 * 2000


def test_sync_after_lost_measurement_does_not_fake_a_resync():
    # the measurement carrying the sync's seq is lost; the sync is still valid
    s, _, _ = run(stream(300, drop={100, 200}))
    assert s.stats.resyncs == 0 and s.stats.lost_samples == 2


def test_lost_256_samples_found_by_time_sync():
    # drop exactly 256 consecutive samples: the 8-bit seq cannot show it, the board clock can
    s, samples, ev = run(stream(700, drop=set(range(300, 556))))
    assert s.stats.lost_samples == 256
    assert any(k == "resync" for k, _ in ev)
    last = samples[-1]
    assert last.t_us == 1_000_000 + 699 * 2000


def test_board_clock_32bit_wrap():
    t0 = 0xFFFFFFFF - 50_000  # wraps after 25 samples
    s, samples, _ = run(stream(300, t0=t0))
    assert s.stats.resyncs == 0
    assert samples[-1].t_us == t0 + 299 * 2000  # unwrapped, keeps increasing


def test_firmware_reset_starts_new_epoch():
    data = stream(150, t0=50_000_000) + stream(150, t0=1_000)
    s, samples, ev = run(data)
    assert s.stats.firmware_resets == 1
    assert samples[-1].epoch > samples[0].epoch


def test_test_source_flag_and_bad_magic():
    s, _, _ = run(stream(3, flags=P.FLAG_TEST_SOURCE))
    assert s.state.test_source is True
    s2, samples, ev = run(P.encode(P.PacketType.HELLO, 0x12345678, 0, 0) + stream(3)[11:])
    assert s2.state.protocol_ok is False and samples == []


def test_device_status_reported():
    _, _, ev = run(P.device_status(P.DeviceStatus.INA219_NOT_FOUND, 4))
    st = [e for k, e in ev if k == "device_status"][0]
    assert st["code"] == 1 and "INA219" in st["message"]


def test_markers_carry_board_time():
    _, _, ev = run(stream(5) + P.function_start(2, 1_004_000) + P.gpio_edge(1, 0, 1_005_000))
    marks = [e for k, e in ev if k == "marker"]
    assert marks[0] == {"source": "firmware", "start": True, "function_id": 2, "t_us": 1_004_000}
    assert marks[1]["source"] == "gpio" and marks[1]["start"] is False and marks[1]["channel"] == 1
