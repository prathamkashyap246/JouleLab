"""Access rules: proxy key, forged X-Forwarded-For, direct remote clients."""
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def test_direct_local_calls_work_and_ignore_forged_forwarding():
    with TestClient(app) as c:
        assert c.get("/api/hardware/status").status_code == 200
        # a local direct call claiming to be remote is still local (header not trusted without the key)
        r = c.post("/api/hardware/send", json={"text": "x"}, headers={"X-Forwarded-For": "8.8.8.8"})
        assert r.status_code == 409  # passed the local check, failed only because nothing is connected


def test_remote_client_without_key_is_refused_even_with_forged_header():
    with TestClient(app, client=("192.168.1.77", 50000)) as c:
        r = c.get("/api/hardware/status", headers={"X-Forwarded-For": "127.0.0.1"})
        assert r.status_code == 401
        r = c.get("/api/hardware/status", headers={"X-JouleLab-Proxy-Key": "wrong-key"})
        assert r.status_code == 401


def test_proxy_key_trusts_forwarded_address():
    with TestClient(app, client=("192.168.1.77", 50000)) as c:
        ok = {"X-JouleLab-Proxy-Key": settings.proxy_key}
        assert c.get("/api/hardware/status", headers={**ok, "X-Forwarded-For": "127.0.0.1"}).status_code == 200
        r = c.post("/api/development/build", json={"board": "uno"},
                   headers={**ok, "X-Forwarded-For": "127.0.0.1, 192.168.1.77"})  # forged first hop
        assert r.status_code == 403


def test_proxy_key_file_created_private(tmp_path):
    import os
    from app.core.config import Settings, load_proxy_key
    s = Settings()
    s.proxy_key, s.proxy_key_file = "", str(tmp_path / "k" / "proxy.key")
    key = load_proxy_key(s)
    assert len(key) > 30 and (os.stat(s.proxy_key_file).st_mode & 0o777) == 0o600
    s2 = Settings()
    s2.proxy_key, s2.proxy_key_file = "", s.proxy_key_file
    assert load_proxy_key(s2) == key  # same key on the next start
