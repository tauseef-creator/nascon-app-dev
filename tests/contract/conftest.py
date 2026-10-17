"""Grader-style contract tests. They run against the live stack (docker compose up).

Usage:
    pip install pytest requests pypdf
    BASE_URL=http://localhost:8080 DAY1_SALT=<salt> pytest tests/contract -q

If DAY1_SALT is not exported, it is read from the repo-root .env file.
"""
import hashlib
import hmac
import json
import os
import pathlib

import pytest
import requests

BASE = os.environ.get("BASE_URL", "http://localhost:8080")


def _salt():
    if "DAY1_SALT" in os.environ:
        return os.environ["DAY1_SALT"]
    env = pathlib.Path(__file__).resolve().parents[2] / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DAY1_SALT="):
                return line.split("=", 1)[1]
    return ""


SALT = _salt()


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sign(id_, payload):
    msg = (id_ + "|" + canonical(payload)).encode("utf-8")
    return hmac.new(SALT.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def lots_key(seed, league_id, team_id):
    return hashlib.sha256(f"{seed}|{league_id}|{team_id}".encode("utf-8")).hexdigest()


class Api:
    def __init__(self):
        self.s = requests.Session()

    def get(self, path, **kw):
        return self.s.get(BASE + path, timeout=15, **kw)

    def post(self, path, body=None, **kw):
        return self.s.post(BASE + path, json=body, timeout=15, **kw)

    def patch(self, path, body=None, **kw):
        return self.s.patch(BASE + path, json=body, timeout=15, **kw)

    def reset(self, **body):
        r = self.post("/audit/v1/reset", body)
        assert r.status_code == 200, r.text
        return r.json()


def assert_error(resp, status, code):
    assert resp.status_code == status, f"expected {status} {code}, got {resp.status_code}: {resp.text[:300]}"
    body = resp.json()
    assert set(body.keys()) == {"error"}, body
    err = body["error"]
    assert err["code"] == code, err
    assert isinstance(err["message"], str)
    assert isinstance(err["details"], dict)
    return err


@pytest.fixture
def api():
    a = Api()
    a.reset()
    return a
