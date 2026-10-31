"""Access rule for endpoints that run programs on this computer (build, upload, debug)."""
import ipaddress

from fastapi import HTTPException, Request, WebSocket

from app.core.config import settings


def _loopback(host: str | None) -> bool:
    if not host:
        return False
    if host in ("localhost", "testclient"):  # "testclient" = FastAPI's in-process test client
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


def is_local(conn: Request | WebSocket) -> bool:
    if settings.dev_allow_remote:
        return True
    client = conn.client.host if conn.client else None
    if not _loopback(client):
        return False
    # Requests through the frontend proxy come from 127.0.0.1; the proxy adds X-Forwarded-For
    # with the browser's real address, which must be local too.
    fwd = conn.headers.get("x-forwarded-for")
    return fwd is None or all(_loopback(x.strip()) for x in fwd.split(","))


LOCAL_ONLY_MESSAGE = ("Build, upload and debug are only allowed from this computer. "
                      "Set DEV_ALLOW_REMOTE=true in backend/.env to allow other machines (they could then run "
                      "programs and flash boards on this computer).")


def require_local(request: Request) -> None:
    if not is_local(request):
        raise HTTPException(status_code=403, detail=LOCAL_ONLY_MESSAGE)
