"""All settings come from environment variables (or backend/.env). See .env.example."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")

ALLOWED_BAUDRATES = (9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600)


def _csv(name: str, default: str) -> list[str]:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def _id_map(name: str, default: str) -> dict[int, str]:
    """Parse "1:sensor_read,2:compute" into {1: "sensor_read", 2: "compute"}."""
    out: dict[int, str] = {}
    for item in _csv(name, default):
        key, _, label = item.partition(":")
        if key.strip().isdigit() and label.strip():
            out[int(key)] = label.strip()
    return out


@dataclass
class Settings:
    app_env: str = os.getenv("APP_ENV", "development")
    # manual: connect from the UI/API.  serial: also auto-connect at startup.  off: hardware disabled.
    hardware_mode: str = os.getenv("HARDWARE_MODE", "manual").strip().lower()
    serial_port: str = os.getenv("SERIAL_PORT", "auto").strip() or "auto"
    serial_baudrate: int = int(os.getenv("SERIAL_BAUDRATE", "115200"))
    auto_reconnect: bool = _bool("SERIAL_AUTO_RECONNECT", True)
    stall_timeout_s: float = float(os.getenv("SERIAL_STALL_TIMEOUT_S", "2.0"))
    # Development only: accept packets whose HELLO says they come from a test generator.
    allow_test_sources: bool = _bool("ALLOW_TEST_SOURCES", False)

    function_names: dict[int, str] = field(default_factory=lambda: _id_map(
        "FUNCTION_NAMES", "1:sensor_read,2:compute,3:send_data,4:idle_sleep"))
    gpio_names: dict[int, str] = field(default_factory=lambda: _id_map("GPIO_MARKER_NAMES", "0:gpio_marker_0,1:gpio_marker_1"))
    # "Above idle" energy per function uses this function's average power as the floor.
    baseline_function: str = os.getenv("BASELINE_FUNCTION", "idle_sleep").strip()

    live_buffer_seconds: float = float(os.getenv("LIVE_BUFFER_SECONDS", "120"))
    ws_broadcast_hz: float = float(os.getenv("WS_BROADCAST_HZ", "20"))
    ws_max_samples_per_message: int = int(os.getenv("WS_MAX_SAMPLES_PER_MESSAGE", "400"))

    database_path: str = os.getenv("DATABASE_PATH", str(BACKEND_DIR / "data" / "joulelab.db"))
    # Stored samples are averages of N consecutive samples (1 = store every sample).
    db_store_decimation: int = max(1, int(os.getenv("DB_STORE_DECIMATION", "10")))
    db_max_samples_per_session: int = int(os.getenv("DB_MAX_SAMPLES_PER_SESSION", "2000000"))
    retention_days: float = float(os.getenv("RETENTION_DAYS", "30"))

    # Development tools (Workspace: Verify / Upload / Debug)
    pio_path: str = os.getenv("PIO_PATH", "")  # empty = find pio next to this Python, then on PATH
    projects_dir: str = os.getenv("PROJECTS_DIR", str(BACKEND_DIR / "data" / "projects"))
    firmware_dir: str = os.getenv("FIRMWARE_DIR", str(BACKEND_DIR.parent / "firmware"))
    dev_job_timeout_s: float = float(os.getenv("DEV_JOB_TIMEOUT_S", "3600"))  # first build downloads toolchains
    dev_max_source_chars: int = int(os.getenv("DEV_MAX_SOURCE_CHARS", "200000"))
    # Build/upload/debug run programs on this computer. By default only requests from this
    # computer are accepted (also when they come through the frontend proxy).
    dev_allow_remote: bool = _bool("DEV_ALLOW_REMOTE", False)
    # Shared secret between the frontend proxy and this backend. Empty = read/create
    # PROXY_KEY_FILE. Requests without it are accepted only from this computer.
    proxy_key: str = os.getenv("JOULELAB_PROXY_KEY", "")
    proxy_key_file: str = os.getenv("PROXY_KEY_FILE", str(BACKEND_DIR / "data" / "proxy.key"))

    cors_origins: list[str] = field(default_factory=lambda: _csv(
        "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173"))
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "")
    max_source_chars: int = int(os.getenv("MAX_SOURCE_CHARS", "30000"))

    def __post_init__(self) -> None:
        if self.hardware_mode == "demo":  # value used by the previous starter backend
            self.hardware_mode = "manual"
        if self.hardware_mode not in ("manual", "serial", "off"):
            raise ValueError("HARDWARE_MODE must be manual, serial or off")
        if self.serial_baudrate not in ALLOWED_BAUDRATES:
            raise ValueError(f"SERIAL_BAUDRATE must be one of {ALLOWED_BAUDRATES}")


def load_proxy_key(s: "Settings") -> str:
    """Return the proxy key, creating a random one (readable only by this user) if needed."""
    if s.proxy_key:
        return s.proxy_key
    import secrets
    path = Path(s.proxy_key_file)
    try:
        key = path.read_text().strip()
        if key:
            s.proxy_key = key
            return key
    except FileNotFoundError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    key = secrets.token_urlsafe(32)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(key + "\n")
    s.proxy_key = key
    return key


settings = Settings()
