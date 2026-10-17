"""Fixtures, sports, events/score, standings, roster and offline sync (spec 5.6 - 5.11, 5.14)."""
import itertools

from conftest import assert_error, lots_key, sign

KABADDI = {
    "sport_id": "kabaddi", "name": "Kabaddi", "scoring_model": "event",
    "periods": {"count": 2, "duration_minutes": 20},
    "scoring_events": {"raid_point": {"points": 1}, "tackle_point": {"points": 1}, "all_out": {"points": 2}},
    "draw_allowed": False,
    "overtime": {"policy": "golden_score", "duration_minutes": 5},
    "tie_break_order": ["h2h_points", "h2h_diff", "overall_diff", "scored", "fair_play", "draw_lots"],
    "roster": {"min_squad_size": 7, "max_squad_size": 12, "required_positions": {"raider": 2, "defender": 3}},
}


# ---------- Fixtures (5.7) ----------

def test_round_robin_odd_with_withdrawal(api):
    r = api.post("/audit/v1/fixtures", {"format": "round_robin", "teams": ["t1", "t2", "t3", "t4", "t5"],
                                        "params": {"legs": 1, "withdrawals": [{"team_id": "t3", "after_round": 2}],
                                                   "withdrawal_policy": "forfeit_remaining"}})
    assert r.status_code == 200, r.text
    b = r.json()
    assert (b["team_count"], b["round_count"], b["legs"]) == (5, 5, 1)
    pairs, home, away, byes = set(), {}, {}, {}
    for rnd in b["rounds"]:
        assert len(rnd["matches"]) == 2 and len(rnd["byes"]) == 1
        playing = [t for m in rnd["matches"] for t in (m["home"], m["away"])] + rnd["byes"]
        assert sorted(playing) == ["t1", "t2", "t3", "t4", "t5"]
        for i, m in enumerate(rnd["matches"], 1):
            assert m["match_id"] == f"RR-L1-R{rnd['round']}-M{i}"
            pairs.add(frozenset((m["home"], m["away"])))
            home[m["home"]] = home.get(m["home"], 0) + 1
            away[m["away"]] = away.get(m["away"], 0) + 1
            if "t3" in (m["home"], m["away"]) and rnd["round"] > 2:
                assert m["status"] == "forfeit"
                assert m["awarded_to"] == (m["away"] if m["home"] == "t3" else m["home"])
            else:
                assert m["status"] == "scheduled" and m["awarded_to"] is None
        byes[rnd["byes"][0]] = byes.get(rnd["byes"][0], 0) + 1
    assert len(pairs) == 10 and set(byes.values()) == {1}
    for t in ["t1", "t2", "t3", "t4", "t5"]:
        assert abs(home.get(t, 0) - away.get(t, 0)) <= 1
    s = b["summary"]
    assert s["total"] == 10 and s["scheduled"] + s["forfeit"] + s["voided"] == 10


def test_round_robin_double_leg_ordered_pairs(api):
    teams = ["a", "b", "c", "d"]
    b = api.post("/audit/v1/fixtures", {"format": "round_robin", "teams": teams, "params": {"legs": 2}}).json()
    assert b["round_count"] == 6
    ordered = [(m["home"], m["away"]) for rnd in b["rounds"] for m in rnd["matches"]]
    assert sorted(ordered) == sorted(itertools.permutations(teams, 2))


def test_fixture_validation(api):
    assert_error(api.post("/audit/v1/fixtures", {"format": "round_robin", "teams": ["t1"], "params": {}}), 400, "VALIDATION_ERROR")
    assert_error(api.post("/audit/v1/fixtures", {"format": "double_elim", "teams": ["a", "b"], "params": {}}), 400, "VALIDATION_ERROR")
    assert_error(api.post("/audit/v1/fixtures", {"format": "nope", "teams": ["a", "b"], "params": {}}), 400, "VALIDATION_ERROR")
    assert_error(api.post("/audit/v1/fixtures", {"format": "round_robin", "teams": ["a", "b", "c"],
                                                 "params": {"withdrawals": [{"team_id": "zz", "after_round": 1}]}}), 400, "VALIDATION_ERROR")


def test_swiss_round1_exact(api):
    b = api.post("/audit/v1/fixtures", {"format": "swiss", "teams": ["t1", "t2", "t3", "t4", "t5"],
                                        "params": {"total_rounds": 3, "round": 1, "history": []}}).json()
    assert b["bye"] == "t5"
    assert [(p["match_id"], p["home"], p["away"]) for p in b["pairings"]] == [("SW-R1-M1", "t1", "t3"), ("SW-R1-M2", "t2", "t4")]


def test_swiss_round2_spec_example(api):
    b = api.post("/audit/v1/fixtures", {"format": "swiss", "teams": ["t1", "t2", "t3", "t4", "t5"], "params": {
        "total_rounds": 3, "round": 2,
        "history": [{"round": 1, "bye": "t5", "matches": [{"home": "t1", "away": "t3", "result": "home"},
                                                          {"home": "t2", "away": "t4", "result": "draw"}]}]}}).json()
    assert b["bye"] == "t3"
    met = {frozenset(("t1", "t3")), frozenset(("t2", "t4"))}
    teams = set()
    for p in b["pairings"]:
        assert frozenset((p["home"], p["away"])) not in met
        teams |= {p["home"], p["away"]}
    assert teams == {"t1", "t2", "t4", "t5"}
    assert b["standings"][0]["team_id"] == "t1" and b["standings"][0]["score"] == 1.0


def test_single_elim_six_exact(api):
    b = api.post("/audit/v1/fixtures", {"format": "single_elim", "teams": ["t1", "t2", "t3", "t4", "t5", "t6"],
                                        "params": {"third_place_match": False, "results": [{"match_id": "R1M2", "winner": "t4"}]}}).json()
    assert b["bracket_size"] == 8 and len(b["rounds"]) == 3
    r1 = {m["match_id"]: m for m in b["rounds"][0]["matches"]}
    assert (r1["R1M1"]["home"], r1["R1M1"]["away"], r1["R1M1"]["bye"]) == ("t1", None, True)
    assert (r1["R1M2"]["home"], r1["R1M2"]["away"], r1["R1M2"]["winner"]) == ("t4", "t5", "t4")
    assert (r1["R1M4"]["home_seed"], r1["R1M4"]["away_seed"]) == (3, 6)
    assert r1["R1M2"]["winner_to"] == {"match_id": "R2M1", "slot": "away"}
    r2 = {m["match_id"]: m for m in b["rounds"][1]["matches"]}
    assert (r2["R2M1"]["home"], r2["R2M1"]["away"]) == ("t1", "t4")
    assert r2["R2M2"]["home"] == "t2"
    assert b["rounds"][2]["matches"][0]["winner_to"] is None


def test_double_elim_counts(api):
    b = api.post("/audit/v1/fixtures", {"format": "double_elim", "teams": [f"t{i}" for i in range(1, 9)],
                                        "params": {"bracket_reset": True}}).json()
    assert sum(len(r["matches"]) for r in b["winners"]) == 7
    assert sum(len(r["matches"]) for r in b["losers"]) == 6 and len(b["losers"]) == 4
    gf = {m["match_id"]: m for m in b["grand_final"]}
    assert set(gf) == {"GF1", "GF2"} and gf["GF2"]["conditional"] is True and gf["GF2"]["required"] is None


# ---------- Sports, events, score (5.6, 5.9) ----------

def test_mystery_sport_and_scoring_flow(api):
    r = api.post("/audit/v1/sports", KABADDI)
    assert r.status_code == 201 and r.json()["sport_id"] == "kabaddi" and r.json()["status"] == "created"
    assert_error(api.post("/audit/v1/sports", KABADDI), 409, "SPORT_EXISTS")

    def ev(eid, typ, payload, match="mk1"):
        return api.post("/audit/v1/events", {"event_id": eid, "match_id": match, "type": typ, "payload": payload})

    assert ev("e1", "match_init", {"sport_id": "kabaddi", "home_team_id": "A", "away_team_id": "B"}).status_code == 201
    assert_error(ev("e2", "score", {"team_id": "A", "event_type": "raid_point"}), 409, "MATCH_NOT_IN_PROGRESS")
    assert ev("e3", "match_start", {}).status_code == 201
    r = ev("e4", "score", {"team_id": "A", "event_type": "all_out"})
    assert r.status_code == 201
    j = r.json()
    assert j == {"event_id": "e4", "match_id": "mk1", "type": "score", "sequence": 3, "match_version": 3,
                 "signature": sign("e4", {"team_id": "A", "event_type": "all_out"})}
    assert ev("e4", "score", {"team_id": "A", "event_type": "all_out"}).status_code == 200
    assert_error(ev("e4", "score", {"team_id": "B", "event_type": "all_out"}), 409, "DUPLICATE_EVENT_ID")
    assert_error(ev("e5", "score", {"team_id": "A", "event_type": "goal"}), 400, "UNKNOWN_EVENT_TYPE")
    assert_error(ev("e6", "score", {"team_id": "A", "event_type": "raid_point"}, match="nope"), 404, "MATCH_NOT_FOUND")
    assert ev("e7", "compensation", {"compensates": "e4", "reason": "VAR"}).status_code == 201
    assert_error(ev("e8", "compensation", {"compensates": "e4", "reason": "again"}), 409, "INVALID_COMPENSATION")
    assert_error(ev("e9", "match_end", {}), 409, "TIE_NOT_ALLOWED")
    assert ev("e10", "tiebreak_winner", {"team_id": "B"}).status_code == 201
    assert ev("e11", "match_end", {}).status_code == 201
    s = api.get("/audit/v1/score/mk1").json()
    assert s["status"] == "completed" and s["home"]["score"] == 0 and s["away"]["score"] == 0
    assert s["winner_team_id"] == "B" and s["tiebreak_winner_team_id"] == "B" and s["version"] == 6
    e4 = next(e for e in s["events"] if e["event_id"] == "e4")
    assert e4["compensated"] is True and e4["compensated_by"] == "e7"
    for e in s["events"]:
        assert e["signature"] == sign(e["event_id"], e["payload"])


def test_cricket_overs_and_innings_limit(api):
    def ev(eid, typ, payload):
        return api.post("/audit/v1/events", {"event_id": eid, "match_id": "c1", "type": typ, "payload": payload})
    ev("c-0", "match_init", {"sport_id": "cricket", "home_team_id": "H", "away_team_id": "A"})
    ev("c-1", "match_start", {})
    for i in range(10):
        ev(f"c-w{i}", "score", {"team_id": "H", "event_type": "wicket"})
    ev("c-wd", "score", {"team_id": "A", "event_type": "wide"})
    ev("c-4", "score", {"team_id": "A", "event_type": "four"})
    assert_error(ev("c-x", "score", {"team_id": "H", "event_type": "single"}), 409, "INNINGS_COMPLETE")
    s = api.get("/audit/v1/score/c1").json()
    assert s["home"]["wickets"] == 10 and s["home"]["overs"] == "1.4" and s["home"]["balls"] == 10
    assert s["away"]["score"] == 5 and s["away"]["balls"] == 1 and s["away"]["overs"] == "0.1"


# ---------- Standings (5.8, 5.10) ----------

def test_standings_draw_lots_vector(api):
    fixtures = [{"match_id": "s-m1", "home": "t1", "away": "t2"}, {"match_id": "s-m2", "home": "t2", "away": "t3"},
                {"match_id": "s-m3", "home": "t3", "away": "t1"}]
    r = api.post("/audit/v1/leagues", {"league_id": "lg-1", "sport_id": "football", "teams": ["t1", "t2", "t3"],
                                       "fixtures": fixtures, "qualification": {"spots": 1}, "lots_seed": 42})
    assert r.status_code == 201 and r.json() == {"league_id": "lg-1", "status": "created", "team_count": 3, "fixture_count": 3}
    for f in fixtures:
        for i, t in enumerate(["match_start", "match_end"]):
            assert api.post("/audit/v1/events", {"event_id": f"{f['match_id']}-{i}", "match_id": f["match_id"], "type": t, "payload": {}}).status_code == 201
    st = api.get("/audit/v1/standings/lg-1").json()
    order = [row["team_id"] for row in st["table"]]
    assert order == sorted(["t1", "t2", "t3"], key=lambda t: lots_key(42, "lg-1", t)) == ["t1", "t3", "t2"]
    assert st["table"][0]["resolved_by"] == "draw_lots"
    assert st["h2h"]["t1"]["t2"] == {"played": 1, "points": 1, "scored": 0, "conceded": 0}
    assert_error(api.get("/audit/v1/standings/nope"), 404, "LEAGUE_NOT_FOUND")
    assert_error(api.post("/audit/v1/leagues", {"league_id": "lg-1", "sport_id": "football", "teams": ["x", "y"],
                                                "fixtures": [], "qualification": {"spots": 1}}), 409, "LEAGUE_EXISTS")


# ---------- Roster (5.11) ----------

ROSTER_SETUP = {
    "league": {"league_id": "lg-r1", "tenant_id": "tenant-alpha", "sport_id": "football",
               "transfer_window": {"open": "2026-09-01", "close": "2026-09-30"},
               "max_squad_size": 3, "required_positions": {"gk": 1}},
    "squads": [{"squad_id": "sq-a", "club_id": "club-a", "tenant_id": "tenant-alpha", "name": "A"},
               {"squad_id": "sq-b", "club_id": "club-b", "tenant_id": "tenant-alpha", "name": "B"}],
    "players": [{"player_id": "p1", "name": "Ali", "position": "gk", "squad_id": "sq-a", "role": "captain"},
                {"player_id": "p2", "name": "Bilal", "position": "df", "squad_id": "sq-a", "role": "starter"}],
    "matches_in_progress": [],
}


def transfer(**over):
    body = {"request_id": "tr-001", "league_id": "lg-r1", "player_id": "p2", "type": "transfer",
            "from_squad_id": "sq-a", "to_squad_id": "sq-b", "effective_date": "2026-09-30",
            "loan_end_date": None, "reason": "Tactical move", "requested_by": "user-77"}
    body.update(over)
    return body


def test_roster_transfer_and_rules(api):
    r = api.post("/audit/v1/roster/setup", ROSTER_SETUP)
    assert r.status_code == 201 and r.json() == {"league_id": "lg-r1", "status": "configured", "squad_counts": {"sq-a": 2, "sq-b": 0}}
    assert_error(api.post("/audit/v1/roster/transfer", transfer(request_id="tr-x", effective_date="2026-10-01")), 409, "TRANSFER_WINDOW_CLOSED")
    assert_error(api.post("/audit/v1/roster/transfer", transfer(request_id="tr-y", player_id="p1")), 409, "MIN_POSITION_VIOLATION")
    r = api.post("/audit/v1/roster/transfer", transfer())
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["status"] == "accepted" and j["state"] == "active" and j["blocking_match_id"] is None
    assert j["registration"]["squad_id"] == "sq-b" and j["registration"]["role"] == "substitute"
    assert j["audit_entry"]["who"] == "user-77" and j["audit_entry"]["why"] == "Tactical move"
    assert api.post("/audit/v1/roster/transfer", transfer()).json() == j
    assert_error(api.post("/audit/v1/roster/transfer", transfer(request_id="tr-2")), 409, "NOT_IN_SQUAD")
    assert_error(api.post("/audit/v1/roster/transfer", transfer(request_id="tr-3", player_id="ghost")), 404, "PLAYER_NOT_FOUND")


def test_roster_loan_auto_return(api):
    api.post("/audit/v1/roster/setup", ROSTER_SETUP)
    r = api.post("/audit/v1/roster/transfer", transfer(request_id="ln-1", type="loan", effective_date="2026-09-10",
                                                        loan_end_date="2026-12-31"))
    assert r.status_code == 201 and r.json()["registration"]["parent_squad_id"] == "sq-a"
    h1 = api.get("/audit/v1/roster/history/p2?as_of=2027-01-05").json()
    h2 = api.get("/audit/v1/roster/history/p2?as_of=2027-01-05").json()
    assert h1["current_squad_id"] == "sq-a"
    actions = [e["action"] for e in h2["history"]]
    assert actions == ["loan", "loan_return"]
    assert h2["history"][1]["who"] == "system"


def test_roster_deferred_in_progress(api):
    setup = dict(ROSTER_SETUP, matches_in_progress=[{"match_id": "m-live", "home_squad_id": "sq-a", "away_squad_id": "sq-b"}])
    api.post("/audit/v1/roster/setup", setup)
    j = api.post("/audit/v1/roster/transfer", transfer()).json()
    assert j["state"] == "deferred_until_match_end" and j["blocking_match_id"] == "m-live"


# ---------- Offline sync (5.14) ----------

def test_offline_sync_flow(api):
    def ev(eid, typ, payload):
        return api.post("/audit/v1/events", {"event_id": eid, "match_id": "os1", "type": typ, "payload": payload})
    ev("os-0", "match_init", {"sport_id": "football", "home_team_id": "t1", "away_team_id": "t2"})
    ev("os-1", "match_start", {})
    full = dict(ROSTER_SETUP, players=ROSTER_SETUP["players"] + [
        {"player_id": f"pb{i}", "name": f"B{i}", "position": "df", "squad_id": "sq-b", "role": "starter"} for i in range(3)])
    assert api.post("/audit/v1/roster/setup", full).status_code == 201
    body = {"device_id": "dev-1", "actions": [
        {"action_id": "a2", "type": "roster_transfer", "queued_at": "2026-10-17T11:01:00Z", "base_version": 0,
         "payload": transfer(request_id="tr-os")},
        {"action_id": "a1", "type": "score_event", "queued_at": "2026-10-17T11:00:00Z", "base_version": 1,
         "payload": {"event_id": "evt-9", "match_id": "os1", "type": "score", "payload": {"team_id": "t1", "event_type": "goal"}}},
        {"action_id": "a3", "type": "score_event", "queued_at": "2026-10-17T11:02:00Z", "base_version": 99,
         "payload": {"event_id": "evt-10", "match_id": "os1", "type": "score", "payload": {"team_id": "t1", "event_type": "goal"}}},
    ]}
    r = api.post("/audit/v1/offline-sync", body)
    assert r.status_code == 200, r.text
    res = {x["action_id"]: x for x in r.json()["results"]}
    assert [x["action_id"] for x in r.json()["results"]] == ["a2", "a1", "a3"]
    assert res["a1"]["status"] == "applied" and res["a1"]["resolution"] == "rebased_append"
    assert res["a1"]["processed_order"] == 1 and res["a1"]["server_version"] == 3
    assert res["a1"]["signature"] == sign("evt-9", {"team_id": "t1", "event_type": "goal"})
    assert res["a2"]["status"] == "rejected" and res["a2"]["error_code"] == "SQUAD_FULL" and res["a2"]["signature"] is None
    assert res["a3"]["error_code"] == "INVALID_BASE_VERSION"
    assert r.json()["summary"] == {"applied": 1, "rejected": 2, "duplicate": 0}
    again = api.post("/audit/v1/offline-sync", body).json()
    assert [x["status"] for x in again["results"]] == ["duplicate"] * 3
    assert again["summary"] == {"applied": 0, "rejected": 0, "duplicate": 3}
    assert_error(api.post("/audit/v1/offline-sync", {"device_id": "d", "actions": []}), 400, "VALIDATION_ERROR")
