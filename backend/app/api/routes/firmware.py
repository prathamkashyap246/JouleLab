"""Kept for older clients. POST /api/firmware/upload now really builds and flashes, via the
same upload workflow as the Workspace (POST /api/development/upload)."""
from fastapi import APIRouter, Depends, Request

from app.api.deps import require_local
from app.schemas.models import FirmwareUpload
from app.services.platformio_manager import BOARDS, DevError

router = APIRouter(dependencies=[Depends(require_local)])

ALIASES = {"esp32": "esp32dev", "esp32 devkit": "esp32dev", "stm32": "nucleo_f446re",
           "nucleo-f446re": "nucleo_f446re", "stm32 nucleo-f446re": "nucleo_f446re",
           "arduino uno": "uno", "arduino uno r3": "uno"}


@router.post("/upload", summary="Save source as the board's main file, then build and flash it")
async def upload_firmware(payload: FirmwareUpload, request: Request, port: str | None = None):
    key = payload.board.strip().lower()
    board = key if key in BOARDS else ALIASES.get(key)
    if board is None:
        raise DevError(f"Unknown board '{payload.board}'. Supported: {', '.join(BOARDS)}.", 404)
    job = await request.app.state.uploader.upload(board, port, payload.source_code)
    return {"accepted": True, "job": job.public(),
            "message": "Upload started. Follow /ws/build-output; success is reported only if PlatformIO exits with 0."}
