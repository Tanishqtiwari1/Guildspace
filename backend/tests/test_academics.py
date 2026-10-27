import datetime
from conftest import register


def _setup(client):
    admin_h, _ = register(client, "Admin", "admin@x.com")
    fac_h, fac = register(client, "Prof Meera", "meera@x.com", account_type="FACULTY", department="Computer Science", designation="Professor")
    other_fac_h, other_fac = register(client, "Prof Other", "other@x.com", account_type="FACULTY", department="Physics")
    a_h, a = register(client, "Student A", "a@x.com")
    b_h, b = register(client, "Student B", "b@x.com")
    c_h, c = register(client, "Student C", "c@x.com")  # never enrolled
    return admin_h, fac_h, fac, other_fac_h, other_fac, a_h, a, b_h, b, c_h, c


def _course(client, fac_h, **over):
    body = {"name": "Data Structures", "code": "cs201", "semester": 3, "section": "a", "academic_year": "2026-27", **over}
    r = client.post("/api/faculty/courses", json=body, headers=fac_h)
    assert r.status_code == 201, r.text
    return r.json()


def _future(days=3, hour=16):
    d = datetime.date.today() + datetime.timedelta(days=days)
    return datetime.datetime.combine(d, datetime.time(hour, 0))


def test_faculty_verification_and_roles(client):
    admin_h, fac_h, fac, other_fac_h, other_fac, a_h, a, *_ = _setup(client)
    # Unverified faculty cannot create courses
    r = client.post("/api/faculty/courses", json={"name": "DS", "code": "CS201", "semester": 3, "section": "A", "academic_year": "2026-27"}, headers=fac_h)
    assert r.status_code == 403 and "verification" in r.json()["detail"]
    assert client.post(f"/api/admin/faculty/{fac['id']}/verify", json={"verified": True}, headers=fac_h).status_code == 403
    assert client.post(f"/api/admin/faculty/{fac['id']}/verify", json={"verified": True}, headers=admin_h).status_code == 200
    course = _course(client, fac_h)
    assert course["code"] == "CS201" and course["section"] == "A" and len(course["join_code"]) == 7
    # Students cannot use faculty endpoints; faculty cannot use student endpoints
    assert client.get("/api/faculty/courses", headers=a_h).status_code == 403
    assert client.get("/api/academics/marks", headers=fac_h).status_code == 403
    # Bad academic year is rejected
    assert client.post("/api/faculty/courses", json={"name": "X", "code": "X1", "semester": 1, "section": "A", "academic_year": "2026-28"}, headers=fac_h).status_code == 422


def test_full_academic_flow_and_privacy(client):
    admin_h, fac_h, fac, other_fac_h, other_fac, a_h, a, b_h, b, c_h, c = _setup(client)
    for f in (fac, other_fac):
        client.post(f"/api/admin/faculty/{f['id']}/verify", json={"verified": True}, headers=admin_h)
    course = _course(client, fac_h)
    cid = course["id"]

    # Enrolment: A joins with the code, B is added by email into section B
    assert client.post("/api/academics/courses/join", json={"join_code": course["join_code"]}, headers=a_h).status_code == 201
    assert client.post("/api/academics/courses/join", json={"join_code": course["join_code"]}, headers=a_h).status_code == 409
    assert client.post(f"/api/faculty/courses/{cid}/students", json={"email": "b@x.com", "section": "b"}, headers=fac_h).status_code == 201
    assert client.post(f"/api/faculty/courses/{cid}/students", json={"email": "meera@x.com"}, headers=fac_h).status_code == 400
    detail = client.get(f"/api/faculty/courses/{cid}", headers=fac_h).json()
    assert [s["student"]["name"] for s in detail["students"]] == ["Student A", "Student B"]
    assert detail["sections"] == ["A", "B"]
    # Another faculty member cannot see or touch this course
    assert client.get(f"/api/faculty/courses/{cid}", headers=other_fac_h).status_code == 404
    # Students never see the join code in their view of the course
    assert "join_code" not in client.get("/api/academics/courses", headers=a_h).json()[0]

    # Extra class: published → enrolled students notified; unenrolled student cannot see it
    start = _future()
    xc = client.post("/api/faculty/extra-classes", json={
        "course_id": cid, "topic": "Linked Lists", "start_at": start.isoformat(),
        "end_at": (start + datetime.timedelta(hours=1)).isoformat(), "location": "AB2-304"}, headers=fac_h)
    assert xc.status_code == 201, xc.text
    xid = xc.json()["id"]
    for h in (a_h, b_h):
        notes = client.get("/api/notifications", headers=h).json()
        assert any(n["kind"] == "EXTRA_CLASS" and "Linked Lists" in n["text"] for n in notes)
    assert not any(n["kind"] == "EXTRA_CLASS" for n in client.get("/api/notifications", headers=c_h).json())
    assert client.post(f"/api/academics/extra-classes/{xid}/schedule", headers=c_h).status_code == 404
    assert client.get(f"/api/academics/extra-classes/{xid}/ics", headers=c_h).status_code == 404
    added = client.post(f"/api/academics/extra-classes/{xid}/schedule", headers=a_h).json()
    assert added["in_my_schedule"] is True
    ics = client.get(f"/api/academics/extra-classes/{xid}/ics", headers=a_h)
    assert ics.status_code == 200 and "BEGIN:VEVENT" in ics.text and "AB2-304" in ics.text
    assert client.get("/api/academics/overview", headers=a_h).json()["upcoming_classes"][0]["topic"] == "Linked Lists"
    month = start.strftime("%Y-%m")
    assert any(e["type"] == "EXTRA_CLASS" for e in client.get(f"/api/academics/calendar?month={month}", headers=a_h).json())
    # Room clash with another faculty's class in the same room
    other_course = _course(client, other_fac_h, name="Optics", code="PH101")
    clash = client.post("/api/faculty/extra-classes", json={
        "course_id": other_course["id"], "topic": "Lenses", "start_at": (start + datetime.timedelta(minutes=30)).isoformat(),
        "end_at": (start + datetime.timedelta(hours=2)).isoformat(), "location": "ab2-304 "}, headers=other_fac_h)
    assert clash.status_code == 409
    # Other faculty cannot create a class in a course they do not teach
    assert client.post("/api/faculty/extra-classes", json={
        "course_id": cid, "topic": "Hijack", "start_at": _future(5).isoformat(), "end_at": (_future(5) + datetime.timedelta(hours=1)).isoformat(),
        "location": "X"}, headers=other_fac_h).status_code == 404
    # Cancel → notification
    assert client.post(f"/api/faculty/extra-classes/{xid}/cancel", json={"reason": "Faculty meeting"}, headers=fac_h).json()["status"] == "CANCELLED"
    assert any("Cancelled" in n["text"] for n in client.get("/api/notifications", headers=a_h).json())

    # Announcements: section-targeted and individual
    client.post("/api/faculty/announcements", json={"course_id": cid, "target_type": "SECTION", "target_section": "b", "title": "Lab for section B", "body": "Bring laptops"}, headers=fac_h)
    client.post("/api/faculty/announcements", json={"course_id": cid, "target_type": "STUDENT", "target_student_id": a["id"], "title": "Please see me", "body": "About your project", "is_important": True}, headers=fac_h)
    assert client.post("/api/faculty/announcements", json={"course_id": cid, "target_type": "STUDENT", "target_student_id": c["id"], "title": "Nope", "body": "Not enrolled"}, headers=fac_h).status_code == 400
    assert [x["title"] for x in client.get("/api/academics/announcements", headers=a_h).json()] == ["Please see me"]
    assert [x["title"] for x in client.get("/api/academics/announcements", headers=b_h).json()] == ["Lab for section B"]
    assert "target_student" not in client.get("/api/academics/announcements", headers=a_h).json()[0]

    # Marks: draft → invisible; publish → each student sees only their own
    asm = client.post(f"/api/faculty/courses/{cid}/assessments", json={"name": "MTE-1", "max_marks": 25}, headers=fac_h).json()
    aid = asm["id"]
    assert client.put(f"/api/faculty/assessments/{aid}/marks", json={"entries": [{"student_id": a["id"], "marks_obtained": 26}]}, headers=fac_h).status_code == 400
    assert client.put(f"/api/faculty/assessments/{aid}/marks", json={"entries": [{"student_id": c["id"], "marks_obtained": 10}]}, headers=fac_h).status_code == 400
    roster = client.put(f"/api/faculty/assessments/{aid}/marks", json={"entries": [
        {"student_id": a["id"], "marks_obtained": 18}, {"student_id": b["id"], "marks_obtained": 21}]}, headers=fac_h).json()
    assert {r["status"] for r in roster["rows"]} == {"DRAFT"}
    assert client.get("/api/academics/marks", headers=a_h).json() == []
    assert client.get(f"/api/faculty/assessments/{aid}/marks", headers=other_fac_h).status_code == 404
    assert client.get(f"/api/faculty/assessments/{aid}/marks", headers=a_h).status_code == 403

    pub = client.post(f"/api/faculty/assessments/{aid}/publish", json={}, headers=fac_h).json()
    assert pub["published"] == 2
    a_marks = client.get("/api/academics/marks", headers=a_h).json()
    b_marks = client.get("/api/academics/marks", headers=b_h).json()
    assert [(m["assessment"]["name"], m["marks_obtained"]) for m in a_marks] == [("MTE-1", 18)]
    assert [m["marks_obtained"] for m in b_marks] == [21]
    assert client.get("/api/academics/marks", headers=c_h).json() == []
    # Student A cannot read Student B's mark by guessing its id
    b_mark_id = b_marks[0]["id"]
    assert client.get(f"/api/academics/marks/{b_mark_id}", headers=a_h).status_code == 404
    assert client.get(f"/api/academics/marks/{a_marks[0]['id']}", headers=a_h).json()["marks_obtained"] == 18
    # Marks never appear in notifications or public profiles
    assert all("18" not in n["text"] for n in client.get("/api/notifications", headers=a_h).json() if n["kind"] == "MARKS")
    assert "marks" not in str(client.get(f"/api/users/{a['id']}", headers=b_h).json()).lower()

    # Revising a published mark needs explicit confirmation and is audited
    assert client.put(f"/api/faculty/assessments/{aid}/marks", json={"entries": [{"student_id": a["id"], "marks_obtained": 19}]}, headers=fac_h).status_code == 409
    rev = client.put(f"/api/faculty/assessments/{aid}/marks", json={"entries": [{"student_id": a["id"], "marks_obtained": 19}], "revise": True}, headers=fac_h).json()
    assert next(r for r in rev["rows"] if r["student"]["id"] == a["id"])["revisions"] == 1
    assert client.get("/api/academics/marks", headers=a_h).json()[0]["marks_obtained"] == 19
    # Unpublish hides it again
    client.post(f"/api/faculty/assessments/{aid}/unpublish", json={"student_ids": [a["id"]]}, headers=fac_h)
    assert client.get("/api/academics/marks", headers=a_h).json() == []
    assert len(client.get("/api/academics/marks", headers=b_h).json()) == 1

    # Faculty dashboard reflects real records
    dash = client.get("/api/faculty/dashboard", headers=fac_h).json()
    assert dash["stats"]["courses"] == 1 and dash["stats"]["students"] == 2 and dash["stats"]["marks_published"] == 1
    assert any(p["kind"] == "MARKS_DRAFT" for p in dash["pending_actions"])

    # Faculty and enrolled student can message each other; unrelated users cannot
    assert client.post("/api/messages", json={"receiver_id": a["id"], "text": "Good work"}, headers=fac_h).status_code == 201
    assert client.post("/api/messages", json={"receiver_id": c["id"], "text": "Hi"}, headers=fac_h).status_code == 403
