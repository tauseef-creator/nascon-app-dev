"""Guest Web Player on Selenium Grid 4 (spec Part II 6.2.2 DOM contract, 6.2.3 test cases).

Run:  pytest -n 3 tests/selenium/
Each test runs on Chrome and Firefox; every test opens its own Grid session (fresh guest).
"""
import os
import re
import time
from urllib.parse import urlparse

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

BASE_URL = os.environ.get("BASE_URL", "http://host.docker.internal:8080").rstrip("/")
API_URL = os.environ.get("API_URL", "http://localhost:8080").rstrip("/")

MATCH_ID = "match-m1"
LIVE_PATH = f"/web/matches/{MATCH_ID}/live"
SCORE_RE = re.compile(r"^\d+ - \d+$")


def tid(name):
    return (By.CSS_SELECTOR, f'[data-testid="{name}"]')


def wait_guest_token(driver, timeout=5):
    """The player creates its anonymous viewer token on load (no login wall)."""
    return WebDriverWait(driver, timeout).until(
        lambda d: (d.execute_script("return window.sessionStorage.getItem('nascon.guest_token')") or "")
        .startswith("guest_") or None
    )


# ---------------------------------------------------------------- Test 1
def test_qr_resolution_zero_friction_load(driver, api):
    # HTTP level: the short link answers 302 Found with the live target route.
    r = api.get(f"{API_URL}/q/m1-live", allow_redirects=False, timeout=10)
    assert r.status_code == 302
    assert urlparse(r.headers["Location"]).path == LIVE_PATH

    # Browser level: scanning the QR lands on the live player without any login wall.
    started = time.monotonic()
    driver.get(f"{BASE_URL}/q/m1-live")
    WebDriverWait(driver, 3).until(lambda d: urlparse(d.current_url).path == LIVE_PATH)
    video = WebDriverWait(driver, 3).until(EC.visibility_of_element_located(tid("guest-video-player")))
    banner = WebDriverWait(driver, 3).until(EC.visibility_of_element_located(tid("live-score-banner")))
    elapsed = time.monotonic() - started
    assert elapsed < 3.0, f"player took {elapsed:.2f}s to render"
    assert video.is_displayed() and banner.is_displayed()

    modal = driver.find_element(*tid("progressive-auth-modal"))
    assert not modal.is_displayed(), "no login modal may be shown on initial load"

    # The rest of the DOM contract is present on the live page.
    for name in ("pinned-merch-card", "add-to-guest-cart-btn", "guest-cart-count",
                 "chat-message-list", "chat-input-field", "chat-send-btn"):
        assert driver.find_elements(*tid(name)), f"missing data-testid={name}"
    assert driver.find_element(*tid("guest-cart-count")).text == "0"
    card = driver.find_element(*tid("pinned-merch-card"))
    assert card.get_attribute("data-product-id") == "prod-jersey-001"
    assert card.get_attribute("data-variant-id") == "var-jersey-001-L"


# ---------------------------------------------------------------- Test 2
def test_guest_write_block_opens_progressive_modal(driver, unique):
    driver.get(f"{BASE_URL}{LIVE_PATH}")
    field = WebDriverWait(driver, 5).until(EC.visibility_of_element_located(tid("chat-input-field")))
    wait_guest_token(driver)
    chat = driver.find_element(*tid("chat-message-list"))
    before = len(chat.find_elements(By.CSS_SELECTOR, "li"))
    modal = driver.find_element(*tid("progressive-auth-modal"))
    assert not modal.is_displayed()

    text = f"selenium guest message {unique}"
    field.send_keys(text)
    driver.find_element(*tid("chat-send-btn")).click()

    WebDriverWait(driver, 5).until(EC.visibility_of_element_located(tid("progressive-auth-modal")))
    time.sleep(1.5)  # give the chat stream / poll time to (wrongly) deliver the message
    chat = driver.find_element(*tid("chat-message-list"))
    assert text not in chat.text, "a blocked guest message must not be appended"
    assert len(chat.find_elements(By.CSS_SELECTOR, "li")) == before
    assert driver.find_element(*tid("progressive-auth-modal")).is_displayed()


# ---------------------------------------------------------------- Test 3
OBSERVER_JS = """
const b = document.querySelector('[data-testid="live-score-banner"]');
window.__scoreLog = [];
new MutationObserver(() => window.__scoreLog.push({
  t: performance.now(),
  v: Number(b.getAttribute('data-match-version')),
  text: b.textContent,
})).observe(b, { attributes: true, childList: true, characterData: true, subtree: true });
return performance.now();
"""


def test_guest_cart_staging_and_realtime_score(driver, api, unique, record_property):
    driver.get(f"{BASE_URL}{LIVE_PATH}")
    count = WebDriverWait(driver, 5).until(EC.visibility_of_element_located(tid("guest-cart-count")))
    assert count.text == "0"
    wait_guest_token(driver)

    # Guest cart staging.
    driver.find_element(*tid("add-to-guest-cart-btn")).click()
    WebDriverWait(driver, 5).until(EC.text_to_be_present_in_element(tid("guest-cart-count"), "1"))
    assert driver.find_element(*tid("guest-cart-count")).text == "1"

    # Real-time score: wait until a live channel (SSE or WebSocket) has delivered a score.
    banner = driver.find_element(*tid("live-score-banner"))
    WebDriverWait(driver, 5).until(
        lambda d: banner.get_attribute("data-stream") and SCORE_RE.match(banner.text.strip()))
    before = banner.text.strip()

    score = api.get(f"{API_URL}/audit/v1/score/{MATCH_ID}", timeout=10).json()
    t_browser = driver.execute_script(OBSERVER_JS)
    started = time.monotonic()
    r = api.post(f"{API_URL}/audit/v1/events", json={
        "event_id": f"sel-goal-{unique}",
        "match_id": MATCH_ID,
        "type": "score",
        "payload": {"team_id": score["home"]["team_id"], "event_type": "goal"},
    }, timeout=10)
    assert r.status_code == 201, r.text
    version = r.json()["match_version"]

    WebDriverWait(driver, 2, poll_frequency=0.02).until(
        lambda d: int(banner.get_attribute("data-match-version") or -1) >= version)
    wall_ms = (time.monotonic() - started) * 1000

    log = driver.execute_script("return window.__scoreLog")
    hit = next(e for e in log if e["v"] >= version)
    latency_ms = hit["t"] - t_browser  # browser clock: POST sent -> DOM updated (upper bound)
    record_property("score_latency_ms", round(latency_ms, 1))
    record_property("score_wall_ms", round(wall_ms, 1))

    after = banner.text.strip()
    assert SCORE_RE.match(after), after
    assert after != before, "score banner did not change"
    assert latency_ms < 500, f"banner updated after {latency_ms:.0f} ms (limit 500 ms)"
    assert urlparse(driver.current_url).path == LIVE_PATH, "no page reload/navigation expected"


# ---------------------------------------------------------------- NFR-8 accessibility (DOM inspection)
A11Y_JS = """
const px = (el) => { const r = el.getBoundingClientRect(); return [r.width, r.height]; };
const rgb = (c) => (c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
const bg = (el) => {
  for (let n = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    const a = (c.match(/[\\d.]+/g) || [])[3];
    if (c && c !== 'transparent' && a !== '0') return rgb(c);
  }
  return [255, 255, 255];
};
const targets = [...document.querySelectorAll('.controls button, [data-testid="add-to-guest-cart-btn"], '
  + '[data-testid="chat-send-btn"], [data-testid="chat-input-field"], #cart-btn, #signin-btn')]
  .map((el) => ({ id: el.id || el.dataset.testid, size: px(el), label: el.getAttribute('aria-label')
    || (el.labels && el.labels.length ? el.labels[0].textContent.trim() : '') || el.textContent.trim() }));
const media = [document.querySelector('[data-testid="guest-video-player"]'), ...document.querySelectorAll('.controls button')]
  .map((el) => ({ id: el.id, aria: el.getAttribute('aria-label') }));
const text = ['live-score-banner', 'chat-send-btn', 'add-to-guest-cart-btn']
  .map((t) => document.querySelector(`[data-testid="${t}"]`))
  .concat([document.querySelector('.match-title'), document.querySelector('.hint')])
  .map((el) => ({ id: el.id || el.className, fg: rgb(getComputedStyle(el).color), bg: bg(el) }));
return { targets, media, text };
"""


def _lum(rgb):
    def ch(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a, b):
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def test_accessibility_contract(driver):
    from selenium.webdriver.common.keys import Keys

    driver.get(f"{BASE_URL}{LIVE_PATH}")
    WebDriverWait(driver, 5).until(EC.visibility_of_element_located(tid("guest-video-player")))
    wait_guest_token(driver)
    info = driver.execute_script(A11Y_JS)
    for t in info["targets"]:
        w, h = t["size"]
        assert w >= 48 and h >= 48, f"touch target {t['id']} is {w:.0f}x{h:.0f}px"
        assert t["label"], f"{t['id']} has no accessible name"
    for m in info["media"]:
        assert m["aria"], f"media control {m['id']} has no aria-label"
    for t in info["text"]:
        ratio = _contrast(t["fg"], t["bg"])
        assert ratio >= 4.5, f"{t['id']} contrast {ratio:.2f}:1"

    # Keyboard: Tab reaches the chat field and Enter activates buttons.
    body = driver.find_element(By.TAG_NAME, "body")
    for _ in range(40):
        if driver.switch_to.active_element.get_attribute("data-testid") == "add-to-guest-cart-btn":
            break
        body = driver.switch_to.active_element
        body.send_keys(Keys.TAB)
    focused = driver.switch_to.active_element
    assert focused.get_attribute("data-testid") == "add-to-guest-cart-btn", "Tab never reached the cart button"
    focused.send_keys(Keys.ENTER)
    WebDriverWait(driver, 5).until(EC.text_to_be_present_in_element(tid("guest-cart-count"), "1"))
