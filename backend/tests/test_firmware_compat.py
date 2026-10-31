"""The firmware's C encoder must produce exactly the bytes the Python decoder expects."""
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from app.core.config import settings
from app.hardware import stm32_protocol as P

ROOT = Path(__file__).resolve().parents[2]
FW = ROOT / "firmware" / "joulelab_f446re"
sys.path.insert(0, str(ROOT / "backend" / "scripts"))
from send_test_samples import KNOWN_VECTORS  # noqa: E402

CC = shutil.which("cc") or shutil.which("gcc") or shutil.which("clang")


@pytest.mark.skipif(CC is None, reason="no C compiler on this machine")
def test_c_encoder_matches_python(tmp_path):
    exe = tmp_path / "host_vectors"
    subprocess.run([CC, "-Wall", "-Werror", "-I", str(FW / "Core/Inc"), str(FW / "tests/host_vectors.c"),
                    str(FW / "Core/Src/jl_protocol.c"), "-o", str(exe)], check=True)
    lines = subprocess.run([str(exe)], check=True, capture_output=True, text=True).stdout.splitlines()
    for (desc, expected), line in zip(KNOWN_VECTORS, lines):
        assert bytes.fromhex(line) == expected, desc
    assert lines[len(KNOWN_VECTORS)] == "check f4"


def _defines(path):
    return {m[0]: int(m[1], 0) for m in re.findall(r"#define\s+(\w+)\s+(0x[0-9A-Fa-f]+|\d+)u?", path.read_text())}


def test_c_and_python_constants_agree():
    c = _defines(FW / "Core/Inc/jl_protocol.h")
    assert c["JL_PACKET_SIZE"] == P.PACKET_SIZE
    assert c["JL_PROTOCOL_MAGIC"] == P.PROTOCOL_MAGIC
    assert c["JL_FLAG_TEST_SOURCE"] == P.FLAG_TEST_SOURCE
    for name, t in [("JL_PKT_MEASUREMENT", "MEASUREMENT"), ("JL_PKT_FUNC_START", "FUNCTION_START"),
                    ("JL_PKT_FUNC_END", "FUNCTION_END"), ("JL_PKT_GPIO_EDGE", "GPIO_EDGE"),
                    ("JL_PKT_TIME_SYNC", "TIME_SYNC"), ("JL_PKT_HELLO", "HELLO"),
                    ("JL_PKT_DEVICE_STATUS", "DEVICE_STATUS")]:
        assert c[name] == P.PacketType[t]
    for name, s in [("JL_ST_INA219_NOT_FOUND", "INA219_NOT_FOUND"), ("JL_ST_I2C_READ_FAILED", "I2C_READ_FAILED"),
                    ("JL_ST_TX_OVERFLOW", "TX_OVERFLOW"), ("JL_ST_INA219_OVERFLOW", "INA219_MATH_OVERFLOW"),
                    ("JL_ST_SAMPLE_OVERRUN", "SAMPLE_OVERRUN"), ("JL_ST_INA219_RECOVERED", "INA219_RECOVERED")]:
        assert c[name] == P.DeviceStatus[s]


def test_function_ids_match_backend_defaults():
    c = _defines(FW / "Core/Inc/jl_config.h")
    ids = {c["JL_FN_SENSOR_READ"]: "sensor_read", c["JL_FN_COMPUTE"]: "compute",
           c["JL_FN_SEND_DATA"]: "send_data", c["JL_FN_IDLE_SLEEP"]: "idle_sleep"}
    for fid, name in ids.items():
        assert settings.function_names.get(fid) == name
