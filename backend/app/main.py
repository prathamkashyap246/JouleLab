import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.deps import LOCAL_ONLY_MESSAGE, AccessMiddleware, is_local
from app.api.routes import analysis, debugging, development, firmware, hardware, measurements, optimization, sessions
from app.core.config import load_proxy_key, settings
from app.database.database import Database
from app.hardware.connection_manager import HardwareError, HardwareManager
from app.services.build_manager import BuildManager, JobRunner
from app.services.debug_manager import DebugManager
from app.services.measurement_store import LiveHub, LiveStore
from app.services.platformio_manager import DevError, PlatformIO
from app.services.serial_monitor import MonitorHub
from app.services.upload_manager import UploadManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("joulelab")


async def _retention_loop(db: Database) -> None:
    while True:
        await asyncio.sleep(3600)
        await asyncio.to_thread(db.apply_retention, settings.retention_days)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = Database(settings.database_path)
    interrupted = db.mark_interrupted()
    if interrupted:
        log.warning("%d session(s) were still active at last shutdown; marked interrupted", interrupted)
    db.apply_retention(settings.retention_days)

    store = LiveStore()
    monitor = MonitorHub()
    hw = HardwareManager(settings, db, store, monitor)  # the ONLY owner of the board's serial port
    hw.attach_loop(asyncio.get_running_loop())
    hub = LiveHub(store, hw.status, settings.ws_broadcast_hz, settings.ws_max_samples_per_message)
    hub.start()
    monitor.start()
    retention = asyncio.create_task(_retention_loop(db))
    app.state.db, app.state.hardware, app.state.hub, app.state.monitor = db, hw, hub, monitor

    pio = PlatformIO(settings)
    jobs = JobRunner(settings.dev_job_timeout_s)
    jobs.attach_loop(asyncio.get_running_loop())
    app.state.pio, app.state.jobs = pio, jobs
    app.state.builder = BuildManager(pio, jobs)
    app.state.uploader = UploadManager(pio, jobs, hw)
    app.state.debugger = DebugManager(pio, jobs)

    if settings.hardware_mode == "serial":
        try:
            await hw.connect(settings.serial_port, settings.serial_baudrate)
        except HardwareError as e:
            log.error("auto-connect failed: %s", e.message)
    log.info("JouleLab backend ready (hardware mode: %s, test sources %s)", settings.hardware_mode,
             "ALLOWED" if settings.allow_test_sources else "rejected")
    yield
    retention.cancel()
    await jobs.stop()
    await monitor.stop()
    await hub.stop()
    await hw.disconnect()
    db.close()


app = FastAPI(
    title="JouleLab API",
    description="STM32 + INA219 energy profiling: serial acquisition, live streaming, sessions, AI suggestions",
    version="1.0.0",
    lifespan=lifespan,
)

load_proxy_key(settings)  # created on first start; the frontend proxy reads the same file
app.add_middleware(AccessMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HardwareError)
async def hardware_error(_: Request, exc: HardwareError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(DevError)
async def dev_error(_: Request, exc: DevError):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


app.include_router(hardware.router, prefix="/api/hardware", tags=["Hardware"])
app.include_router(measurements.router, prefix="/api/measurements", tags=["Measurements"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["Sessions"])
app.include_router(optimization.router, prefix="/api/optimizer", tags=["AI suggestions"])
app.include_router(firmware.router, prefix="/api/firmware", tags=["Firmware"])
app.include_router(development.router, prefix="/api/development", tags=["Development (build/upload)"])
app.include_router(debugging.router, prefix="/api/development/debug", tags=["Development (debug)"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["Module separation"])


@app.get("/")
async def health(request: Request):
    st = request.app.state.hardware.status()
    return {"name": "JouleLab API", "status": "running", "hardware_mode": settings.hardware_mode,
            "hardware_state": st["state"], "hardware_connected": st["connected"]}


@app.websocket("/ws/live-data")
async def live_data(websocket: WebSocket):
    """First message: {"type": "snapshot", status, samples}. Then {"type": "live", status, samples, events}
    about WS_BROADCAST_HZ times per second while data flows (at least once per second for status)."""
    hub: LiveHub = websocket.app.state.hub
    await websocket.accept()
    queue = hub.subscribe()
    try:
        await _pump(websocket, queue, hub.snapshot())
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        hub.unsubscribe(queue)


async def _pump(websocket: WebSocket, queue: asyncio.Queue, first: dict) -> None:
    """Send `first`, then every queued message, until the client goes away.

    The handler also waits for the client's disconnect: otherwise a socket with nothing to send
    (an idle serial monitor) never notices the browser left or that the server is shutting down,
    and Ctrl+C on uvicorn waits forever."""
    await websocket.send_json(first)

    async def until_disconnect() -> None:
        while (await websocket.receive())["type"] != "websocket.disconnect":
            pass

    gone = asyncio.create_task(until_disconnect())
    try:
        while True:
            nxt = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait({nxt, gone}, return_when=asyncio.FIRST_COMPLETED)
            if gone in done:
                nxt.cancel()
                return
            await websocket.send_json(nxt.result())
    finally:
        gone.cancel()


@app.websocket("/ws/build-output")
async def build_output(websocket: WebSocket):
    """{"type": "snapshot", job, lines}, then {"type": "line", job, text, source} for each output line
    and {"type": "job", job} whenever a build/upload/debug job starts or finishes."""
    if not is_local(websocket):
        await websocket.close(code=1008, reason=LOCAL_ONLY_MESSAGE[:120])
        return
    jobs = websocket.app.state.jobs
    await websocket.accept()
    queue = jobs.subscribe()
    try:
        await _pump(websocket, queue, jobs.snapshot())
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        jobs.unsubscribe(queue)


@app.websocket("/ws/serial-monitor")
async def serial_monitor(websocket: WebSocket):
    """Text printed by the board, from the shared serial connection (it never opens a port itself).
    {"type": "snapshot", text, status} then {"type": "text", text} chunks."""
    if not is_local(websocket):
        await websocket.close(code=1008, reason=LOCAL_ONLY_MESSAGE[:120])
        return
    monitor = websocket.app.state.monitor
    await websocket.accept()
    queue = monitor.subscribe()
    try:
        await _pump(websocket, queue, {"type": "snapshot", "text": monitor.backlog(),
                                       "status": websocket.app.state.hardware.status()})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        monitor.unsubscribe(queue)
