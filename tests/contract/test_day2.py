"""Phase II grader-style contract tests (spec Part II, section 5). Run against the live stack.

DAY2_SALT is read from the environment or the repo-root .env (dummy value locally).
"""
import concurrent.futures as cf
import hashlib
import hmac
import json
import os
import pathlib

import requests

from conftest import BASE, assert_error


def _day2_salt():
    if "DAY2_SALT" in os.environ:
        return os.environ["DAY2_SALT"]
    env = pathlib.Path(__file__).resolve().parents[2] / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DAY2_SALT="):
                return line.split("=", 1)[1]
    return ""


SALT2 = _day2_salt()


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sign2(entity_id, payload):
    msg = (entity_id + "|" + canonical(payload)).encode("utf-8")
    return hmac.new(SALT2.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def test_appendix_a_vector2_reference():
    msg = ("sk_live_101|" + canonical({"action": "rotate", "player_id": "player-alpha-1"})).encode()
    assert msg == b'sk_live_101|{"action":"rotate","player_id":"player-alpha-1"}'


# ---------- 5.2 health, reset seed ----------

def test_health_and_day2_seed(api):
    assert api.get("/health").json() == {"status": "ok"}
    s = api.get("/audit/v1/score/match-m1").json()
    assert s["status"] == "in_progress" and s["home"]["score"] == 1 and s["away"]["score"] == 0
    q = api.get("/audit/v1/qr/match-m1?inspect=true").json()
    assert q["short_url"] == "http://localhost:8080/q/m1-live" and q["scan_count"] == 0


# ---------- 5.4 stream key ----------

def test_stream_key_lifecycle(api):
    r = api.post("/audit/v1/stream/key", {"action": "generate", "player_id": "player-alpha-1", "label": "OBS-Main-Desk"})
    assert r.status_code == 201, r.text
    j = r.json()
    import re
    assert re.fullmatch(r"sk_live_[a-f0-9]{16}", j["stream_key"])
    assert j["status"] == "active" and j["label"] == "OBS-Main-Desk"
    assert j["ingest_endpoints"] == {"rtmp": f"rtmp://localhost:1935/live/{j['stream_key']}",
                                     "webrtc": f"http://localhost:8889/live/{j['stream_key']}/whip"}
    assert j["playback_url"] == f"http://localhost:8888/live/{j['stream_key']}/index.m3u8"
    assert j["signature"] == sign2(j["stream_key"], {"action": "generate", "player_id": "player-alpha-1",
                                                      "status": "active", "stream_key": j["stream_key"]})
    r = api.post("/audit/v1/stream/key", {"action": "rotate", "player_id": "player-alpha-1", "label": "OBS-Main-Desk",
                                          "stream_key_override": "sk_live_9f83a1b2c3d4e5f6"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["stream_key"] == "sk_live_9f83a1b2c3d4e5f6" and j["status"] == "active"
    assert j["signature"] == sign2("sk_live_9f83a1b2c3d4e5f6", {"action": "rotate", "player_id": "player-alpha-1",
                                                               "status": "active", "stream_key": "sk_live_9f83a1b2c3d4e5f6"})
    r = api.post("/audit/v1/stream/key", {"action": "revoke", "player_id": "player-alpha-1"})
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    assert r.json()["ingest_endpoints"] is None and r.json()["playback_url"] is None
    assert_error(api.post("/audit/v1/stream/key", {"action": "revoke", "player_id": "player-alpha-2"}), 404, "STREAM_NOT_FOUND")
    assert_error(api.post("/audit/v1/stream/key", {"action": "nope", "player_id": "player-alpha-1"}), 400, "VALIDATION_ERROR")
    assert_error(api.post("/audit/v1/stream/key", {"action": "generate", "player_id": "ghost"}), 404, "PLAYER_NOT_FOUND")


# ---------- 5.5 co-stream ----------

COSTREAM = {"session_id": "cs-session-101", "host_player_id": "player-alpha-1",
            "participants": ["player-alpha-1", "player-alpha-2", "player-beta-1", "player-beta-2"],
            "layout": "grid_4", "simulate_host_drop": True}


def test_costream_handoff_and_replay(api):
    r = api.post("/audit/v1/costream/session", COSTREAM)
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["status"] == "active" and j["active_host"] == "player-alpha-2" and j["handoff_occurred"] is True
    assert j["participant_count"] == 3 and j["active_participants"] == ["player-alpha-2", "player-beta-1", "player-beta-2"]
    assert j["composite_playback_url"] == "http://localhost:8888/costream/cs-session-101/index.m3u8"
    assert j["chat_room_id"] == "chat-cs-session-101"
    assert j["signature"] == sign2("cs-session-101", {"active_host": "player-alpha-2", "handoff_occurred": True,
                                                       "layout": "grid_4", "participant_count": 3,
                                                       "session_id": "cs-session-101", "status": "active"})
    again = api.post("/audit/v1/costream/session", COSTREAM)
    assert again.status_code == 200 and again.json() == j


def test_costream_rules(api):
    solo = dict(COSTREAM, session_id="cs-session-solo", participants=["player-alpha-1"], layout="solo")
    j = api.post("/audit/v1/costream/session", solo).json()
    assert j["status"] == "terminated" and j["active_host"] is None and j["participant_count"] == 0 and j["handoff_occurred"] is False
    assert_error(api.post("/audit/v1/costream/session", dict(COSTREAM, session_id="cs-x", participants=COSTREAM["participants"] + ["player-beta-2x"])), 404, "PLAYER_NOT_FOUND")
    assert_error(api.post("/audit/v1/costream/session", dict(COSTREAM, session_id="cs-y", host_player_id="player-beta-2", participants=["player-alpha-1"])), 400, "VALIDATION_ERROR")
    assert_error(api.post("/audit/v1/costream/session", dict(COSTREAM, session_id="cs-z", layout="grid_2", simulate_host_drop=False)), 400, "UNSUPPORTED_LAYOUT")


# ---------- 5.6 QR ----------

def test_qr_resolve_redirect_and_mutation(api):
    j = api.get("/audit/v1/qr/match-m1").json()
    assert j["entity_type"] == "match" and j["entity_status"] == "in_progress"
    assert j["target_route"] == "/web/matches/match-m1/live" and j["deep_link_uri"] == "nascon://entity/match-m1"
    assert j["scan_count"] == 1
    assert j["export_formats"]["png"] == "http://localhost:8080/audit/v1/qr/match-m1/export.png"
    assert j["signature"] == sign2("match-m1", {"entity_id": "match-m1", "short_url": "http://localhost:8080/q/m1-live",
                                                "target_route": "/web/matches/match-m1/live"})
    r = requests.get(BASE + "/q/m1-live", allow_redirects=False)
    assert r.status_code == 302 and r.headers["Location"].endswith("/web/matches/match-m1/live")
    # Edge case 2: end the match -> same short_url, new target and signature.
    assert api.post("/audit/v1/events", {"event_id": "qr-end-1", "match_id": "match-m1", "type": "match_end", "payload": {}}).status_code == 201
    k = api.get("/audit/v1/qr/match-m1?inspect=true").json()
    assert k["short_url"] == j["short_url"] and k["target_route"] == "/web/matches/match-m1/vod"
    assert k["signature"] != j["signature"]
    assert api.get("/audit/v1/qr/player-alpha-1?inspect=true").json()["target_route"] == "/web/players/player-alpha-1"
    assert api.get("/audit/v1/qr/club-alpha-1?inspect=true").json()["target_route"] == "/web/clubs/club-alpha-1"
    assert_error(api.get("/audit/v1/qr/nope-404"), 404, "QR_NOT_FOUND")


def test_qr_exports(api):
    svg = api.get("/audit/v1/qr/match-m1/export.svg")
    assert svg.status_code == 200 and svg.headers["Content-Type"].startswith("image/svg+xml")
    assert svg.text.lstrip().startswith(("<svg", "<?xml"))
    png = api.get("/audit/v1/qr/match-m1/export.png")
    assert png.headers["Content-Type"].startswith("image/png") and png.content[:8] == b"\x89PNG\r\n\x1a\n"
    pdf = api.get("/audit/v1/qr/match-m1/export.pdf")
    assert pdf.headers["Content-Type"].startswith("application/pdf") and pdf.content.startswith(b"%PDF-")


# ---------- 5.7 guest boundary and cart merge ----------

MERGE = {"guest_token": "guest_anon_tok_7721", "registered_user_id": "player-alpha-1",
         "guest_cart": [{"variant_id": "var-jersey-001-L", "quantity": 1}], "test_write_block": True}


def test_guest_writes_forbidden(api):
    h = {"Authorization": "Bearer guest_anon_tok_7721"}
    for path in ["/api/v1/chat", "/audit/v1/checkout", "/audit/v1/events"]:
        assert_error(api.post(path, {}, headers=h), 403, "GUEST_WRITE_FORBIDDEN")


def test_cart_merge_and_idempotency(api):
    r = api.post("/audit/v1/guest/cart-merge", MERGE)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["write_block_verified"] is True and j["write_rejection_code"] == 403 and j["cart_merged"] is True
    assert j["active_cart"] == {"user_id": "player-alpha-1", "currency": "PKR", "total_items": 1, "subtotal_minor": 450000,
                                "items": [{"variant_id": "var-jersey-001-L", "quantity": 1, "unit_price_minor": 450000}]}
    assert j["signature"] == sign2("guest_anon_tok_7721", {"cart_merged": True, "guest_token": "guest_anon_tok_7721",
                                                           "registered_user_id": "player-alpha-1", "total_items": 1,
                                                           "write_rejection_code": 403})
    again = api.post("/audit/v1/guest/cart-merge", MERGE)
    assert again.status_code == 200 and again.json()["active_cart"]["total_items"] == 1
    assert_error(api.post("/audit/v1/guest/cart-merge", dict(MERGE, registered_user_id="player-alpha-2")), 409, "GUEST_TOKEN_ALREADY_MERGED")
    assert api.get("/audit/v1/inventory/var-jersey-001-L").json()["stock"] == 5


def test_cart_merge_errors(api):
    assert_error(api.post("/audit/v1/guest/cart-merge", dict(MERGE, guest_token="nope")), 400, "VALIDATION_ERROR")
    assert_error(api.post("/audit/v1/guest/cart-merge", dict(MERGE, registered_user_id="ghost")), 404, "PLAYER_NOT_FOUND")
    assert_error(api.post("/audit/v1/guest/cart-merge", dict(MERGE, guest_cart=[{"variant_id": "var-x", "quantity": 1}])), 404, "VARIANT_NOT_FOUND")
    big = dict(MERGE, guest_cart=[{"variant_id": "var-jersey-001-M", "quantity": 5}])
    err = assert_error(api.post("/audit/v1/guest/cart-merge", big), 409, "OUT_OF_STOCK")
    assert err["details"]["variant_id"] == "var-jersey-001-M"


# ---------- 5.8 moderation and DLQ ----------

MOD = {"chat_room_id": "chat-cs-session-101", "check_dlq": True, "simulate_failed_notifications": 0,
       "incoming_messages": [
           {"message_id": "msg-1", "sender": "user-guest-1", "text": "Clean sports commentary"},
           {"message_id": "msg-2", "sender": "user-spammer", "text": "Watch this illegal stream b@d_w0rd now!"},
           {"message_id": "msg-3", "sender": "user-flooder", "text": "GOAL! AAAA!!!"}]}


def test_moderation_spec_example(api):
    r = api.post("/audit/v1/moderation/test", MOD)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["filtered_messages"] == [
        {"message_id": "msg-1", "sender": "user-guest-1", "text": "Clean sports commentary", "flagged": False, "reason": None},
        {"message_id": "msg-2", "sender": "user-spammer", "text": "Watch this illegal stream *** now!", "flagged": True, "reason": "profanity_leetspeak"}]
    assert j["kicked_users"] == ["user-spammer"] and j["muted_users"] == ["user-flooder"]
    assert j["dlq_status"]["queue_depth"] == 0 and j["dlq_status"]["undelivered_events"] == []
    assert j["signature"] == sign2("chat-cs-session-101", {"chat_room_id": "chat-cs-session-101", "flagged_count": 1,
                                                           "kicked_users": ["user-spammer"], "queue_depth": 0})


def test_moderation_dlq_and_concurrency(api):
    j = api.post("/audit/v1/moderation/test", dict(MOD, simulate_failed_notifications=2)).json()
    assert j["dlq_status"]["queue_depth"] == 2
    body = {"chat_room_id": "chat-race", "check_dlq": True, "incoming_messages": [
        {"message_id": "m-race", "sender": "user-spammer", "text": "sc@m p.0.r.n"}]}
    with cf.ThreadPoolExecutor(10) as ex:
        res = list(ex.map(lambda _: requests.post(BASE + "/audit/v1/moderation/test", json=body, timeout=15), range(10)))
    assert all(r.status_code == 200 for r in res), [r.status_code for r in res]
    assert all(r.json()["kicked_users"] == ["user-spammer"] for r in res)


def test_moderation_dlq_only_probe(api):
    j = api.post("/audit/v1/moderation/test", {"chat_room_id": "chat-dlq", "incoming_messages": [],
                                               "check_dlq": True, "simulate_failed_notifications": 1}).json()
    assert j["filtered_messages"] == [] and j["dlq_status"]["queue_depth"] >= 1


# ---------- 5.9 metrics and privacy ----------

def test_metrics_and_privacy(api):
    m = api.get("/metrics")
    assert m.status_code == 200 and m.headers["Content-Type"].startswith("text/plain; version=0.0.4")
    for name in ["nascon_active_ws_connections", "nascon_active_streams_total", "nascon_stream_bitrate_kbps",
                 "nascon_dlq_depth", "nascon_qr_scans_total"]:
        assert any(line.startswith(name) for line in m.text.splitlines()), name
    r = api.s.delete(BASE + "/audit/v1/privacy/user/player-alpha-1", timeout=10)
    assert r.status_code == 200 and r.json() == {"user_id": "player-alpha-1", "status": "anonymized",
                                                  "pii_retained": False, "tokens_wiped": True}
