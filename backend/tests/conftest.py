import os
import sys
import tempfile
from pathlib import Path

# Isolated settings for every test run (must happen before `app` is imported).
_tmp = tempfile.mkdtemp(prefix="joulelab-test-")
os.environ["DATABASE_PATH"] = os.path.join(_tmp, "test.db")
os.environ["ALLOW_TEST_SOURCES"] = "false"
os.environ["HARDWARE_MODE"] = "manual"
os.environ["OPENAI_API_KEY"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
