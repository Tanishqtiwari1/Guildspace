import datetime
from conftest import register

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _setup_pair(client):
    admin_h, _ = register(client, "Admin User", "admin@x.com")
    learner_h, learner = register(client, "Lena Learner", "lena@x.com", role="LEARNER", location="Jaipur", preferred_mode="ONLINE")
    mentor_h, mentor = register(client, "Max Mentor", "max@x.com", role="MENTOR", location="Jaipur", preferred_mode="ONLINE")
    py = client.post("/api/skills", json={"name": "Python", "category": "Programming"}, headers=learner_h).json()
    return admin_h, learner_h, learner, mentor_h, mentor, py


def _tomorrow_slot():
    d = datetime.date.today() + datetime.timedelta(days=1)
    return d, DAYS[d.weekday()]


def test_auth_rules(client):
    h, user = register(client, "First", "first@x.com")
    assert user["is_admin"] is True  # first account administers a fresh install
    _, second = register(client, "Second", "second@x.com")
    assert second["is_admin"] is False
    assert client.post("/api/auth/register", json={"name": "Dup", "email": "first@x.com", "password": "password123"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "first@x.com", "password": "wrongpass1"}).status_code == 401
    assert client.get("/api/dashboard").status_code == 401
    assert client.get("/api/auth/me", headers=h).json()["email"] == "first@x.com"


def test_full_workflow(client):
    admin_h, learner_h, learner, mentor_h, mentor, py = _setup_pair(client)
    day, dayname = _tomorrow_slot()

    # Skills and availability (FR5-FR8)
    assert client.post("/api/users/me/skills", json={"skill_id": py["id"], "skill_type": "NEEDED", "level": "INTERMEDIATE"}, headers=learner_h).status_code == 201
    assert client.post("/api/users/me/skills", json={"skill_id": py["id"], "skill_type": "NEEDED"}, headers=learner_h).status_code == 409
    client.post("/api/users/me/skills", json={"skill_id": py["id"], "skill_type": "OFFERED", "level": "ADVANCED"}, headers=mentor_h)
    for h in (learner_h, mentor_h):
        assert client.post("/api/users/me/availability", json={"day_of_week": dayname, "start_time": "09:00", "end_time": "12:00"}, headers=h).status_code == 201
    bad = client.post("/api/users/me/availability", json={"day_of_week": dayname, "start_time": "11:00", "end_time": "13:00"}, headers=learner_h)
    assert bad.status_code == 409

    # Search and matching (FR9-FR12): score is computed from stored data
    assert [u["name"] for u in client.get("/api/search", params={"q": "pyth", "type": "mentor"}, headers=learner_h).json()] == ["Max Mentor"]
    matches = client.get("/api/matches", headers=learner_h).json()
    assert len(matches) == 1 and matches[0]["mentor_id"] == mentor["id"]
    m = matches[0]
    # skill 25 + level 10 + 3h overlap 25 + same mode 15 + same city 10 = 85 (no exchange, no ratings)
    assert m["compatibility_score"] == 85
    assert any("3.0 h/week" in t for t in m["match_explanation"])
    explain = client.get(f"/api/matches/{mentor['id']}/explain", params={"skill_id": py["id"]}, headers=learner_h).json()
    assert explain["narrative_source"] == "rule-based" and "85/100" in explain["narrative"]

    # Changing profile data changes the score
    client.put("/api/users/me", json={"location": "Delhi"}, headers=mentor_h)
    assert client.get("/api/matches", headers=learner_h).json()[0]["compatibility_score"] == 80

    # Requests (FR13-FR15)
    assert client.post("/api/requests", json={"mentor_id": learner["id"], "skill_id": py["id"]}, headers=learner_h).status_code == 400
    r = client.post("/api/requests", json={"mentor_id": mentor["id"], "skill_id": py["id"], "message": "Hi!"}, headers=learner_h)
    assert r.status_code == 201
    req = r.json()
    assert req["compatibility_score"] == 80
    assert client.post("/api/requests", json={"mentor_id": mentor["id"], "skill_id": py["id"]}, headers=learner_h).status_code == 409
    assert client.patch(f"/api/requests/{req['id']}", json={"action": "ACCEPT"}, headers=learner_h).status_code == 403
    dash = client.get("/api/dashboard", headers=mentor_h).json()
    assert dash["stats"]["pending_incoming"] == 1
    assert client.patch(f"/api/requests/{req['id']}", json={"action": "ACCEPT"}, headers=mentor_h).json()["status"] == "ACCEPTED"

    # Messaging (FR19) only after acceptance
    assert client.post("/api/messages", json={"receiver_id": mentor["id"], "text": "Thanks!"}, headers=learner_h).status_code == 201
    assert len(client.get(f"/api/messages/{learner['id']}", headers=mentor_h).json()) == 1

    # Scheduling (FR16-FR18) with availability and conflict checks
    start = datetime.datetime.combine(day, datetime.time(13, 0))
    out = client.post("/api/sessions", json={"request_id": req["id"], "start_at": start.isoformat(), "end_at": (start + datetime.timedelta(hours=1)).isoformat()}, headers=learner_h)
    assert out.status_code == 409 and "availability" in out.json()["detail"]
    start = datetime.datetime.combine(day, datetime.time(9, 30))
    s = client.post("/api/sessions", json={"request_id": req["id"], "start_at": start.isoformat(), "end_at": (start + datetime.timedelta(hours=1)).isoformat()}, headers=learner_h)
    assert s.status_code == 201
    sess = s.json()
    clash = client.post("/api/sessions", json={"request_id": req["id"], "start_at": (start + datetime.timedelta(minutes=30)).isoformat(), "end_at": (start + datetime.timedelta(hours=2)).isoformat()}, headers=mentor_h)
    assert clash.status_code == 409
    new_start = start + datetime.timedelta(hours=1)
    rs = client.patch(f"/api/sessions/{sess['id']}/reschedule", json={"start_at": new_start.isoformat(), "end_at": (new_start + datetime.timedelta(hours=1)).isoformat()}, headers=mentor_h)
    assert rs.json()["status"] == "RESCHEDULED"
    # Tomorrow's session cannot be completed today
    assert client.post(f"/api/sessions/{sess['id']}/complete", headers=mentor_h).status_code == 400
    assert client.post("/api/feedback", json={"session_id": sess["id"], "rating": 5}, headers=learner_h).status_code == 400


def test_feedback_summary_and_admin(client):
    admin_h, learner_h, learner, mentor_h, mentor, py = _setup_pair(client)
    import database, models
    # Build a completed session directly in the DB to test post-session features.
    db = database.SessionLocal()
    req = models.MentorshipRequest(learner_id=learner["id"], mentor_id=mentor["id"], skill_id=py["id"], status="ACCEPTED")
    db.add(req)
    db.flush()
    now = datetime.datetime.now().replace(microsecond=0)
    s = models.MentorshipSession(request_id=req.id, start_at=now - datetime.timedelta(hours=2), end_at=now - datetime.timedelta(hours=1), status="COMPLETED")
    db.add(s)
    db.commit()
    sid = s.id
    db.close()

    # Feedback (FR26) once per participant, and it feeds the mentor's rating
    assert client.post("/api/feedback", json={"session_id": sid, "rating": 4, "comment": "Clear explanations"}, headers=learner_h).status_code == 201
    assert client.post("/api/feedback", json={"session_id": sid, "rating": 5}, headers=learner_h).status_code == 409
    assert client.get(f"/api/users/{mentor['id']}", headers=learner_h).json()["avg_rating"] == 4.0
    dash = client.get("/api/dashboard", headers=mentor_h).json()
    assert dash["stats"]["hours_mentoring"] == 1.0 and dash["stats"]["avg_rating"] == 4.0

    # Summary (FR23) needs notes; fallback is labelled rule-based (FR25)
    assert client.post(f"/api/sessions/{sid}/summary", headers=learner_h).status_code == 400
    client.put(f"/api/sessions/{sid}/notes", json={"notes": "Covered list comprehensions and dictionaries. Discussed pandas basics. Next: practise groupby on a sales dataset."}, headers=learner_h)
    summary = client.post(f"/api/sessions/{sid}/summary", headers=learner_h).json()
    assert summary["summary_source"] == "rule-based"
    assert any("groupby" in step for step in summary["summary"]["next_steps"])

    # Learning plan (FR21-FR22) uses stored profile data and is editable
    plan = client.post("/api/ai/learning-plans", json={"skill_id": py["id"], "goal": "Analyse sales data"}, headers=learner_h).json()
    assert plan["source"] == "rule-based" and plan["content"]["weeks"]
    plan["content"]["weeks"][0]["focus"] = "Edited focus"
    edited = client.put(f"/api/ai/learning-plans/{plan['id']}", json={"content": plan["content"]}, headers=learner_h).json()
    assert edited["content"]["weeks"][0]["focus"] == "Edited focus"

    # Reports and admin (FR27-FR28, FR3)
    rep = client.post("/api/reports", json={"reported_user_id": mentor["id"], "reason": "Missed the session twice"}, headers=learner_h).json()
    assert client.get("/api/admin/reports", headers=learner_h).status_code == 403
    assert client.patch(f"/api/admin/reports/{rep['id']}", json={"status": "RESOLVED"}, headers=admin_h).json()["status"] == "RESOLVED"
    assert client.patch(f"/api/admin/users/{mentor['id']}", json={"is_active": False}, headers=admin_h).json()["is_active"] is False
    assert client.get("/api/dashboard", headers=mentor_h).status_code == 401
    assert client.post("/api/auth/login", json={"email": "max@x.com", "password": "password123"}).status_code == 403
    stats = client.get("/api/admin/stats", headers=admin_h).json()
    assert stats["users"] == 3 and stats["feedback_count"] == 1
