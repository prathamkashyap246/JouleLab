"""Who may call the backend.

* The frontend proxy (port 3000) adds the shared key (X-JouleLab-Proxy-Key). Only then is
  X-Forwarded-For trusted, so a browser cannot fake being "local".
* A request without the key is accepted only when it comes straight from this computer
  (curl, scripts, /docs). Anything else gets 401, even if uvicorn listens on 0.0.0.0.
* Build / upload / debug / terminal input additionally require the original browser to be
  on this computer, unless DEV_ALLOW_REMOTE=true.
"""
import hmac
import ipaddress

from fastapi import HTTPException, Request, WebSocket
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import settings

PROXY_HEADER = b"x-joulelab-proxy-key"


def _loopback(host: str | None) -> bool:
    if not host:
        return False
    if host in ("localhost", "testclient"):  # "testclient" = FastAPI's in-process test client
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


class AccessMiddleware:
    """Pure ASGI middleware so it covers HTTP and WebSocket alike."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers") or [])
        given = headers.get(PROXY_HEADER, b"").decode("latin-1")
        key = settings.proxy_key
        via_proxy = bool(key and given and hmac.compare_digest(given, key))
        client = scope.get("client")
        direct_local = _loopback(client[0] if client else None)
        if not via_proxy and not direct_local:
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return
            body = b'{"detail":"Not allowed. Use the JouleLab website (port 3000), or call the API from this computer."}'
            await send({"type": "http.response.start", "status": 401,
                        "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": body})
            return
        scope.setdefault("state", {})["via_proxy"] = via_proxy
        await self.app(scope, receive, send)


def is_local(conn: Request | WebSocket) -> bool:
    if settings.dev_allow_remote:
        return True
    via_proxy = conn.scope.get("state", {}).get("via_proxy", False)
    if not via_proxy:  # direct call; the middleware already required it to come from this computer
        return _loopback(conn.client.host if conn.client else None)
    fwd = conn.headers.get("x-forwarded-for")
    # the proxy appends the real browser address, so a forged value cannot hide it
    return fwd is not None and all(_loopback(x.strip()) for x in fwd.split(","))


LOCAL_ONLY_MESSAGE = ("Build, upload, debug and terminal input are only allowed from this computer. "
                      "Set DEV_ALLOW_REMOTE=true in backend/.env to allow other machines (they could then run "
                      "programs and flash boards on this computer).")


def require_local(request: Request) -> None:
    if not is_local(request):
        raise HTTPException(status_code=403, detail=LOCAL_ONLY_MESSAGE)
