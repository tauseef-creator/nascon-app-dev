"""Shared settings and helpers for the Appium suite (imported by conftest and the tests)."""

import os
import pathlib
import shutil
import subprocess
import time


APPIUM_URL = os.environ.get("APPIUM_URL", "http://localhost:4723").rstrip("/")
UDID = os.environ.get("ANDROID_UDID", "19301FDEE003AS")
APP_PACKAGE = os.environ.get("APP_PACKAGE", "com.nxtmafia.nascon")
APP_ACTIVITY = os.environ.get("APP_ACTIVITY", ".MainActivity")
GRID_URL = os.environ.get("SELENIUM_REMOTE_URL", "http://localhost:4444").rstrip("/")
BASE_URL = os.environ.get("BASE_URL", "http://host.docker.internal:8080").rstrip("/")
API_URL = os.environ.get("API_URL", "http://localhost:8080").rstrip("/")
DEEPLINK_TIMEOUT = float(os.environ.get("DEEPLINK_TIMEOUT", "2.0"))

REPORT = pathlib.Path(__file__).resolve().parents[1] / "reports" / "appium-report.xml"


def adb(*args, timeout=20):
    """Runs adb against the test device; returns CompletedProcess (never raises on exit code)."""
    exe = shutil.which("adb")
    if not exe:
        return None
    return subprocess.run([exe, "-s", UDID, *args], capture_output=True, text=True, timeout=timeout)


def open_deep_link(drv, url):
    """Fires the spec's intent (adb shell am start -W -a VIEW -d <url>), scoped to our package.

    Falls back to Appium's `mobile: deepLink` when adb is not on PATH. Returns seconds taken.
    """
    start = time.monotonic()
    res = adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d", url, APP_PACKAGE, timeout=30)
    if res is None or res.returncode != 0 or "Error" in (res.stdout + res.stderr):
        drv.execute_script("mobile: deepLink", {"url": url, "package": APP_PACKAGE, "waitForLaunch": True})
    return time.monotonic() - start
