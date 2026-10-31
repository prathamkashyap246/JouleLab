from typing import Literal

from pydantic import BaseModel, Field


class FirmwareUpload(BaseModel):
    project_name: str = Field(default="untitled", max_length=100)
    board: str = Field(default="ESP32", max_length=80)
    source_code: str = Field(min_length=1, max_length=30000)


class ConnectRequest(BaseModel):
    port: str | None = Field(default=None, max_length=260,
                             description="Serial device, e.g. /dev/cu.usbmodem1103, COM5, /dev/ttyACM0. "
                                         "Omit or 'auto' to pick the single ST-LINK port.")
    baudrate: int | None = Field(default=None, description="Defaults to SERIAL_BAUDRATE (115200).")


class SessionStart(BaseModel):
    name: str = Field(default="", max_length=100)
    notes: str | None = Field(default=None, max_length=1000)


class OptimizeRequest(BaseModel):
    source_code: str = Field(min_length=1, max_length=30000)
    board: str = Field(default="ESP32", max_length=80)
    measurements: list[dict] = Field(default_factory=list, max_length=200)
    constraints: list[str] = Field(default_factory=list, max_length=50)
    session_id: int | None = None


class Suggestion(BaseModel):
    function_name: str
    observed_measurement: str
    potential_issue: str
    recommendation: str
    rationale: str
    tradeoffs: str
    confidence: Literal["low", "medium", "high"]


class SuggestionReport(BaseModel):
    summary: str
    suggestions: list[Suggestion]
    validation_steps: list[str]
    caveats: list[str]
