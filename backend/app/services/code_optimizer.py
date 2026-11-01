"""Rule-based code changes for ESP32 Arduino sketches, VS Code style.

Each proposed change replaces `del` lines starting at `line` (1-based) with the lines in `after`.
A frontend shades lines line..line+del-1 red and shows `before` (red, "-") and `after` (green, "+").

Deterministic rules, no AI. `estimate` quotes datasheet-typical figures only: the real effect is
what a before/after measurement shows (POST /api/sessions/compare).
Same rules as the Workspace's /api/analyze in frontend/server.js, moved here so any frontend can use them.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable


def _indent(line: str) -> str:
    return re.match(r"^\s*", line).group(0)


@dataclass(frozen=True)
class Rule:
    id: str
    sev: str
    title: str
    detail: str
    estimate: str
    behavior: str
    make: Callable[[str], list[str]]
    pattern: re.Pattern | None = None                      # line rule: every matching line
    test: Callable[[str], bool] | None = None              # extra check on a matching line
    when: Callable[[str], bool] | None = None              # whole-file rule: applies if true ...
    find: Callable[[list[str]], int] | None = None         # ... at this line index (-1 = nowhere)


def _first(lines: list[str], rx: str) -> int:
    r = re.compile(rx)
    return next((i for i, l in enumerate(lines) if r.search(l)), -1)


_DELAY = re.compile(r"\bdelay\s*\(\s*(\d{4,})\s*\)\s*;?")
_ADV = re.compile(r"set(?:Min|Max)Interval\s*\(\s*(\d+)\s*\)")
_BUSY = re.compile(r"while\s*\(\s*WiFi\.status\(\)\s*!=\s*WL_CONNECTED\s*\)\s*delay\s*\(\s*\d+\s*\)\s*;")


def _adv_fix(l: str) -> list[str]:
    l = _ADV.sub(lambda m: m.group(0).replace(m.group(1), "1600"), l)
    l = re.sub(r"//.*$", "", l).rstrip()
    return [l + "  // 1600 x 0.625 ms = 1 s"]


RULES: list[Rule] = [
    Rule("cpu", "medium", "CPU left at 240 MHz",
         "Light work (GPIO, PWM, short delays, BLE advertising) runs fine at 80 MHz, the lowest setting "
         "that keeps Wi-Fi/BT working.",
         "ESP32 datasheet: modem-sleep at 240 MHz ≈ 30–68 mA; at 80 MHz ≈ 20–31 mA.",
         "Same behaviour; code runs about 3x slower, which only matters for heavy computation.",
         make=lambda l: [l, _indent(l) + "  setCpuFrequencyMhz(80);  // was 240 MHz"],
         when=lambda code: bool(re.search(r"void\s+setup\s*\(\s*\)", code)) and "setCpuFrequencyMhz" not in code,
         find=lambda lines: _first(lines, r"void\s+setup\s*\(\s*\)\s*\{")),
    Rule("delay", "high", "Blocking delay() keeps the CPU awake",
         "Core and radio stay powered for the whole wait. Deep sleep restarts setup() on wake, so keep state "
         "in RTC_DATA_ATTR variables.",
         "ESP32 datasheet: awake idle ≈ 20–68 mA; deep sleep with RTC timer ≈ 10 µA.",
         "Changes program flow: the board reboots after each sleep.",
         make=lambda l: [_DELAY.sub(lambda m: f"esp_sleep_enable_timer_wakeup({m.group(1)} * 1000ULL); "
                                              "esp_deep_sleep_start();", l)],
         pattern=_DELAY),
    Rule("adv", "medium", "BLE advertising faster than needed",
         "Each advertising event is a radio burst on three channels. Advertising every 1 s instead of every "
         "100 ms sends ten times fewer bursts.",
         "Advertising energy scales roughly with 1 / interval.",
         "Phones take longer (up to ~1 s) to discover the device.",
         make=_adv_fix, pattern=_ADV, test=lambda l: int(_ADV.search(l).group(1)) < 800),
    Rule("busy", "medium", "Unbounded busy-wait for Wi-Fi",
         "If the access point is missing, this loop keeps the radio searching forever.",
         "Wi-Fi RX/association ≈ 95–100 mA for as long as the loop runs.",
         "Gives up after 5 s; handle the not-connected case afterwards.",
         make=lambda l: [_indent(l) + "for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) delay(250);"
                                      "  // give up after 5 s"],
         pattern=_BUSY),
    Rule("radio", "medium", "Radio stays on after the last transmit",
         "Wi-Fi keeps listening between transmissions unless it is switched off.",
         "Wi-Fi connected idle ≈ 20–30 mA above modem-sleep.",
         "Reconnect (WiFi.begin) before the next transmit.",
         make=lambda l: [l, _indent(l) + "WiFi.disconnect(true); WiFi.mode(WIFI_OFF);"],
         when=lambda code: "WiFi.begin" in code and not re.search(r"WiFi\.(disconnect|mode\s*\(\s*WIFI_OFF)", code),
         find=lambda lines: _first(lines, r"\bhttp\.end\s*\(\s*\)")),
]


def propose(code: str) -> list[dict]:
    lines = code.split("\n")
    hits: list[tuple[int, Rule]] = []
    for r in RULES:
        if r.when is not None:
            if r.when(code):
                i = r.find(lines)
                if i >= 0:
                    hits.append((i, r))
        else:
            hits += [(i, r) for i, l in enumerate(lines) if r.pattern.search(l) and (r.test is None or r.test(l))]
    out = []
    for i, r in hits:
        after = r.make(lines[i])
        if after == [lines[i]]:
            continue
        out.append({"key": f"{r.id}:{i + 1}", "id": r.id, "sev": r.sev, "line": i + 1, "del": 1,
                    "before": [lines[i]], "after": after, "title": r.title, "detail": r.detail,
                    "estimate": r.estimate, "behavior": r.behavior})
    return sorted(out, key=lambda c: c["line"])


def apply(code: str, changes: list[dict]) -> str:
    lines = code.split("\n")
    for c in sorted(changes, key=lambda c: c["line"], reverse=True):
        lines[c["line"] - 1:c["line"] - 1 + c["del"]] = c["after"]
    return "\n".join(lines)
