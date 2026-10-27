import datetime
from conftest import register

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _pair(client):
    admin_h, _ = register(client, "Admin", "admin@x.com")
    l_h, learner = register(client, "Lena Learner", "lena@x.com", location="Jaipur", preferred_mode="ONLINE")
    m_h, mentor = register(client, "Max Mentor", "max@x.com", location="Jaipur", preferred_mode="ONLINE")
    py = client.post("/api/skills", json={"name": "Python"}, headers=l_h).json()
    client.post("/api/users/me/skills", json={"skill_id": py["id"], "skill_type": "NEEDED"}, headers=l_h)
    client.post("/api/users/me/skills", json={"skill_id": py["id"], "skill_type": "OFFERED", "level": "ADVANCED"}, headers=m_h)
    req = client.post("/api/requests", json={"mentor_id": mentor["id"], "skill_id": py["id"]}, headers=l_h).json()
    client.patch(f"/api/requests/{req['id']}", json={"action": "ACCEPT"}, headers=m_h)
    return admin_h, l_h, learner, m_h, mentor, py, req


def _past_session(req_id, hours=1, hold=True):
    """A session that already took place (the API only books future slots)."""
    import database, models, trust_services
    db = database.SessionLocal()
    now = datetime.datetime.now().replace(microsecond=0)
    s = models.MentorshipSession(request_id=req_id, start_at=now - datetime.timedelta(hours=hours + 1), end_at=now - datetime.timedelta(hours=1))
    db.add(s)
    db.flush()
    if hold:
        trust_services.hold(db, s)
    db.commit()
    sid = s.id
    db.close()
    return sid


def _credits(client, h):
    return client.get("/api/credits", headers=h).json()


def test_starter_credits_and_escrow(client):
    admin_h, l_h, learner, m_h, mentor, py, req = _pair(client)
    assert _credits(client, l_h)["balance"] == 2.0
    d = datetime.date.today() + datetime.timedelta(days=2)
    day = DAYS[d.weekday()]
    for h in (l_h, m_h):
        client.post("/api/users/me/availability", json={"day_of_week": day, "start_time": "08:00", "end_time": "13:00"}, headers=h)
    start = datetime.datetime.combine(d, datetime.time(9, 0))
    # 3 hours costs more than the 2 starter credits
    too_long = client.post("/api/sessions", json={"request_id": req["id"], "start_at": start.isoformat(), "end_at": (start + datetime.timedelta(hours=3)).isoformat()}, headers=m_h)
    assert too_long.status_code == 402 and "credit" in too_long.json()["detail"]
    s = client.post("/api/sessions", json={"request_id": req["id"], "start_at": start.isoformat(), "end_at": (start + datetime.timedelta(hours=1, minutes=30)).isoformat()}, headers=l_h).json()
    assert s["credits_held"] == 1.5
    c = _credits(client, l_h)
    assert c["balance"] == 0.5 and c["held"] == 1.5
    # Rescheduling to 1h refunds the difference; cancelling refunds the rest
    client.patch(f"/api/sessions/{s['id']}/reschedule", json={"start_at": start.isoformat(), "end_at": (start + datetime.timedelta(hours=1)).isoformat()}, headers=m_h)
    assert _credits(client, l_h)["balance"] == 1.0
    out = client.post(f"/api/sessions/{s['id']}/cancel", headers=l_h).json()
    assert out["status"] == "CANCELLED" and out["credits_held"] == 0
    assert _credits(client, l_h)["balance"] == 2.0


def test_dual_confirmation_moves_credits(client):
    admin_h, l_h, learner, m_h, mentor, py, req = _pair(client)
    sid = _past_session(req["id"], hours=1)
    first = client.post(f"/api/sessions/{sid}/complete", headers=l_h).json()
    assert first["status"] == "SCHEDULED" and first["learner_confirmed"] and not first["mentor_confirmed"]
    assert _credits(client, m_h)["balance"] == 2.0  # mentor not paid yet
    assert client.post(f"/api/sessions/{sid}/complete", headers=l_h).status_code == 400
    assert client.post("/api/feedback", json={"session_id": sid, "rating": 5}, headers=l_h).status_code == 400
    done = client.post(f"/api/sessions/{sid}/complete", headers=m_h).json()
    assert done["status"] == "COMPLETED"
    assert _credits(client, m_h)["balance"] == 3.0 and _credits(client, m_h)["earned_total"] == 1.0
    assert _credits(client, l_h)["balance"] == 1.0
    # Endorsement: mentor only, once
    assert client.post(f"/api/sessions/{sid}/endorse", json={"level": "INTERMEDIATE"}, headers=l_h).status_code == 403
    assert client.post(f"/api/sessions/{sid}/endorse", json={"level": "INTERMEDIATE", "note": "Solid on loops"}, headers=m_h).status_code == 201
    assert client.post(f"/api/sessions/{sid}/endorse", json={"level": "ADVANCED"}, headers=m_h).status_code == 409
    record = client.get(f"/api/users/{learner['id']}/record", headers=m_h).json()
    assert record["hours_learned"] == 1.0 and record["endorsements"][0]["level"] == "INTERMEDIATE"
    assert "mark" not in str(record).lower()


def test_no_show_and_reliability_penalty(client):
    admin_h, l_h, learner, m_h, mentor, py, req = _pair(client)
    baseline = client.get("/api/matches", headers=l_h).json()[0]["compatibility_score"]
    # Mentor keeps one session, then misses two
    ok = _past_session(req["id"])
    client.post(f"/api/sessions/{ok}/complete", headers=l_h)
    client.post(f"/api/sessions/{ok}/complete", headers=m_h)
    before = _credits(client, l_h)["balance"]
    for _ in range(2):
        sid = _past_session(req["id"])
        out = client.post(f"/api/sessions/{sid}/no-show", headers=l_h).json()
        assert out["status"] == "NO_SHOW" and out["no_show_user_id"] == mentor["id"]
    assert _credits(client, l_h)["balance"] == before  # both holds refunded
    # Can't claim a no-show if the other person confirmed attendance
    sid = _past_session(req["id"])
    client.post(f"/api/sessions/{sid}/complete", headers=m_h)
    assert client.post(f"/api/sessions/{sid}/no-show", headers=l_h).status_code == 409
    m = client.get("/api/matches", headers=l_h).json()[0]
    rel = next(f for f in m["factors"] if f["factor"] == "reliability")
    assert rel["points"] == -10 and m["reliability"] == 33
    assert m["compatibility_score"] == baseline - 10  # same profile data, only the reliability penalty changed


def test_academic_rescue_privacy(client):
    admin_h, _ = register(client, "Admin", "admin@x.com")
    fac_h, fac = register(client, "Prof Meera", "meera@x.com", account_type="FACULTY", department="CS")
    client.post(f"/api/admin/faculty/{fac['id']}/verify", json={"verified": True}, headers=admin_h)
    a_h, a = register(client, "Struggling Sam", "sam@x.com")
    h_h, h = register(client, "Helpful Hana", "hana@x.com")
    o_h, o = register(client, "Outsider Omar", "omar@x.com")
    course = client.post("/api/faculty/courses", json={"name": "Data Structures", "code": "CS201", "semester": 3, "section": "A", "academic_year": "2026-27"}, headers=fac_h).json()
    for st in ("sam@x.com", "hana@x.com"):
        client.post(f"/api/faculty/courses/{course['id']}/students", json={"email": st}, headers=fac_h)
    asm = client.post(f"/api/faculty/courses/{course['id']}/assessments", json={"name": "MTE-1", "max_marks": 25}, headers=fac_h).json()

    # Only students who took the course can offer help
    assert client.post("/api/academics/help-offers", json={"course_code": "CS201"}, headers=o_h).status_code == 403
    offer = client.post("/api/academics/help-offers", json={"course_code": "cs201", "note": "Happy to explain linked lists", "share_grade_badge": True}, headers=h_h)
    assert offer.status_code == 201

    client.put(f"/api/faculty/assessments/{asm['id']}/marks", json={"entries": [
        {"student_id": a["id"], "marks_obtained": 8}, {"student_id": h["id"], "marks_obtained": 22}]}, headers=fac_h)
    client.post(f"/api/faculty/assessments/{asm['id']}/publish", json={}, headers=fac_h)

    # Sam gets a private nudge that never states the score
    nudge = [n for n in client.get("/api/notifications", headers=a_h).json() if "Need a hand" in n["text"]]
    assert len(nudge) == 1 and "8" not in nudge[0]["text"] and nudge[0]["link"] == "/academics?tab=rescue"
    assert not any("Need a hand" in n["text"] for n in client.get("/api/notifications", headers=h_h).json())

    r = client.get("/api/academics/rescue", headers=a_h).json()
    assert len(r["courses"]) == 1
    item = r["courses"][0]
    assert item["low_assessments"] == [{"assessment": "MTE-1", "percentage": 32.0}]
    helper = item["helpers"][0]
    assert helper["user"]["name"] == "Helpful Hana" and helper["grade_verified"] is True
    assert "22" not in str(helper) and "88" not in str(helper)  # the helper's own mark never leaks
    assert client.get("/api/academics/rescue", headers=h_h).json()["courses"] == []
    # A student below the threshold can't volunteer to help with that same course
    assert client.get("/api/academics/help-offers/eligible", headers=a_h).json() == []
    assert client.post("/api/academics/help-offers", json={"course_code": "CS201"}, headers=a_h).status_code == 403

    # Requesting help reuses the normal mentorship flow
    assert client.post("/api/requests", json={"mentor_id": h["id"], "skill_id": helper["skill_id"], "message": "Help with MTE-2?"}, headers=a_h).status_code == 201
    assert client.get("/api/academics/rescue", headers=a_h).json()["courses"][0]["helpers"][0]["request_status"] == "PENDING"

    # Faculty see anonymous counts only
    ins = client.get("/api/faculty/dashboard", headers=fac_h).json()["rescue_insights"]
    assert ins == [{"course_id": course["id"], "code": "CS201", "name": "Data Structures", "below_threshold": 1, "help_requests": 1, "helpers_available": 1}]

    # Withdrawing the offer removes the helper from rescue results
    oid = offer.json()["id"]
    client.delete(f"/api/academics/help-offers/{oid}", headers=h_h)
    assert client.get("/api/academics/rescue", headers=a_h).json()["courses"][0]["helpers"] == []
