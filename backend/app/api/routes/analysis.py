"""Module separation (spectrogram + NMF) on live data, an uploaded log, or a simulated run."""
import asyncio
from typing import Literal

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from app.services import circuit_ai, separation

router = APIRouter()


class SeparateRequest(BaseModel):
    source: Literal["live", "log", "simulated", "virtual", "session"] = "simulated"
    session_id: int | None = Field(default=None, ge=1, description="source=session: a recorded session")
    seconds: float = Field(default=60, ge=5, le=600, description="live: how much recent data; simulated: run length")
    k: int | None = Field(default=None, ge=1, le=8, description="number of modules; omit to detect automatically")
    log_text: str | None = Field(default=None, max_length=30_000_000)
    seed: int = Field(default=0, ge=0, le=10_000)
    sample_period_us: int = Field(default=2000, ge=200, le=20_000)
    capacity_mah: float = Field(default=2000, ge=100, le=100_000)
    modules: list[dict] = Field(default_factory=list, max_length=8, description="virtual room modules")
    noise_ma: float = Field(default=0.25, ge=0, le=20)
    baseline_ma: float = Field(default=45, ge=0, le=500)


@router.post("/separate", summary="Separate modules from one current trace (spectrogram + NMF)")
async def separate(req: SeparateRequest, request: Request):
    try:
        names = None
        if req.source == "simulated":
            t, i, v, states, truth = separation.simulate(req.seconds, req.seed, req.sample_period_us)
            simulated = True
        elif req.source == "virtual":
            if req.seconds > 120:
                raise HTTPException(400, "Virtual room runs are limited to 120 s.")
            t, i, v, states, truth, names = await asyncio.to_thread(
                separation.simulate_custom, req.modules, req.seconds, req.seed, req.sample_period_us,
                req.noise_ma, req.baseline_ma)
            simulated = True
        elif req.source == "log":
            if not req.log_text:
                raise HTTPException(400, "Upload a log file first.")
            t, i, v, states, simulated = separation.parse_log(req.log_text)
            truth = None
        elif req.source == "session":
            db = request.app.state.hardware.db
            sess = db.get_session(req.session_id) if req.session_id else None
            if not sess:
                raise HTTPException(404, "Choose a recorded session.")
            if sess["store_decimation"] != 1:
                raise HTTPException(400, f"Session {sess['id']} was stored averaged (1 row per "
                                         f"{sess['store_decimation']} samples), which removes the frequency "
                                         "signatures. Record a new session with 'Full rate' ticked.")
            db.flush()
            rows = db.session_samples(sess["id"], 2_000_000)
            if len(rows) < 200:
                raise HTTPException(409, "This session has too few stored samples.")
            t = np.array([r["t_us"] for r in rows], float) / 1e6
            i = np.array([r["current_ma"] for r in rows], float)
            v = float(np.median([r["voltage_v"] for r in rows]))
            states, truth = None, None
            simulated = sess["source"] == "test"
        else:
            hw = request.app.state.hardware
            rows = hw.store.history(req.seconds, 400_000)
            if len(rows) < 200:
                raise HTTPException(409, "Not enough live data yet. Connect the board and let it stream for a while.")
            t = np.array([r["t_us"] for r in rows], float) / 1e6
            i = np.array([r["current_ma"] for r in rows], float)
            v = float(np.median([r.get("voltage_v") or 0 for r in rows])) or 5.0
            states, truth = None, None
            simulated = any(r.get("source") == "test" for r in rows)
        result = await asyncio.to_thread(separation.separate, t, i, v, req.k, states, truth, req.capacity_mah,
                                         0.76, None, names)
    except ValueError as e:
        raise HTTPException(400, str(e))
    result["source"] = req.source
    result["simulated"] = bool(simulated)
    return result


class DescribeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/describe", summary="Turn a circuit description into virtual-room modules (AI or rule parser)")
async def describe(req: DescribeRequest):
    try:
        return await asyncio.to_thread(circuit_ai.describe_to_modules, req.text)
    except ValueError as e:
        raise HTTPException(400, str(e))


class VirtualLogRequest(BaseModel):
    modules: list[dict] = Field(min_length=1, max_length=8)
    seconds: float = Field(default=60, ge=5, le=120)
    seed: int = Field(default=0, ge=0, le=10_000)
    sample_period_us: int = Field(default=532, ge=200, le=20_000)
    noise_ma: float = Field(default=0.25, ge=0, le=20)
    baseline_ma: float = Field(default=45, ge=0, le=500)
    note: str = Field(default="", max_length=400)


@router.post("/virtual-log", summary="Generate a simulated log file (profiler.ino format) from virtual modules",
             response_class=PlainTextResponse)
async def virtual_log(req: VirtualLogRequest):
    try:
        t, i, v, states, truth, names = await asyncio.to_thread(
            separation.simulate_custom, req.modules, req.seconds, req.seed, req.sample_period_us,
            req.noise_ma, req.baseline_ma)
    except ValueError as e:
        raise HTTPException(400, str(e))
    desc = "; ".join(f"{m.get('name')}: {m.get('type')} {m.get('freq_hz', '')} Hz {m.get('current_ma')} mA" for m in req.modules)
    text = await asyncio.to_thread(separation.to_log_text, t, i, v, states, (req.note + " | " if req.note else "") + desc)
    return PlainTextResponse(text, headers={"Content-Disposition": 'attachment; filename="joulelab_virtual_log.txt"'})
