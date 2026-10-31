"""Virtual ESP32 on a pseudo-terminal: prints a line every 0.5 s and echoes what it receives."""
import os
import pty
import time
import tty

m, s = pty.openpty()
tty.setraw(s)
os.set_blocking(m, False)
print(os.ttyname(s), flush=True)
k, last, buf = 0, 0.0, b""
while True:
    try:
        buf += os.read(m, 256)
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            os.write(m, b"ESP32 echo: " + line.strip() + b"\r\n")
    except (BlockingIOError, OSError):
        pass
    if time.time() - last > 0.5:
        try:
            os.write(m, f"work() done #{k}\r\n".encode())
        except BlockingIOError:
            pass
        k, last = k + 1, time.time()
    time.sleep(0.02)
