# Code proposals and measured before/after: API for the frontend

Both are under the backend (`http://127.0.0.1:8000`, or `/backend/...` through the frontend proxy).

## 1. Proposals: `POST /api/optimizer/propose`
Request: `{"code": "<sketch source>"}`. Rule-based and deterministic (no AI).

Response:
```json
{"engine": "rules",
 "changes": [{"key": "cpu:2", "id": "cpu", "sev": "medium", "line": 2, "del": 1,
              "before": ["void setup() {"],
              "after":  ["void setup() {", "    setCpuFrequencyMhz(80);  // was 240 MHz"],
              "title": "CPU left at 240 MHz", "detail": "...", "estimate": "ESP32 datasheet: ...",
              "behavior": "Same behaviour; ..."}],
 "fixed_code": "<source with every change applied>"}
```
How to draw it (VS Code style):
- Shade lines `line` … `line + del - 1` **light red** (e.g. `rgba(248,81,73,.15)`).
- On click, show a pop-up under those lines: each `before` line with `−` on light red, then each
  `after` line with `+` on **light green** (e.g. `rgba(46,160,67,.15)`), plus `title`, `detail`,
  `estimate` (label it as a datasheet estimate) and `behavior`.
- Accept = replace `del` lines at `line` with `after`, then call `/propose` again (line numbers shift).

## 2. Measured before/after: `GET /api/sessions/compare?before=<id>&after=<id>[&k=3]`
Record two sessions in Live hardware (`POST /api/sessions/start` / `stop`), the "before" firmware
and the "after" firmware, under the same wiring. Tick *Full rate* on both for the per-module rows.

Response:
```json
{"before": {"id": 1, "name": "before-240MHz", "duration_s": 60.0, "average_power_mw": 235.1,
            "average_current_ma": 48.0, "energy_per_min_mj": 14106.0, "windows": 12, "window_std_mw": 1.2,
            "full_rate": true, "source": "hardware"},
 "after":  {...},
 "delta_power_mw": -88.4, "delta_pct": -37.6,
 "noise_mw": 1.9, "significant": true,
 "verdict": "saving of 88.4 mW is larger than the run-to-run noise (±1.9 mW)",
 "modules": [{"peak_hz": 36.0, "before": {"current_on_ma": 1.4, ...}, "after": {...}, "delta_current_on_ma": 0.0}],
 "modules_note": null}
```
- `significant` is true only when |Δ| > 3 × the standard error from the 5-second window means of both
  runs. Show the verdict text as is; when it says NOT larger, the change made no measurable difference.
- `modules` is null (with `modules_note`) unless both sessions were recorded at full rate.
