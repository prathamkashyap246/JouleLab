#!/usr/bin/env python3
"""Stand-in for the `pio` command in browser tests: prints PlatformIO-like output and exits 0.
`debug` echoes the GDB commands it receives. It never compiles anything."""
import os
import sys
import time

a = sys.argv[1:]
if a[:1] == ["--version"]:
    print("PlatformIO Core, version 0.0 (FAKE pio for tests)")
    sys.exit(0)
if a and a[0] == "debug":
    print("FAKE gdb ready", flush=True)
    for line in sys.stdin:
        print("FAKE gdb got: " + line.strip(), flush=True)
        if line.strip() == "quit":
            break
    sys.exit(0)
print("Processing " + a[a.index("-e") + 1], flush=True)
if "--upload-port" in a:
    print("Uploading to " + a[a.index("--upload-port") + 1], flush=True)
time.sleep(float(os.environ.get("FAKE_PIO_SLEEP", "0.8")))
print("========== [SUCCESS] (FAKE) ==========", flush=True)
