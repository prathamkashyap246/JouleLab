"""Build packet streams that look like the firmware's output."""
from app.hardware import stm32_protocol as P


def stream(n, period_us=2000, t0=1_000_000, current_ua=lambda k: 10_000, mv=3300, sync_every=100,
           flags=0, start_seq=0, drop=(), markers=None):
    """n samples; `drop` = sample numbers whose MEASUREMENT is omitted (seq still advances);
    `markers` = {sample_k: [packet bytes]} inserted before that sample's measurement."""
    out = bytearray(P.hello(flags, start_seq))
    for k in range(n):
        seq = (start_seq + k) & 0xFF
        for m in (markers or {}).get(k, []):
            out += m
        if k not in drop:
            out += P.measurement(current_ua(k), mv, seq)
        if k % sync_every == 0:
            out += P.time_sync((t0 + k * period_us) & 0xFFFFFFFF, period_us, seq)
    return bytes(out)
