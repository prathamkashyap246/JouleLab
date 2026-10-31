from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.api.deps import require_local
from app.services.platformio_manager import BOARDS, DevError, get_board

router = APIRouter(dependencies=[Depends(require_local)])


class SourceBody(BaseModel):
    source: str = Field(max_length=500_000)


class BuildBody(BaseModel):
    board: str = Field(max_length=40)
    source: str | None = Field(default=None, max_length=500_000,
                               description="Editor contents; saved as the board's main file before building.")


class UploadBody(BuildBody):
    port: str | None = Field(default=None, max_length=260,
                             description="Required for ESP32/Uno (serial upload). Ignored for the NUCLEO (ST-LINK).")


@router.get("/boards", summary="Supported boards and PlatformIO status")
async def boards(request: Request):
    pio = request.app.state.pio
    cmd = pio.command()
    return {"boards": [b.public() for b in BOARDS.values()],
            "platformio": {"installed": cmd is not None, "command": " ".join(cmd) if cmd else None,
                           "version": pio.version() if cmd else None}}


@router.get("/ports", summary="Serial ports, and which one the shared serial manager has open")
async def ports(request: Request):
    hw = request.app.state.hardware
    st = hw.status()
    return {"ports": hw.ports(), "monitor_port": st["port"], "monitor_state": st["state"]}


@router.get("/project/{board}", summary="The board project's main source file")
async def get_project(board: str, request: Request):
    b = get_board(board)
    pio = request.app.state.pio
    return {"board": b.id, "main_file": b.main_file, "project_dir": str(pio.ensure_project(b)),
            "source": pio.read_main(b)}


@router.put("/project/{board}", summary="Save the main source file")
async def put_project(board: str, body: SourceBody, request: Request):
    b = get_board(board)
    path = request.app.state.pio.write_main(b, body.source)
    return {"board": b.id, "saved": str(path)}


@router.post("/project/{board}/reset", summary="Restore the board project from its template")
async def reset_project(board: str, request: Request):
    b = get_board(board)
    pio = request.app.state.pio
    if request.app.state.jobs.busy:
        raise DevError("Stop the running job before resetting the project.", 409)
    pio.reset_project(b)
    return {"board": b.id, "main_file": b.main_file, "source": pio.read_main(b)}


@router.post("/build", summary="Verify: pio run -e <board>")
async def build(body: BuildBody, request: Request):
    return request.app.state.builder.build(body.board, body.source).public()


@router.post("/upload", summary="Upload: pio run -e <board> -t upload")
async def upload(body: UploadBody, request: Request):
    job = await request.app.state.uploader.upload(body.board, body.port, body.source)
    return job.public()


@router.get("/job", summary="The running (or last) build/upload/debug job")
async def job(request: Request):
    jobs = request.app.state.jobs
    j = jobs.current or jobs.last
    return {"busy": jobs.busy, "job": j.public() if j else None}


@router.post("/stop", summary="Stop the running build, upload or debug session")
async def stop(request: Request):
    result = await request.app.state.jobs.stop()
    return {"stopped": result is not None, "job": result}
