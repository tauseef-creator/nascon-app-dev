"""Appium 2 fixtures for the native deep-link suite (spec Part II 6.3).

Environment:
    APPIUM_URL           Appium server (default http://localhost:4723)
    ANDROID_UDID         device serial (default 19301FDEE003AS)
    APP_PACKAGE          default com.nxtmafia.nascon
    APP_ACTIVITY         default .MainActivity
    SELENIUM_REMOTE_URL  Grid hub for the cross-surface test (default http://localhost:4444)
    BASE_URL             backend as seen from the Grid browsers (default http://host.docker.internal:8080)
    API_URL              backend as seen from this test process (default http://localhost:8080)
    DEEPLINK_TIMEOUT     seconds allowed for the deep-linked screen to appear (default 2.0)

Tests skip (not fail) when the Appium server, the device or the Grid is unavailable.
JUnit XML goes to tests/reports/appium-report.xml unless --junitxml names another path.
"""
import pathlib

import pytest
import requests

from mobile_support import APP_ACTIVITY, APP_PACKAGE, APPIUM_URL, GRID_URL, REPORT, UDID, adb


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config):
    if not getattr(config.option, "xmlpath", None):
        config.option.xmlpath = str(REPORT)
    pathlib.Path(config.option.xmlpath).parent.mkdir(parents=True, exist_ok=True)


def _appium_ready():
    try:
        r = requests.get(f"{APPIUM_URL}/status", timeout=3)
        body = r.json()
        ready = body.get("value", {}).get("ready", body.get("ready", r.ok))
        return r.status_code == 200 and bool(ready)
    except Exception:
        return False


def _device_online():
    res = adb("get-state", timeout=10)
    if res is None:
        # No local adb: let Appium decide whether the device is reachable.
        return True
    return res.returncode == 0 and res.stdout.strip() == "device"


@pytest.fixture(scope="session")
def driver():
    if not _appium_ready():
        pytest.skip(f"Appium server not ready at {APPIUM_URL}/status")
    if not _device_online():
        pytest.skip(f"Android device {UDID} is not connected")
    try:
        from appium import webdriver as appium_webdriver
        from appium.options.android import UiAutomator2Options
    except ImportError:
        pytest.skip("Appium-Python-Client is not installed")

    # Tethered phones reach the Docker backend through adb reverse (harmless on emulators).
    adb("reverse", "tcp:8080", "tcp:8080")

    opts = UiAutomator2Options()
    opts.platform_name = "Android"
    opts.automation_name = "UiAutomator2"
    opts.udid = UDID
    opts.app_package = APP_PACKAGE
    opts.app_activity = APP_ACTIVITY
    opts.no_reset = True
    opts.new_command_timeout = 120
    opts.set_capability("appium:autoGrantPermissions", True)
    opts.set_capability("appium:disableWindowAnimation", True)
    try:
        drv = appium_webdriver.Remote(APPIUM_URL, options=opts)
    except Exception as exc:  # device locked, driver missing, app not installed
        pytest.skip(f"could not start an Appium session: {exc}")
    drv.implicitly_wait(0)
    yield drv
    drv.quit()


@pytest.fixture
def api():
    s = requests.Session()
    yield s
    s.close()


@pytest.fixture(scope="session")
def grid_available():
    try:
        r = requests.get(f"{GRID_URL}/status", timeout=3)
        return r.status_code == 200 and r.json().get("value", {}).get("ready", False)
    except Exception:
        return False
