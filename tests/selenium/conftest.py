"""Selenium Grid 4 fixtures for the Guest Web Player suite (spec Part II 6.2.3).

Environment:
    SELENIUM_REMOTE_URL  Grid hub (default http://localhost:4444)
    BASE_URL             backend as seen from the browser nodes (default http://host.docker.internal:8080)
    API_URL              backend as seen from this test process (default http://localhost:8080)
    BROWSERS             comma list of browsers to run (default "chrome,firefox")

The baseline is reset exactly once per test run, also under pytest-xdist (a file lock shared by
all workers). JUnit XML goes to tests/reports/selenium-report.xml unless --junitxml names a path.
"""
import fcntl
import os
import pathlib
import tempfile
import uuid

import pytest
import requests
from selenium import webdriver

GRID_URL = os.environ.get("SELENIUM_REMOTE_URL", "http://localhost:4444")
BASE_URL = os.environ.get("BASE_URL", "http://host.docker.internal:8080").rstrip("/")
API_URL = os.environ.get("API_URL", "http://localhost:8080").rstrip("/")
BROWSERS = [b.strip() for b in os.environ.get("BROWSERS", "chrome,firefox").split(",") if b.strip()]

REPORT = pathlib.Path(__file__).resolve().parents[1] / "reports" / "selenium-report.xml"


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config):
    if hasattr(config, "workerinput"):
        return  # xdist workers: the controller writes the merged report
    if not getattr(config.option, "xmlpath", None):
        config.option.xmlpath = str(REPORT)
    pathlib.Path(config.option.xmlpath).parent.mkdir(parents=True, exist_ok=True)


def _run_id():
    # Shared by every xdist worker of one run; unique per plain pytest run.
    return os.environ.get("PYTEST_XDIST_TESTRUNUID") or f"solo-{os.getpid()}"


@pytest.fixture(scope="session", autouse=True)
def baseline_reset():
    """POST /audit/v1/reset once per run (first worker to take the lock does it)."""
    tmp = pathlib.Path(tempfile.gettempdir())
    run_id = _run_id()
    lock_path = tmp / f"nascon-selenium-{run_id}.lock"
    done_path = tmp / f"nascon-selenium-{run_id}.done"
    with open(lock_path, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            if not done_path.exists():
                r = requests.post(f"{API_URL}/audit/v1/reset", json={}, timeout=60)
                assert r.status_code == 200, f"reset failed: {r.status_code} {r.text[:200]}"
                done_path.write_text("ok")
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
    yield


def _options(browser):
    if browser == "chrome":
        opts = webdriver.ChromeOptions()
        opts.add_argument("--headless=new")
        opts.add_argument("--window-size=414,896")
        opts.add_argument("--disable-dev-shm-usage")
        opts.add_argument("--autoplay-policy=no-user-gesture-required")
        return opts
    if browser == "firefox":
        opts = webdriver.FirefoxOptions()
        opts.add_argument("-headless")
        opts.add_argument("--width=414")
        opts.add_argument("--height=896")
        return opts
    raise ValueError(f"unsupported browser {browser!r}")


@pytest.fixture(params=BROWSERS)
def driver(request):
    """A fresh Grid session per test, so every test starts as a brand-new guest."""
    drv = webdriver.Remote(command_executor=GRID_URL, options=_options(request.param))
    drv.set_page_load_timeout(30)
    drv.set_script_timeout(10)
    yield drv
    drv.quit()


@pytest.fixture
def api():
    s = requests.Session()
    yield s
    s.close()


@pytest.fixture
def unique():
    return uuid.uuid4().hex[:10]
