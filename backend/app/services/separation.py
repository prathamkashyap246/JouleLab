"""Module separation from ONE current trace (non-intrusive load monitoring).

Spectrogram of the total current -> NMF (non-negative matrix factorization,
Kullback-Leibler, multiplicative updates) -> K spectral signatures and when each
is active -> per-module current by least squares -> energy and battery share.

Numpy only (no scipy / scikit-learn), so the backend needs no new dependency.
Labels (state bits) are never used for the separation; when present they are
only used to score it.
"""
from __future__ import annotations

import numpy as np

EPS = 1e-12
NAMES = ["LED A", "LED B", "BLE"]   # state bit 0, 1, 2 in the demo firmware / simulator


# ----------------------------------------------------------------- signal tools
def even_grid(t_s: np.ndarray, i_ma: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """Resample onto an even time grid at the median sample spacing."""
    order = np.argsort(t_s)
    t_s, i_ma = t_s[order], i_ma[order]
    dt = float(np.median(np.diff(t_s)))
    if not np.isfinite(dt) or dt <= 0:
        raise ValueError("Timestamps are not increasing.")
    tg = np.arange(t_s[0], t_s[-1], dt)
    return tg, np.interp(tg, t_s, i_ma), 1.0 / dt


def stft_mag(x: np.ndarray, fs: float, win_s: float = 0.5, overlap: float = 0.75):
    n = max(16, int(win_s * fs))
    if len(x) < n * 2:
        raise ValueError(f"Need at least {2 * win_s:.0f} s of data for the spectrogram.")
    hop = max(1, int(n * (1 - overlap)))
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::hop]
    frames = frames - frames.mean(axis=1, keepdims=True)          # remove DC per window
    S = np.abs(np.fft.rfft(frames * np.hanning(n), axis=1)).T     # freq x time
    f = np.fft.rfftfreq(n, 1.0 / fs)
    t = (np.arange(frames.shape[0]) * hop + n / 2) / fs
    return f, t, S


def medfilt(x: np.ndarray, k: int = 5) -> np.ndarray:
    p = k // 2
    xp = np.pad(x, p, mode="edge")
    return np.median(np.lib.stride_tricks.sliding_window_view(xp, k), axis=1)


# ----------------------------------------------------------------- NMF
def _nndsvda(V: np.ndarray, k: int):
    U, S, Vt = np.linalg.svd(V, full_matrices=False)
    W = np.zeros((V.shape[0], k))
    H = np.zeros((k, V.shape[1]))
    W[:, 0] = np.sqrt(S[0]) * np.abs(U[:, 0])
    H[0] = np.sqrt(S[0]) * np.abs(Vt[0])
    for j in range(1, k):
        x, y = U[:, j], Vt[j]
        xp, xn, yp, yn = np.maximum(x, 0), np.maximum(-x, 0), np.maximum(y, 0), np.maximum(-y, 0)
        xpn, ypn, xnn, ynn = (np.linalg.norm(v) + EPS for v in (xp, yp, xn, yn))
        if xpn * ypn >= xnn * ynn:
            u, v, s = xp / xpn, yp / ypn, xpn * ypn
        else:
            u, v, s = xn / xnn, yn / ynn, xnn * ynn
        W[:, j] = np.sqrt(S[j] * s) * u
        H[j] = np.sqrt(S[j] * s) * v
    avg = V.mean()
    W[W < EPS] = avg
    H[H < EPS] = avg
    return W, H


def nmf_kl(V: np.ndarray, k: int, iters: int = 800):
    W, H = _nndsvda(V, k)
    for _ in range(iters):
        WH = W @ H + EPS
        H *= (W.T @ (V / WH)) / (W.sum(axis=0)[:, None] + EPS)
        WH = W @ H + EPS
        W *= ((V / WH) @ H.T) / (H.sum(axis=1)[None, :] + EPS)
    resid = float(np.linalg.norm(V - W @ H) / (np.linalg.norm(V) + EPS))
    return W, H, resid


def choose_k(V: np.ndarray, k_max: int = 10) -> tuple[int, dict[int, float]]:
    """Elbow ("knee") of the unexplained-vs-K curve: the K farthest from the straight line between
    K=1 and K=k_max. If the last module added at the knee explains <1/5 of what the one before it did,
    it is fitting noise, so step back one."""
    errs = {k: nmf_kl(V, k, iters=300)[2] for k in range(1, k_max + 1)}
    x = np.arange(1, k_max + 1, dtype=float)
    y = np.array([errs[k] for k in range(1, k_max + 1)])
    d = np.abs((y[-1] - y[0]) * x - (x[-1] - x[0]) * y + x[-1] * y[0] - y[-1] * x[0])
    K = int(x[np.argmax(d)])
    if K >= 3:
        g_last, g_prev = errs[K - 1] - errs[K], errs[K - 2] - errs[K - 1]
        if g_last < g_prev / 5:
            K -= 1
    return K, errs


# ----------------------------------------------------------------- main entry
def separate(t_s, current_ma, vbus: float, k: int | None = None, states=None,
             truth_avg_ma: dict | None = None, capacity_mah: float = 2000, usable: float = 0.76,
             f_max_view: float | None = None, names: list[str] | None = None) -> dict:
    """t_s, current_ma: samples. states: optional (t_s, state_int) arrays of state-bit changes."""
    t_s = np.asarray(t_s, float)
    current_ma = np.asarray(current_ma, float)
    if len(t_s) < 200:
        raise ValueError("Not enough samples (need a few seconds of data).")
    tg, ig, fs = even_grid(t_s, current_ma)
    if f_max_view is None:
        f_max_view = min(fs / 2, 1000.0)
    f, tt, S = stft_mag(ig, fs)
    keep = (f > 3) & ~((f > 47) & (f < 53)) & ~((f > 97) & (f < 103))   # drop DC and 50/100 Hz hum
    fk = f[keep]
    V = S[keep] / (S[keep].max() + EPS) + 1e-9

    if k is None:
        K, errs = choose_k(V)
    else:
        K, errs = k, {}
    if k is None:
        W, H, resid = nmf_kl(V, K)
        n_raw = K
        W, H, K = _merge_coactive(W, H, fk)       # pieces of one module switch on and off together
    else:
        # User fixed K. Fit extra components first: a strong broadband module (radio pulses with many
        # harmonics) otherwise uses up several components and a weak narrow one (a small LED) gets none.
        # Then merge pieces that switch on and off together, and merge the most alike until K remain.
        # Components peaking below 6 Hz are on/off edges or step loads, not modules with a frequency
        # signature; they are shown but do not count towards the requested K.
        for n_raw in (min(k + 3, 10), min(k + 2, 10), min(k + 4, 10), k):
            W, H, resid = nmf_kl(V, n_raw)
            W, H, K = _merge_coactive(W, H, fk)
            if _n_tonal(W, fk) >= k:
                break
        while _n_tonal(W, fk) > k:
            W, H, K = _merge_closest(W, H, fk)
        low = [j for j in range(K) if _peak(W[:, j], fk)[0] < 6]
        if len(low) > 1:                          # all edge/step pieces as one row
            keep_j = [j for j in range(K) if j not in low]
            W = np.column_stack([W[:, keep_j], W[:, low].sum(axis=1)])
            H = np.vstack([H[keep_j], H[low].sum(axis=0)])
            K = W.shape[1]

    # on/off activity per component, then total = baseline + sum(on_k * I_k) by least squares
    ON = np.array([_on_off(H[j]) for j in range(K)], float)
    idx = np.clip(np.searchsorted(tt, tg - tg[0]), 0, len(tt) - 1)
    # Least squares with currents kept >= 0. A component whose fit goes negative (or that is on all
    # the time) has no switching for the fit to measure: its current cannot be told apart from the
    # baseline, so it is reported as 0 mA and labelled as part of the baseline.
    active = [j for j in range(K) if 0.02 < ON[j].mean() < 0.98]
    i_on = np.zeros(K)
    while True:
        A = np.column_stack([np.ones_like(tg)] + [ON[j, idx] for j in active])
        coef, *_ = np.linalg.lstsq(A, ig, rcond=None)
        neg = [j for j, c in zip(active, coef[1:]) if c < 0]
        if not neg:
            break
        active = [j for j in active if j not in neg]
    base_ma = float(coef[0])
    for j, c in zip(active, coef[1:]):
        i_on[j] = c
    in_baseline = set(range(K)) - set(active)
    dur = float(tg[-1] - tg[0])
    total_avg = float(ig.mean())

    comps = []
    for j in range(K):
        avg = float(i_on[j] * ON[j].mean())
        days_without = (capacity_mah * usable / max(total_avg - avg, 1e-6) / 24) if total_avg > avg else None
        comps.append({
            "id": j,
            "peak_hz": float(fk[np.argmax(W[:, j])]),
            "signature": _thin(W[:, j] / (W[:, j].max() + EPS), fk, f_max_view),
            "activity": [round(float(v), 4) for v in H[j] / (H[j].max() + EPS)],
            "on": [int(v) for v in ON[j]],
            "current_on_ma": round(float(i_on[j]), 3),
            "avg_ma": round(avg, 3),
            "energy_mj": round(vbus * avg * dur, 2),
            "share_pct": round(100 * avg / total_avg, 2) if total_avg > 0 else None,
            "days_without": round(days_without, 2) if days_without else None,
            "low_freq": bool(fk[np.argmax(W[:, j])] < 6),   # step-like / switching edges: no frequency signature
            "in_baseline": j in in_baseline,
        })
        if j in in_baseline:
            comps[-1]["module"] = f"Module {j + 1} · always-on (in baseline)"
    comps.sort(key=lambda c: c["peak_hz"])

    out = {
        "fs_hz": round(fs, 2), "duration_s": round(dur, 2), "vbus_v": round(vbus, 4),
        "samples": int(len(tg)), "k": K if k is None else sum(1 for c in comps if not c["low_freq"]),
        "k_auto": k is None, "nmf_components": n_raw,
        "k_curve": {str(a): round(b, 4) for a, b in errs.items()},
        "unexplained": round(resid, 4),
        "baseline_ma": round(base_ma, 3), "total_avg_ma": round(total_avg, 3),
        "total_energy_mj": round(vbus * total_avg * dur, 2),
        "days_total": round(capacity_mah * usable / total_avg / 24, 2) if total_avg > 0 else None,
        "times": [round(float(x), 3) for x in tt],
        "components": comps,
        "spectrogram": _spec_view(S, f, f_max_view),
        "trace": _trace_view(tg - tg[0], ig),
        "scoring": None, "truth": truth_avg_ma,
    }
    if states is not None:
        out["scoring"] = _score(states, tt + t_s.min(), comps, names or NAMES)
    return out


# ----------------------------------------------------------------- helpers
TONAL = 6.0   # peak / median of a signature above this: one narrow line (an LED's PWM), not broadband


def _peak(w, fk):
    return float(fk[int(np.argmax(w))]), float(w.max() / (np.median(w) + EPS))


def _related(fa, fb, tol=3.0):
    """Same line, or one a harmonic (2x..5x) of the other."""
    lo, hi = sorted((fa, fb))
    if hi - lo <= tol:
        return True
    n = round(hi / max(lo, EPS))
    return 2 <= n <= 5 and abs(hi - n * lo) <= tol * n


def _may_merge(W, a, b, fk):
    """Two narrow lines at unrelated frequencies are two different modules, however often they happen
    to be on together. Pieces of a broadband module (radio pulses) or of one line may be merged."""
    fa, ta = _peak(W[:, a], fk)
    fb, tb = _peak(W[:, b], fk)
    if ta >= TONAL and tb >= TONAL:
        return _related(fa, fb)
    return True


def _merge_coactive(W, H, fk, thr: float = 0.35):
    """A broadband module (e.g. jittered radio pulses) can be split by NMF into several pieces that
    turn on and off together. Merge components whose on/off activity correlates above thr, unless
    they are clearly two separate narrow lines."""
    K = W.shape[1]
    if K < 2:
        return W, H, K
    ON = np.array([_on_off(H[j]) for j in range(K)], float)
    C = np.nan_to_num(np.corrcoef(ON))
    parent = list(range(K))
    def root(a):
        while parent[a] != a:
            a = parent[a]
        return a
    for a in range(K):
        for b in range(a + 1, K):
            if C[a, b] > thr and _may_merge(W, a, b, fk):
                parent[root(b)] = root(a)
    groups = {}
    for j in range(K):
        groups.setdefault(root(j), []).append(j)
    if len(groups) == K:
        return W, H, K
    Wn = np.column_stack([W[:, g].sum(axis=1) for g in groups.values()])
    Hn = np.vstack([H[g].sum(axis=0) for g in groups.values()])
    return Wn, Hn, len(groups)


def _n_tonal(W, fk):
    return sum(1 for j in range(W.shape[1]) if _peak(W[:, j], fk)[0] >= 6)


def _merge_closest(W, H, fk):
    """Merge one pair to reach a requested K: pieces of the same line first, then the most alike
    on/off activity among pairs that may be merged."""
    K = W.shape[1]
    ON = np.array([_on_off(H[j]) for j in range(K)], float)
    C = np.nan_to_num(np.corrcoef(ON))
    best, pair = -np.inf, (0, 1)
    for a in range(K):
        for b in range(a + 1, K):
            fa, _ = _peak(W[:, a], fk)
            fb, _ = _peak(W[:, b], fk)
            if fa < 6 or fb < 6:
                continue
            score = C[a, b] + (2.0 if _related(fa, fb) else 0.0) - (0.0 if _may_merge(W, a, b, fk) else 4.0)
            if score > best:
                best, pair = score, (a, b)
    a, b = pair
    W, H = W.copy(), H.copy()
    W[:, a] += W[:, b]
    H[a] += H[b]
    return np.delete(W, b, axis=1), np.delete(H, b, axis=0), K - 1


def _on_off(h: np.ndarray) -> np.ndarray:
    hs = medfilt(h, 5)
    lo, hi = np.percentile(hs, 10), np.percentile(hs, 90)
    return hs > (lo + hi) / 2


def _thin(y, f, fmax, n=160):
    m = f <= fmax
    y, f = y[m], f[m]
    step = max(1, len(f) // n)
    return {"f": [round(float(v), 2) for v in f[::step]], "y": [round(float(v), 4) for v in y[::step]]}


def _spec_view(S, f, fmax, max_f=120, max_t=240):
    m = (f > 3) & (f <= fmax)
    Sv, fv = S[m], f[m]
    fs_, ts_ = max(1, len(fv) // max_f), max(1, Sv.shape[1] // max_t)
    Sv = Sv[: (len(fv) // fs_) * fs_, : (Sv.shape[1] // ts_) * ts_]
    Sv = Sv.reshape(Sv.shape[0] // fs_, fs_, Sv.shape[1] // ts_, ts_).max(axis=(1, 3))
    db = 20 * np.log10(Sv / (Sv.max() + EPS) + 1e-6)
    db = np.clip(db, -60, 0)
    return {"f_max": float(fv[: len(fv) // fs_ * fs_][-1]), "rows": Sv.shape[0], "cols": Sv.shape[1],
            "db": [[round(float(v), 1) for v in row] for row in db]}


def _trace_view(t, i, n=1500):
    step = max(1, len(t) // n)
    return {"t": [round(float(v), 3) for v in t[::step]], "ma": [round(float(v), 2) for v in i[::step]]}


def _score(states, tt_abs, comps, names):
    st_t, st_v = np.asarray(states[0], float), np.asarray(states[1], int)
    pos = np.searchsorted(st_t, tt_abs, side="right") - 1
    st = np.where(pos >= 0, st_v[np.clip(pos, 0, None)], 0)
    nb = len(names)
    truth = np.array([(st >> b) & 1 for b in range(nb)], float)
    rows = []
    for c in comps:
        on = np.array(c["on"], float)
        r = [np.corrcoef(on, truth[b])[0, 1] if truth[b].std() > 0 and on.std() > 0 else 0 for b in range(nb)]
        r = np.nan_to_num(np.array(r, float))
        b = int(np.argmax(r))
        c["module"] = names[b]
        rows.append({"id": c["id"], "module": names[b], "r": round(float(r[b]), 3),
                     "on_off_accuracy": round(float((on == truth[b]).mean()), 4)})
    return rows


# ----------------------------------------------------------------- simulator
def simulate(seconds: float = 60, seed: int = 0, sample_period_us: int = 2000):
    """Fake ESP32 demo: LED A PWM 37 Hz (~10 mA), LED B PWM 173 Hz (~20 mA), BLE pulses every ~100 ms,
    random overlapping on/off. Models INA219 averaging (532 us), noise, 0.1 mA steps.
    Returns t_s, current_ma, vbus, (state_t, state_v), true average mA per module."""
    rng = np.random.default_rng(seed)
    fine = 28 / 532e-6
    t = np.arange(int(seconds * fine)) / fine

    def sched():
        on = np.zeros(len(t), bool)
        s, i = bool(rng.integers(0, 2)), 0
        while i < len(t):
            n = int(rng.uniform(0.5, 3.0) * fine)
            on[i:i + n] = s
            s, i = not s, i + n
        return on

    pwm = lambda fr: ((t * fr) % 1.0) < 0.5
    a, b, c = sched(), sched(), sched()
    la, lb = 10.0 * (a & pwm(37.0)), 20.0 * (b & pwm(173.0))
    ble = np.zeros_like(t)
    tk = 0.0
    while tk < seconds:
        i0 = int(tk * fine)
        ble[i0:i0 + int(0.003 * fine)] = 70.0
        tk += 0.100 + rng.uniform(0, 0.010)
    ble *= c
    I = 45.0 + la + lb + ble

    csum = np.concatenate([[0.0], np.cumsum(I)])           # INA219: average over 532 us before each read
    n_conv = 28
    read_idx = np.arange(n_conv, len(t), int(round(sample_period_us * 1e-6 * fine)))
    avg = (csum[read_idx] - csum[read_idx - n_conv]) / n_conv
    avg += rng.normal(0, 0.25, len(avg))
    i_ma = np.round(avg / 0.1) * 0.1
    t_s = t[read_idx]

    state = a.astype(int) | (b.astype(int) << 1) | (c.astype(int) << 2)
    chg = np.concatenate([[0], np.where(np.diff(state) != 0)[0] + 1])
    truth = {"LED A": round(float(la.mean()), 3), "LED B": round(float(lb.mean()), 3), "BLE": round(float(ble.mean()), 3)}
    return t_s, i_ma, 4.98, (t[chg], state[chg]), truth


def parse_log(text: str):
    """Accepts the profiler log format (#VBUS / S,t_us,raw / E,t_us,state) or CSV time_s,current_mA."""
    vbus, ts, raw, et, ev, sim, csv = None, [], [], [], [], False, []
    for line in text.splitlines():
        p = line.strip().split(",")
        try:
            if p[0] == "#SIM":
                sim = True
            elif p[0] == "#VBUS":
                vbus = float(p[1])
            elif p[0] == "S" and len(p) == 3:
                ts.append(int(p[1]) / 1e6); raw.append(int(p[2]) * 0.1)
            elif p[0] == "E" and len(p) == 3:
                et.append(int(p[1]) / 1e6); ev.append(int(p[2]))
            elif len(p) >= 2:
                csv.append((float(p[0]), float(p[1])))
        except ValueError:
            continue
    if ts:
        states = (np.array(et), np.array(ev)) if et else None
        return np.array(ts), np.array(raw), vbus or 5.0, states, sim
    if csv:
        a = np.array(csv)
        return a[:, 0], a[:, 1], vbus or 5.0, None, sim
    raise ValueError("No samples found. Expected 'S,t_us,raw' lines or 'time_s,current_mA' rows.")


# ----------------------------------------------------------------- virtual room
MODULE_TYPES = ("pwm", "pulse", "sine", "step")


def simulate_custom(modules: list[dict], seconds: float = 60, seed: int = 0, sample_period_us: int = 2000,
                    noise_ma: float = 0.25, baseline_ma: float = 45.0, vbus: float = 4.98):
    """Virtual room: any set of modules (max 8), each with its own waveform, frequency and current,
    switching on and off at random. Same INA219 model as simulate(). Returns
    t_s, current_ma, vbus, (state_t, state_v), truth (avg mA per module), names."""
    if not modules:
        raise ValueError("Add at least one module.")
    modules = modules[:8]
    rng = np.random.default_rng(seed)
    fine = 28 / 532e-6
    t = np.arange(int(seconds * fine)) / fine
    I = np.full(len(t), float(baseline_ma))
    state = np.zeros(len(t), dtype=np.int64)
    truth, names = {}, []

    def sched(lo, hi, always):
        if always:
            return np.ones(len(t), bool)
        on = np.zeros(len(t), bool)
        s, i = bool(rng.integers(0, 2)), 0
        while i < len(t):
            n = max(1, int(rng.uniform(lo, hi) * fine))
            on[i:i + n] = s
            s, i = not s, i + n
        return on

    for b, m in enumerate(modules):
        name = str(m.get("name") or f"Module {b + 1}")[:24]
        while name in names:
            name += "'"
        names.append(name)
        typ = m.get("type", "pwm")
        if typ not in MODULE_TYPES:
            raise ValueError(f"Unknown module type '{typ}'.")
        amp = float(m.get("current_ma", 10))
        fr = max(0.1, float(m.get("freq_hz", 10)))
        on = sched(float(m.get("on_min_s", 0.5)), float(m.get("on_max_s", 3.0)), bool(m.get("always_on", False)))
        if typ == "pwm":
            w = (((t * fr) % 1.0) < float(m.get("duty", 0.5))).astype(float)
        elif typ == "sine":
            w = 0.5 * (1 + np.sin(2 * np.pi * fr * t))
        elif typ == "step":
            w = np.ones(len(t))
        else:  # pulse train with optional timing jitter, like BLE advertising
            w = np.zeros(len(t))
            width = max(1, int(float(m.get("width_ms", 3)) / 1000 * fine))
            jit = float(m.get("jitter_pct", 10)) / 100
            tk = rng.uniform(0, 1 / fr)
            while tk < seconds:
                i0 = int(tk * fine)
                w[i0:i0 + width] = 1.0
                tk += (1 / fr) * (1 + rng.uniform(0, jit))
        sig = amp * w * on
        I += sig
        truth[name] = round(float(sig.mean()), 3)
        state |= on.astype(np.int64) << b
        del w, sig

    csum = np.concatenate([[0.0], np.cumsum(I)])          # INA219: average over 532 us before each read
    read_idx = np.arange(28, len(t), max(1, int(round(sample_period_us * 1e-6 * fine))))
    avg = (csum[read_idx] - csum[read_idx - 28]) / 28 + rng.normal(0, float(noise_ma), len(read_idx))
    i_ma = np.round(avg / 0.1) * 0.1
    chg = np.concatenate([[0], np.where(np.diff(state) != 0)[0] + 1])
    return t[read_idx], i_ma, vbus, (t[chg], state[chg]), truth, names


def to_log_text(t_s, current_ma, vbus, states, note: str = "") -> str:
    """Write samples in the profiler.ino log format (#VBUS / E,t_us,state / S,t_us,raw), tagged #SIM."""
    lines = ["#SIM"]
    if note:
        lines.append("#NOTE," + note.replace("\n", " ")[:400])
    lines += ["#BOOT", f"#VBUS,{vbus:.4f}", "#CFG,0x199D"]
    ev = list(zip((np.asarray(states[0]) * 1e6).astype(np.int64), np.asarray(states[1]))) if states else []
    k = 0
    for ts, ma in zip((np.asarray(t_s) * 1e6).astype(np.int64), current_ma):
        while k < len(ev) and ev[k][0] <= ts:
            lines.append(f"E,{ev[k][0]},{ev[k][1]}")
            k += 1
        lines.append(f"S,{ts},{int(round(ma / 0.1))}")
    return "\n".join(lines) + "\n"
