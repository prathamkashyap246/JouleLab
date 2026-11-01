from datetime import datetime

import numpy as np

from fastapi import APIRouter, HTTPException, Query, Request

from app.schemas.models import SessionStart
from app.services import separation

router = APIRouter()


@router.post("/start", summary="Start recording a measurement session (board must be streaming)")
async def start(body: SessionStart, request: Request):
    name = body.name.strip() or "Session " + datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return request.app.state.hardware.start_session(name, body.notes, body.full_rate)


@router.post("/stop", summary="Stop the running session and save its energy summary")
async def stop(request: Request):
    return request.app.state.hardware.stop_session()


@router.get("", summary="List sessions, newest first")
async def list_sessions(request: Request, limit: int = Query(default=50, ge=1, le=500)):
    hw = request.app.state.hardware
    return {"active": hw.session, "sessions": hw.db.list_sessions(limit)}


WINDOW_S = 5.0


def _session_stats(db, sid: int) -> dict:
    s = db.get_session(sid)
    if not s:
        raise HTTPException(404, f"Session {sid} not found.")
    if s["status"] == "active":
        raise HTTPException(409, f"Session {sid} is still recording. Stop it first.")
    db.flush()
    rows = db.session_samples(sid, 2_000_000)
    if len(rows) < 20:
        raise HTTPException(409, f"Session {sid} has too few stored samples.")
    t = np.array([r["t_us"] for r in rows], float) / 1e6
    p = np.array([r["power_mw"] for r in rows], float)
    i = np.array([r["current_ma"] for r in rows], float)
    t -= t[0]
    win = np.floor(t / WINDOW_S).astype(int)
    means = np.array([p[win == w].mean() for w in np.unique(win) if (win == w).sum() >= 3])
    summ = s.get("summary") or {}
    avg_p = summ.get("average_power_mw") or s.get("average_power_mw") or float(p.mean())
    avg_i = summ.get("average_current_ma") or float(i.mean())
    return {"id": sid, "name": s["name"], "source": s["source"], "full_rate": s.get("store_decimation") == 1,
            "duration_s": round(float(t[-1]), 2), "average_power_mw": round(float(avg_p), 3),
            "average_current_ma": round(float(avg_i), 3),
            "energy_per_min_mj": round(float(avg_p) * 60, 1),
            "windows": int(len(means)), "window_std_mw": round(float(means.std(ddof=1)), 3) if len(means) > 1 else None,
            "_t": t, "_i": i, "_v": float(np.median([r["voltage_v"] for r in rows])), "_means": means}


def _modules(st: dict, k: int | None) -> list[dict] | None:
    if not st["full_rate"] or len(st["_t"]) < 200:
        return None
    try:
        r = separation.separate(st["_t"], st["_i"], st["_v"], k)
    except ValueError:
        return None
    return [{"peak_hz": round(c["peak_hz"], 1), "current_on_ma": c["current_on_ma"], "avg_ma": c["avg_ma"],
             "in_baseline": c.get("in_baseline", False), "low_freq": c["low_freq"]} for c in r["components"]]


@router.get("/compare", summary="Measured before/after: two recorded sessions side by side, with a noise check")
async def compare(request: Request, before: int = Query(ge=1), after: int = Query(ge=1),
                  k: int | None = Query(default=None, ge=1, le=8, description="modules for separation (full-rate only)")):
    db = request.app.state.hardware.db
    a, b = _session_stats(db, before), _session_stats(db, after)
    d = b["average_power_mw"] - a["average_power_mw"]
    # standard error of the difference from the 5 s window means of each run
    se = None
    if len(a["_means"]) > 1 and len(b["_means"]) > 1:
        se = float(np.sqrt(a["_means"].var(ddof=1) / len(a["_means"]) + b["_means"].var(ddof=1) / len(b["_means"])))
    significant = bool(se is not None and abs(d) > 3 * max(se, 1e-9))
    ma, mb = _modules(a, k), _modules(b, k)
    pairs = []
    if ma and mb:
        used = set()
        for x in ma:
            if x["low_freq"]:
                continue
            j = next((n for n, y in enumerate(mb) if n not in used and not y["low_freq"]
                      and abs(y["peak_hz"] - x["peak_hz"]) <= 3), None)
            if j is not None:
                used.add(j)
            y = mb[j] if j is not None else None
            pairs.append({"peak_hz": x["peak_hz"], "before": x, "after": y,
                          "delta_current_on_ma": round(y["current_on_ma"] - x["current_on_ma"], 3) if y else None})
        pairs += [{"peak_hz": y["peak_hz"], "before": None, "after": y, "delta_current_on_ma": None}
                  for n, y in enumerate(mb) if n not in used and not y["low_freq"]]
    clean = lambda s: {k2: v for k2, v in s.items() if not k2.startswith("_")}  # noqa: E731
    return {
        "before": clean(a), "after": clean(b),
        "delta_power_mw": round(d, 3),
        "delta_pct": round(100 * d / a["average_power_mw"], 2) if a["average_power_mw"] else None,
        "noise_mw": round(3 * se, 3) if se is not None else None,
        "significant": significant,
        "verdict": ("not enough data for a noise check (record at least 10 s per run)" if se is None else
                    f"{'saving' if d < 0 else 'increase'} of {abs(d):.1f} mW is {'larger' if significant else 'NOT larger'}"
                    f" than the run-to-run noise (±{3 * se:.1f} mW)"),
        "modules": pairs if (ma and mb) else None,
        "modules_note": None if (ma and mb) else "Per-module comparison needs both sessions recorded with 'Full rate'.",
    }


@router.get("/{session_id}", summary="One session with its summary")
async def get_session(session_id: int, request: Request):
    s = request.app.state.hardware.db.get_session(session_id)
    if not s:
        raise HTTPException(404, f"Session {session_id} not found.")
    return s
