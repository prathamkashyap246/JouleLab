from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Request

from app.schemas.models import SessionStart

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


@router.get("/{session_id}", summary="One session with its summary")
async def get_session(session_id: int, request: Request):
    s = request.app.state.hardware.db.get_session(session_id)
    if not s:
        raise HTTPException(404, f"Session {session_id} not found.")
    return s
