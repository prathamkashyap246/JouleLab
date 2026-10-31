from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter()


@router.get("/latest", summary="Most recent sample plus connection status")
async def latest(request: Request):
    hw = request.app.state.hardware
    return {"sample": hw.store.latest(), "status": hw.status()}


@router.get("/history", summary="Recent live samples, or the stored samples of a session")
async def history(request: Request,
                  seconds: float | None = Query(default=10, gt=0, le=3600),
                  limit: int = Query(default=5000, ge=1, le=200_000),
                  session_id: int | None = Query(default=None, ge=1)):
    hw = request.app.state.hardware
    if session_id is not None:
        if not hw.db.get_session(session_id):
            raise HTTPException(404, f"Session {session_id} not found.")
        hw.db.flush()
        rows = hw.db.session_samples(session_id, limit)
        return {"session_id": session_id, "stored_decimation": hw.settings.db_store_decimation,
                "count": len(rows), "samples": rows}
    rows = hw.store.history(seconds, limit)
    return {"session_id": None, "seconds": seconds, "count": len(rows), "samples": rows}


@router.get("/summary", summary="Energy totals and function-level measurements")
async def summary(request: Request, session_id: int | None = Query(default=None, ge=1)):
    hw = request.app.state.hardware
    if session_id is None:
        s = hw.summary()
        s["recent_windows"] = hw.recent_windows(20)
        return s
    sess = hw.db.get_session(session_id)
    if not sess:
        raise HTTPException(404, f"Session {session_id} not found.")
    if sess["status"] == "active":
        return hw.summary()
    hw.db.flush()
    return {"scope": "session", "session_id": session_id, **(sess["summary"] or {}),
            "windows": hw.db.session_functions(session_id, 500)}
