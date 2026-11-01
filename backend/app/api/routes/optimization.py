import logging

from fastapi import APIRouter, HTTPException, Request

from app.core.config import settings
from app.schemas.models import OptimizeRequest
from app.services.ai_optimizer import generate_suggestions

router = APIRouter()
log = logging.getLogger("joulelab.optimizer")


@router.post("/suggest")
async def suggest(payload: OptimizeRequest, request: Request):
    if len(payload.source_code) > settings.max_source_chars:
        raise HTTPException(status_code=413, detail="Source code is too large.")
    try:
        report = generate_suggestions(
            source_code=payload.source_code,
            board=payload.board,
            measurements=payload.measurements,
            constraints=payload.constraints,
        )
    except Exception:
        log.exception("AI suggestion failed")
        # Avoid returning secrets, prompts or provider internals to the browser.
        raise HTTPException(status_code=502, detail="AI suggestion service failed.")
    data = report.model_dump()
    report_id = request.app.state.hardware.db.save_report(
        payload.session_id, payload.board,
        {"board": payload.board, "measurements": payload.measurements, "constraints": payload.constraints,
         "source_chars": len(payload.source_code)}, data)
    return {"success": True, "report_id": report_id, "report": data}


from pydantic import BaseModel, Field  # noqa: E402

from app.services import code_optimizer  # noqa: E402


class ProposeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=200_000)


@router.post("/propose", summary="Rule-based code changes (VS Code style: line, before, after); no AI")
async def propose(req: ProposeRequest):
    changes = code_optimizer.propose(req.code)
    return {"engine": "rules", "changes": changes, "fixed_code": code_optimizer.apply(req.code, changes)}
