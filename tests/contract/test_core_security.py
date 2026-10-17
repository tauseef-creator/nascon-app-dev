"""Health, reset, global conventions and security probes (spec 5.2, 5.4, 5.5, 5.13)."""
import base64
import io
import threading
import time

import requests
from pypdf import PdfReader

from conftest import BASE, Api, assert_error, sign


def test_health_and_reset_shape(api):
    assert api.get("/health").json() == {"status": "ok"}
    body = api.reset(seed=42, stock={"var-jersey-001-M": 1, "var-jersey-001-L": 5})
    assert body == {
        "status": "reset_complete", "seed": 42,
        "sports": ["football", "basketball", "cricket", "esports"],
        "tenants": ["tenant-alpha", "tenant-beta"],
        "stock": {"var-jersey-001-M": 1, "var-jersey-001-L": 5},
    }
    assert api.post("/audit/v1/reset").json()["stock"] == {"var-jersey-001-M": 1, "var-jersey-001-L": 5}


def test_reset_is_repeatable(api):
    a = api.get("/audit/v1/inventory/var-jersey-001-L").json()
    api.reset()
    b = api.get("/audit/v1/inventory/var-jersey-001-L").json()
    assert a == b == {"variant_id": "var-jersey-001-L", "stock": 5, "reserved": 0}


def test_malformed_json_is_validation_error(api):
    r = requests.post(BASE + "/audit/v1/sports", data="{bad", headers={"Content-Type": "application/json"})
    err = assert_error(r, 400, "VALIDATION_ERROR")
    assert isinstance(err["details"]["fields"], list)


def test_body_over_1mb_is_413(api):
    r = requests.post(BASE + "/audit/v1/sports", data='{"x":"' + "a" * (1024 * 1024 + 10) + '"}',
                      headers={"Content-Type": "application/json"})
    assert_error(r, 413, "PAYLOAD_TOO_LARGE")


def test_sql_injection_sport_id_is_400(api):
    r = api.post("/audit/v1/sports", {"sport_id": "x'; DROP TABLE sports;--", "name": "X"})
    err = assert_error(r, 400, "VALIDATION_ERROR")
    assert "sport_id" in err["details"]["fields"]
    assert api.get("/health").status_code == 200


def test_script_customer_id_is_plain_data(api):
    api.reset(stock={"var-jersey-001-L": 5})
    r = api.post("/audit/v1/checkout", {
        "order_id": "ord-xss", "customer_id": "\"'<script>alert(1)</script>",
        "items": [{"variant_id": "var-jersey-001-L", "quantity": 1}],
        "discount_code": None, "payment": {"token": "tok_success"}})
    assert r.status_code < 500, r.text
    if r.status_code == 201:
        assert r.json()["receipt"]["payload"]["customer_id"] == "\"'<script>alert(1)</script>"


def test_rate_limit_ping():
    s = requests.Session()
    codes, retry = [], []
    start = time.time()
    for _ in range(150):
        r = s.get(BASE + "/api/v1/ping", timeout=5)
        codes.append(r.status_code)
        if r.status_code == 429:
            retry.append(r.headers.get("Retry-After"))
            assert r.json()["error"]["code"] == "RATE_LIMITED"
    assert time.time() - start < 5
    assert codes[0] == 200
    assert codes.count(429) >= 40
    assert all(retry)
    time.sleep(11)
    r = s.get(BASE + "/api/v1/ping")
    assert r.status_code == 200 and r.json() == {"pong": True}


def test_audit_routes_not_rate_limited(api):
    codes = [api.get("/health").status_code for _ in range(250)]
    assert set(codes) == {200}


# ---------- Store (5.12) ----------

def checkout_body(order_id, variant="var-jersey-001-M", qty=1, token="tok_success", code=None):
    return {"order_id": order_id, "customer_id": "cust-001",
            "items": [{"variant_id": variant, "quantity": qty}],
            "discount_code": code, "payment": {"token": token}}


def test_concurrent_checkout_last_unit(api):
    api.reset(stock={"var-jersey-001-M": 1})
    barrier = threading.Barrier(20)
    results = []

    def buy(i):
        s = requests.Session()
        barrier.wait()
        r = s.post(BASE + "/audit/v1/checkout", json=checkout_body(f"ord-burst-{i}"), timeout=15)
        results.append(r)

    threads = [threading.Thread(target=buy, args=(i,)) for i in range(20)]
    t0 = time.time()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert time.time() - t0 < 10
    codes = sorted(r.status_code for r in results)
    assert codes.count(201) == 1 and codes.count(409) == 19, codes
    for r in results:
        if r.status_code == 409:
            assert r.json()["error"]["code"] == "OUT_OF_STOCK"
            assert r.json()["error"]["details"]["variant_id"] == "var-jersey-001-M"
    assert api.get("/audit/v1/inventory/var-jersey-001-M").json() == {"variant_id": "var-jersey-001-M", "stock": 0, "reserved": 0}


def test_checkout_receipt_signature_pdf_and_idempotency(api):
    api.reset(stock={"var-jersey-001-L": 5})
    body = checkout_body("ord-001", "var-jersey-001-L", 2, code="WELCOME10")
    r = api.post("/audit/v1/checkout", body)
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["status"] == "paid" and o["currency"] == "PKR"
    assert o["subtotal_minor"] == 900000 and o["discount_minor"] == 90000 and o["total_minor"] == 810000
    assert o["payment"]["state"] == "captured"
    p = o["receipt"]["payload"]
    assert o["receipt"]["signature"] == sign("ord-001", p)
    pdf = base64.b64decode(o["receipt"]["pdf_base64"])
    assert pdf.startswith(b"%PDF")
    text = "".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)
    assert "ord-001" in text and "PKR 8100.00" in text
    again = api.post("/audit/v1/checkout", body)
    assert again.status_code == 200 and again.json() == o
    assert api.get("/audit/v1/inventory/var-jersey-001-L").json()["stock"] == 3
    body2 = dict(body, customer_id="someone-else")
    assert_error(api.post("/audit/v1/checkout", body2), 409, "DUPLICATE_ORDER_ID")


def test_checkout_errors(api):
    api.reset(stock={"var-jersey-001-L": 5})
    assert_error(api.post("/audit/v1/checkout", checkout_body("o1", "var-nope")), 404, "VARIANT_NOT_FOUND")
    assert_error(api.post("/audit/v1/checkout", checkout_body("o2", "var-jersey-001-L", code="BOGUS")), 400, "INVALID_DISCOUNT_CODE")
    assert_error(api.post("/audit/v1/checkout", checkout_body("o3", "var-jersey-001-L", token="tok_declined")), 402, "PAYMENT_DECLINED")
    assert_error(api.post("/audit/v1/checkout", checkout_body("o4", "var-jersey-001-L", token="tok_capture_fail")), 402, "PAYMENT_CAPTURE_FAILED")
    assert api.get("/audit/v1/inventory/var-jersey-001-L").json() == {"variant_id": "var-jersey-001-L", "stock": 5, "reserved": 0}
    assert_error(api.post("/audit/v1/checkout", checkout_body("o5", "var-jersey-001-L", qty=11)), 400, "VALIDATION_ERROR")
    assert_error(api.post("/audit/v1/checkout", checkout_body("o6", "var-jersey-001-L", qty=6)), 409, "OUT_OF_STOCK")
    assert_error(api.get("/audit/v1/inventory/var-nope"), 404, "VARIANT_NOT_FOUND")


# ---------- RBAC (5.13) ----------

MATRIX = [
    # (probe, method, path_template, target_key, [super, organizer, manager, player, viewer])
    ("P1", "POST", "/audit/v1/rbac/tenants", None, "ADDDD"),
    ("P2 own", "POST", "/audit/v1/rbac/leagues/{}/fixtures", "own_league_id", "AADDD"),
    ("P2 other", "POST", "/audit/v1/rbac/leagues/{}/fixtures", "other_league_id", "ADDDD"),
    ("P2 foreign", "POST", "/audit/v1/rbac/leagues/{}/fixtures", "foreign_league_id", "ADDDD"),
    ("P3 own", "POST", "/audit/v1/rbac/clubs/{}/roster", "own_club_id", "ADADD"),
    ("P3 other", "POST", "/audit/v1/rbac/clubs/{}/roster", "other_club_id", "ADDDD"),
    ("P3 foreign", "POST", "/audit/v1/rbac/clubs/{}/roster", "foreign_club_id", "ADDDD"),
    ("P4 own", "POST", "/audit/v1/rbac/clubs/{}/products", "own_club_id", "ADADD"),
    ("P4 other", "POST", "/audit/v1/rbac/clubs/{}/products", "other_club_id", "ADDDD"),
    ("P4 foreign", "POST", "/audit/v1/rbac/clubs/{}/products", "foreign_club_id", "ADDDD"),
    ("P5 own", "PATCH", "/audit/v1/rbac/players/{}", "own_player_id", "ADAAD"),
    ("P5 other", "PATCH", "/audit/v1/rbac/players/{}", "other_player_id", "ADDDD"),
    ("P5 foreign", "PATCH", "/audit/v1/rbac/players/{}", "foreign_player_id", "ADDDD"),
    ("P6 own", "GET", "/audit/v1/rbac/clubs/{}", "own_club_id", "AAAAA"),
    ("P6 other", "GET", "/audit/v1/rbac/clubs/{}", "other_club_id", "AAAAA"),
    ("P6 foreign", "GET", "/audit/v1/rbac/clubs/{}", "foreign_club_id", "ADDDD"),
    ("P7", "GET", "/audit/v1/rbac/platform/config", None, "ADDDD"),
]
ROLES = ["super_admin", "league_organizer", "club_manager", "player", "viewer"]


def test_rbac_matrix(api):
    m = api.post("/audit/v1/rbac-matrix").json()
    assert set(m["tokens"]) == set(ROLES)
    ctx = m["context"]
    for name, method, tpl, key, expected in MATRIX:
        path = tpl.format(ctx[key]) if key else tpl
        for role, exp in zip(ROLES, expected):
            h = {"Authorization": "Bearer " + m["tokens"][role]}
            r = api.s.request(method, BASE + path, json={}, headers=h, timeout=10)
            if exp == "A":
                assert r.status_code == 200 and r.json() == {"authorized": True}, (name, role, r.text)
            else:
                assert_error(r, 403, "FORBIDDEN")


def test_rbac_bad_tokens(api):
    m = api.post("/audit/v1/rbac-matrix").json()
    assert_error(api.get("/audit/v1/rbac/platform/config"), 401, "UNAUTHENTICATED")
    tok = m["tokens"]["super_admin"]
    head, payload, sig = tok.split(".")
    tampered = f"{head}.{payload}.{sig[:-2]}{'AA' if sig[-2:] != 'AA' else 'BB'}"
    assert_error(api.get("/audit/v1/rbac/platform/config", headers={"Authorization": "Bearer " + tampered}), 401, "UNAUTHENTICATED")
    none_head = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').rstrip(b"=").decode()
    assert_error(api.get("/audit/v1/rbac/platform/config", headers={"Authorization": f"Bearer {none_head}.{payload}."}), 401, "UNAUTHENTICATED")
