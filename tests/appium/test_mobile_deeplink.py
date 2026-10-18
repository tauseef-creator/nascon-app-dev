"""Native deep links and cross-surface chat (spec Part II 6.3, FR-4.1).

Run:  pytest tests/appium -v      (report: tests/reports/appium-report.xml)

React Native testIDs are exposed as Android resource-ids, so screens are located with
//*[@resource-id='<testID>'].
"""
import time
import uuid

import pytest

from mobile_support import API_URL, APP_PACKAGE, BASE_URL, DEEPLINK_TIMEOUT, GRID_URL, open_deep_link

MATCH_LINK = "nascon://entity/match-m1"
STREAM_LINK = "nascon://stream/cs-session-101"
SESSION_ID = "cs-session-101"
CHAT_ROOM = f"chat-{SESSION_ID}"


def rid(test_id):
    return f"//*[@resource-id='{test_id}']"


def visible(drv, test_id):
    try:
        return any(e.is_displayed() for e in drv.find_elements("xpath", rid(test_id)))
    except Exception:
        return False


def wait_visible(drv, test_id, timeout):
    deadline = time.monotonic() + timeout
    while True:
        if visible(drv, test_id):
            return time.monotonic()
        if time.monotonic() >= deadline:
            return None
        time.sleep(0.15)


def assert_opened(drv, link, screen_id):
    took = open_deep_link(drv, link)
    t0 = time.monotonic()
    assert drv.current_package == APP_PACKAGE, f"{APP_PACKAGE} is not in the foreground after {link}"
    shown = wait_visible(drv, screen_id, DEEPLINK_TIMEOUT)
    assert shown is not None, f"{screen_id} not visible within {DEEPLINK_TIMEOUT}s of {link} (intent took {took:.2f}s)"
    assert not visible(drv, "login-screen"), f"{link} stopped on the login screen"
    return shown - t0


def test_entity_deep_link_opens_match_live_screen(driver):
    assert_opened(driver, MATCH_LINK, "match-screen")


def test_stream_deep_link_opens_costream_screen(driver):
    assert_opened(driver, STREAM_LINK, "costream-screen")
    assert visible(driver, "chat-message-list"), "co-stream chat is not shown"


def _member_token(api):
    r = api.post(f"{API_URL}/api/v1/auth/login", json={"email": "player@nascon.test", "password": "Nascon@26"}, timeout=10)
    assert r.status_code == 200, f"member login failed: {r.status_code} {r.text[:200]}"
    return r.json()["token"]


def _text_in_app(drv, needle):
    xp = f"//*[contains(@text, '{needle}') or contains(@content-desc, '{needle}')]"
    try:
        return bool(drv.find_elements("xpath", xp))
    except Exception:
        return False


def _text_in_browser(browser, needle):
    try:
        els = browser.find_elements("css selector", '[data-testid="chat-message-list"]')
        return any(needle in (e.text or "") for e in els)
    except Exception:
        return False


def test_cross_surface_costream_chat_sync(driver, api, grid_available):
    if not grid_available:
        pytest.skip(f"Selenium Grid not ready at {GRID_URL}/status")
    from selenium import webdriver
    from selenium.webdriver.support.ui import WebDriverWait

    # Mobile joins the co-stream through the deep link.
    assert_opened(driver, STREAM_LINK, "costream-screen")

    opts = webdriver.ChromeOptions()
    opts.add_argument("--headless=new")
    opts.add_argument("--window-size=414,896")
    opts.add_argument("--disable-dev-shm-usage")
    browser = webdriver.Remote(command_executor=GRID_URL, options=opts)
    try:
        browser.set_page_load_timeout(30)
        browser.get(f"{BASE_URL}/web/costream/{SESSION_ID}")
        WebDriverWait(browser, 10).until(lambda b: b.find_elements("css selector", '[data-testid="chat-message-list"]'))

        token = _member_token(api)
        needle = f"appium-{uuid.uuid4().hex[:8]}"
        r = api.post(
            f"{API_URL}/api/v1/chat",
            json={"room": CHAT_ROOM, "text": f"Cross surface {needle}"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        assert r.status_code in (200, 201), f"chat post failed: {r.status_code} {r.text[:200]}"
        posted = time.monotonic()

        in_app = in_web = False
        while time.monotonic() - posted < 3.0 and not (in_app and in_web):
            in_app = in_app or _text_in_app(driver, needle)
            in_web = in_web or _text_in_browser(browser, needle)
            if not (in_app and in_web):
                time.sleep(0.2)
        assert in_app, "chat message did not reach the mobile app within 3 s"
        assert in_web, "chat message did not reach the guest web player within 3 s"
    finally:
        browser.quit()
