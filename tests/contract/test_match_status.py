"""Match status state machine via /api/v1 (FR-1.3). Graded /audit/v1 outputs must stay unchanged."""
from conftest import assert_error


def login(api, email):
    r = api.post("/api/v1/auth/login", {"email": email, "password": "Nascon@26"})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_postpone_reschedule_cancel_and_frozen_scoring(api):
    org = login(api, "organizer@nascon.test")
    viewer = login(api, "viewer@nascon.test")
    upcoming = [m["match_id"] for m in api.get("/api/v1/matches?league_id=league-alpha-1", headers=org).json()["matches"]
                if m["status"] == "upcoming"]
    first, second = upcoming[0], upcoming[1]
    url = f"/api/v1/matches/{first}/status"
    assert api.get(url, headers=org).json()["status"] == "upcoming"
    assert_error(api.post(url, {"status": "postponed"}, headers=viewer), 403, "FORBIDDEN")
    assert_error(api.post(url, {"status": "abandoned"}, headers=org), 409, "ILLEGAL_TRANSITION")

    r = api.post(url, {"status": "postponed", "reason": "Waterlogged pitch"}, headers=org)
    assert r.status_code == 200 and r.json()["status"] == "postponed"
    assert set(r.json()["allowed_transitions"]) == {"upcoming", "cancelled"}
    assert_error(api.post("/audit/v1/events", {"event_id": "ms-1", "match_id": first, "type": "match_start", "payload": {}}),
                 409, "ILLEGAL_TRANSITION")
    # Graded score projection is unchanged by the override.
    assert api.get("/audit/v1/score/" + first).json()["status"] == "upcoming"

    assert_error(api.post(url, {"status": "upcoming"}, headers=org), 400, "VALIDATION_ERROR")
    r = api.post(url, {"status": "upcoming", "scheduled_at": "2026-11-01T16:00:00Z"}, headers=org)
    assert r.json()["status"] == "upcoming" and r.json()["scheduled_at"] == "2026-11-01T16:00:00Z"
    assert api.post("/audit/v1/events", {"event_id": "ms-2", "match_id": first, "type": "match_start", "payload": {}}).status_code == 201

    r = api.post(url, {"status": "abandoned", "reason": "Floodlight failure"}, headers=org)
    assert r.json()["status"] == "abandoned" and [h["to"] for h in r.json()["history"]] == ["postponed", "upcoming", "abandoned"]
    listed = {m["match_id"]: m["status"] for m in api.get("/api/v1/matches?league_id=league-alpha-1", headers=org).json()["matches"]}
    assert listed[first] == "abandoned"

    c = api.post(f"/api/v1/matches/{second}/status", {"status": "cancelled"}, headers=org)
    assert c.json()["status"] == "cancelled" and c.json()["allowed_transitions"] == []
    api.reset()
    assert api.get(url, headers=login(api, "organizer@nascon.test")).json()["status"] == "upcoming"
