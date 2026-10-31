import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.api.deps import require_local
from app.schemas.models import ConnectRequest

router = APIRouter()


@router.get("/status", summary="Connection state, packet counters and errors")
async def status(request: Request):
    return request.app.state.hardware.status()


@router.get("/ports", summary="Serial ports; ST-LINK ports are flagged and listed first")
async def ports(request: Request):
    hw = request.app.state.hardware
    ports = await asyncio.to_thread(hw.ports)  # listing COM ports can block the event loop on Windows
    return {"ports": ports, "stlink_count": sum(p["is_stlink"] for p in ports),
            "default_baudrate": hw.settings.serial_baudrate}


@router.post("/connect", summary="Open a serial port (8N1, no flow control) and start reading")
async def connect(body: ConnectRequest, request: Request):
    return await request.app.state.hardware.connect(body.port, body.baudrate)


@router.post("/disconnect", summary="Close the serial port (stops a running session)")
async def disconnect(request: Request):
    return await request.app.state.hardware.disconnect()


class SendBody(BaseModel):
    text: str = Field(max_length=1000)
    line_ending: Literal["\n", "\r\n", "\r", ""] = "\n"


@router.post("/send", summary="Send a line of text to the board (web terminal input)",
             dependencies=[Depends(require_local)])
async def send(body: SendBody, request: Request):
    return await request.app.state.hardware.send(body.text, body.line_ending)


# ---- second, text-only connection (e.g. ESP32 logs while the NUCLEO measures) ----
class LogConnect(BaseModel):
    port: str = Field(max_length=260)
    baudrate: int | None = None


@router.get("/logport/status", summary="The text-only log port")
async def logport_status(request: Request):
    return request.app.state.logport.status()


@router.post("/logport/connect", summary="Open a second port for text logs (never the measurement port)")
async def logport_connect(body: LogConnect, request: Request):
    return await request.app.state.logport.connect(body.port, body.baudrate)


@router.post("/logport/disconnect")
async def logport_disconnect(request: Request):
    return await request.app.state.logport.disconnect()


@router.post("/logport/send", dependencies=[Depends(require_local)], summary="Send a line to the log port")
async def logport_send(body: SendBody, request: Request):
    return await request.app.state.logport.send(body.text, body.line_ending)
