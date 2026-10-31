"""Energy calculations.

Units used throughout:
    voltage  V      current  mA      power  mW  (= V * mA)
    time     µs     energy   mJ      (mW * s)

Energy is the trapezoidal integral of power over time. An interval between
two samples is only integrated when both samples are valid and consecutive
(no lost sample in between, same stream epoch). Gaps are reported as
`missing_time_s`, never filled in.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import numpy as np


def power_mw(voltage_v: float, current_ma: float) -> float:
    return voltage_v * current_ma


def integrate_energy_mj(samples: list[dict]) -> float:
    """Trapezoidal energy of a list of {timestamp_us, voltage_v, current_ma}. Returns mJ.
    Generic helper (no gap handling): the caller must pass one contiguous trace."""
    if len(samples) < 2:
        return 0.0
    ordered = sorted(samples, key=lambda x: x["timestamp_us"])
    t = np.array([s["timestamp_us"] for s in ordered], dtype=float) / 1e6
    p = np.array([s["voltage_v"] * s["current_ma"] for s in ordered], dtype=float)  # mW
    dt = np.diff(t)
    mask = dt > 0
    return round(float(np.sum(((p[:-1] + p[1:]) / 2 * dt)[mask])), 6)


@dataclass
class Sample:
    index: int
    t_us: int
    voltage_v: float
    current_ma: float
    power_mw: float
    epoch: int
    contiguous: bool
    function: str | None = None
    energy_mj: float = 0.0  # running energy at this sample (scope: connection or session)

    def public(self) -> dict:
        return {"index": self.index, "t_us": self.t_us, "voltage_v": round(self.voltage_v, 4),
                "current_ma": round(self.current_ma, 4), "power_mw": round(self.power_mw, 4),
                "energy_mj": round(self.energy_mj, 6), "function": self.function}


def integrate_window(t_us: np.ndarray, p_mw: np.ndarray, ok: np.ndarray, a: int, b: int) -> dict:
    """Integrate a piecewise-linear power trace over [a, b] µs with linear
    interpolation at both boundaries.

    t_us, p_mw: sample times and powers (sorted). ok[i] is True when the
    interval (i-1, i) is valid (consecutive samples). Returns energy_mj,
    avg_power_mw, max_power_mw, or complete=False with a reason.
    """
    if b <= a:
        return {"complete": False, "reason": "end marker not after start marker"}
    if len(t_us) < 2 or a < t_us[0]:
        return {"complete": False, "reason": "window starts before the buffered trace"}
    if b > t_us[-1]:
        return {"complete": False, "reason": "trace does not cover the window end yet"}
    i0 = int(np.searchsorted(t_us, a, side="right")) - 1  # sample at or before a
    i1 = int(np.searchsorted(t_us, b, side="left"))  # sample at or after b
    if not np.all(ok[i0 + 1:i1 + 1]):
        return {"complete": False, "reason": "lost samples inside the window"}

    def interp(x: int) -> float:
        return float(np.interp(x, t_us[i0:i1 + 1], p_mw[i0:i1 + 1]))

    inner_t = t_us[i0 + 1:i1]
    inner_p = p_mw[i0 + 1:i1]
    tt = np.concatenate(([a], inner_t, [b])).astype(float)
    pp = np.concatenate(([interp(a)], inner_p, [interp(b)])).astype(float)
    energy = float(np.sum((pp[:-1] + pp[1:]) / 2 * np.diff(tt))) / 1e6  # mW*µs -> mJ
    dur_s = (b - a) / 1e6
    # Max power: samples strictly inside the window. A sample exactly on a boundary belongs to the
    # neighbouring function, so boundary values are used only when the window holds no sample at all.
    inside = inner_p[(inner_t > a) & (inner_t < b)]
    peak = float(np.max(inside)) if inside.size else float(np.max(pp))
    return {"complete": True, "energy_mj": energy, "avg_power_mw": energy / dur_s, "max_power_mw": peak}


@dataclass
class FunctionStats:
    name: str
    source: str  # "firmware" (reported by code on the STM32) or "gpio" (edges timed by the STM32)
    calls: int = 0
    complete_calls: int = 0
    incomplete_calls: int = 0
    total_duration_us: int = 0
    total_energy_mj: float = 0.0
    max_power_mw: float = 0.0

    def public(self) -> dict:
        n = self.complete_calls
        dur_ms = self.total_duration_us / 1000
        return {
            "function_name": self.name,
            "source": self.source,
            "calls": self.calls,
            "complete_calls": n,
            "incomplete_calls": self.incomplete_calls,
            "duration_ms": round(dur_ms, 4),
            "avg_duration_ms": round(dur_ms / n, 4) if n else None,
            "energy_mJ": round(self.total_energy_mj, 6),
            "energy_per_call_mJ": round(self.total_energy_mj / n, 6) if n else None,
            "average_power_mW": round(self.total_energy_mj / (self.total_duration_us / 1e6), 4)
            if self.total_duration_us else None,
            "max_power_mW": round(self.max_power_mw, 4),
            "sample_count": n,  # kept for older clients (Workspace AI request)
        }


@dataclass
class EnergyEngine:
    """Running totals + function windows for one scope (connection or session)."""
    buffer_seconds: float = 120.0
    function_names: dict[int, str] = field(default_factory=dict)
    gpio_names: dict[int, str] = field(default_factory=dict)
    # Function whose average power is the "idle" floor (includes the measurement firmware's own
    # timer/I2C/UART activity when profiling the STM32 itself). Empty = no baseline.
    baseline_function: str = "idle_sleep"

    def __post_init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.energy_mj = 0.0
        self.integrated_time_us = 0
        self.missing_time_us = 0
        self.gaps = 0
        self.sample_count = 0
        self.charge_mas = 0.0  # mA*s, for average current
        self.peak_power_mw = float("-inf")
        self.peak_current_ma = float("-inf")
        self.negative_current_samples = 0
        self.first_t_us: int | None = None
        self.last: Sample | None = None
        self._buf: deque[Sample] = deque()
        self._open: dict[tuple[str, str], list[int]] = {}
        self._pending: list[dict] = []
        self.functions: dict[tuple[str, str], FunctionStats] = {}
        self.unmatched_markers = 0
        self.recent_windows: deque[dict] = deque(maxlen=200)

    # ---- samples ---------------------------------------------------------
    def add(self, s: Sample) -> list[dict]:
        """Add one sample; returns any function windows completed by it."""
        prev = self.last
        if prev is not None and s.contiguous and s.epoch == prev.epoch and s.index == prev.index + 1:
            dt_us = s.t_us - prev.t_us
            if dt_us > 0:
                self.energy_mj += (prev.power_mw + s.power_mw) / 2 * dt_us / 1e6
                self.charge_mas += (prev.current_ma + s.current_ma) / 2 * dt_us / 1e6
                self.integrated_time_us += dt_us
        elif prev is not None:
            self.gaps += 1
            if s.epoch == prev.epoch and s.t_us > prev.t_us:
                self.missing_time_us += s.t_us - prev.t_us
        if self.first_t_us is None:
            self.first_t_us = s.t_us
        s.function = self.current_function()
        s.energy_mj = self.energy_mj
        self.sample_count += 1
        self.peak_power_mw = max(self.peak_power_mw, s.power_mw)
        self.peak_current_ma = max(self.peak_current_ma, s.current_ma)
        if s.current_ma < 0:
            self.negative_current_samples += 1
        self.last = s

        if self._buf and self._buf[-1].epoch != s.epoch:
            # new epoch: windows still waiting on the old trace can never complete
            for w in self._pending:
                self._finish(w, {"complete": False, "reason": "stream restarted inside the window"})
            self._pending.clear()
            self._buf.clear()
        self._buf.append(s)
        horizon = s.t_us - int(self.buffer_seconds * 1e6)
        while self._buf and self._buf[0].t_us < horizon:
            self._buf.popleft()
        return self._settle()

    def current_function(self) -> str | None:
        for (name, _source), stack in reversed(list(self._open.items())):
            if stack:
                return name
        return None

    # ---- markers -----------------------------------------------------------
    def marker(self, ev: dict) -> list[dict]:
        if ev["source"] == "gpio":
            ch = ev["channel"]
            name = self.gpio_names.get(ch, f"gpio{ch}")
        else:
            fid = ev["function_id"]
            name = self.function_names.get(fid, f"function_{fid}")
        key = (name, ev["source"])
        stack = self._open.setdefault(key, [])
        if ev["start"]:
            if ev["source"] == "gpio" and stack:  # missed falling edge
                self.unmatched_markers += 1
                stack.clear()
            stack.append(ev["t_us"])
            return []
        if not stack:
            self.unmatched_markers += 1
            return []
        a = stack.pop()
        self._pending.append({"name": name, "source": ev["source"], "start_us": a, "end_us": ev["t_us"]})
        return self._settle()

    def _settle(self) -> list[dict]:
        if not self._pending or not self._buf:
            return []
        last_t = self._buf[-1].t_us
        done, keep = [], []
        for w in self._pending:
            (done if w["end_us"] <= last_t else keep).append(w)
        self._pending = keep
        if not done:
            return []
        t = np.fromiter((x.t_us for x in self._buf), dtype=np.int64, count=len(self._buf))
        p = np.fromiter((x.power_mw for x in self._buf), dtype=float, count=len(self._buf))
        ok = np.fromiter((x.contiguous for x in self._buf), dtype=bool, count=len(self._buf))
        return [self._finish(w, integrate_window(t, p, ok, w["start_us"], w["end_us"])) for w in done]

    def _finish(self, w: dict, r: dict) -> dict:
        key = (w["name"], w["source"])
        st = self.functions.setdefault(key, FunctionStats(*key))
        st.calls += 1
        dur = w["end_us"] - w["start_us"]
        if r["complete"]:
            st.complete_calls += 1
            st.total_duration_us += dur
            st.total_energy_mj += r["energy_mj"]
            st.max_power_mw = max(st.max_power_mw, r["max_power_mw"])
        else:
            st.incomplete_calls += 1
        out = {**w, "duration_us": dur, **r}
        self.recent_windows.append(out)
        return out

    # ---- reporting ---------------------------------------------------------
    def summary(self) -> dict:
        t = self.integrated_time_us / 1e6
        return {
            "energy_mj": round(self.energy_mj, 6),
            "integrated_time_s": round(t, 6),
            "missing_time_s": round(self.missing_time_us / 1e6, 6),
            "gaps": self.gaps,
            "average_power_mw": round(self.energy_mj / t, 4) if t else None,
            "average_current_ma": round(self.charge_mas / t, 4) if t else None,
            "peak_power_mw": round(self.peak_power_mw, 4) if self.sample_count else None,
            "peak_current_ma": round(self.peak_current_ma, 4) if self.sample_count else None,
            "sample_count": self.sample_count,
            "negative_current_samples": self.negative_current_samples,
            "unmatched_markers": self.unmatched_markers,
            "functions": self._functions_with_baseline(),
            "baseline": self._baseline(),
        }

    def _baseline(self) -> dict | None:
        """Average power of the baseline function, if it has complete calls."""
        for st in self.functions.values():
            if st.name == self.baseline_function and st.complete_calls and st.total_duration_us:
                return {"function": st.name, "source": st.source,
                        "power_mW": round(st.total_energy_mj / (st.total_duration_us / 1e6), 4)}
        return None

    def _functions_with_baseline(self) -> list[dict]:
        base = self._baseline()
        out = []
        for st in self.functions.values():
            d = st.public()
            if base is not None and st.complete_calls:
                # energy the function costs on top of simply idling for the same time
                floor_mj = base["power_mW"] * (st.total_duration_us / 1e6)
                d["above_baseline_mJ"] = round(st.total_energy_mj - floor_mj, 6)
                d["above_baseline_per_call_mJ"] = round((st.total_energy_mj - floor_mj) / st.complete_calls, 6)
            else:
                d["above_baseline_mJ"] = d["above_baseline_per_call_mJ"] = None
            out.append(d)
        return sorted(out, key=lambda x: x["energy_mJ"], reverse=True)
