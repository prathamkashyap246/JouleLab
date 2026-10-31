from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.api.deps import require_local

router = APIRouter(dependencies=[Depends(require_local)])


class DebugStart(BaseModel):
    board: str = Field(max_length=40)
    source: str | None = Field(default=None, max_length=500_000)


class DebugCommand(BaseModel):
    command: str = Field(min_length=1, max_length=300)


@router.post("/start", summary="Start a GDB session (NUCLEO-F446RE via ST-LINK)")
async def start(body: DebugStart, request: Request):
    return request.app.state.debugger.start(body.board, body.source).public()


@router.post("/stop", summary="End the debug session")
async def stop(request: Request):
    return {"job": await request.app.state.debugger.stop()}


@router.post("/command", summary="Send one GDB command (e.g. continue, next, bt)")
async def command(body: DebugCommand, request: Request):
    request.app.state.debugger.command(body.command)
    return {"sent": body.command}


@router.get("/status")
async def status(request: Request):
    return request.app.state.debugger.status()
