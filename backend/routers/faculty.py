"""Faculty endpoints: courses, rosters, extra classes, announcements, assessments and marks.

Every route requires a verified faculty account (or an administrator), and every record is
checked against the course's faculty before it is read or changed.
"""
import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import models, database, services, schemas, trust_services
import academic_schemas as S
import academic_services as A
from auth import get_current_user, require_faculty

router = APIRouter(prefix="/api/faculty", tags=["faculty"])


def faculty_or_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if user.is_admin:
        return user
    return require_faculty(user)


def _fmt(dt):
    return dt.strftime("%a %d %b, %I:%M %p").replace(" 0", " ")


def _notify_students(db, course, student_ids, kind, text, link):
    for sid in student_ids:
        services.notify(db, sid, kind, text, link, course_id=course.id)


# ---------- Dashboard ----------

@router.get("/dashboard")
def dashboard(user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    courses = db.query(models.Course).filter_by(faculty_id=user.id).order_by(models.Course.code).all()
    course_ids = [c.id for c in courses]
    now = datetime.datetime.now()
    X = models.ExtraClass
    upcoming = (db.query(X).filter(X.course_id.in_(course_ids), X.status == "SCHEDULED", X.end_at >= now)
                .order_by(X.start_at).all()) if course_ids else []
    recent_ann = (db.query(models.Announcement).filter(models.Announcement.course_id.in_(course_ids))
                  .order_by(models.Announcement.created_at.desc()).limit(5).all()) if course_ids else []
    assessments = db.query(models.Assessment).filter(models.Assessment.course_id.in_(course_ids)).all() if course_ids else []
    students = {e.student_id for c in courses for e in c.enrollments}

    # Pending actions are derived from the records, not stored.
    pending = []
    for a in assessments:
        n = len(a.course.enrollments)
        entered = sum(1 for m in a.marks if m.marks_obtained is not None)
        drafts = sum(1 for m in a.marks if m.status == "DRAFT" and m.marks_obtained is not None)
        if n and entered < n:
            pending.append({"kind": "MARKS_MISSING", "text": f"{a.course.code} {a.name}: marks entered for {entered} of {n} students", "link": f"/faculty/marks?assessment={a.id}"})
        if drafts:
            pending.append({"kind": "MARKS_DRAFT", "text": f"{a.course.code} {a.name}: {drafts} mark(s) saved as draft, not published", "link": f"/faculty/marks?assessment={a.id}"})
    for c in courses:
        if c.is_active and not c.enrollments:
            pending.append({"kind": "NO_STUDENTS", "text": f"{c.code} ({c.section}) has no students yet. Share join code {c.join_code}", "link": f"/faculty/courses/{c.id}"})

    # Academic Rescue insights: counts only, never which students asked for help.
    rescue = []
    for c in courses:
        ids = {e.student_id for e in c.enrollments}
        below = {m.student_id for a in c.assessments for m in a.marks
                 if m.status == "PUBLISHED" and m.marks_obtained is not None
                 and 100 * m.marks_obtained / a.max_marks < trust_services.RESCUE_THRESHOLD}
        skill_ids = trust_services.help_skill_ids(db, c.code)
        asked = (db.query(models.MentorshipRequest).filter(models.MentorshipRequest.skill_id.in_(skill_ids or [-1]),
                                                          models.MentorshipRequest.learner_id.in_(ids or [-1]),
                                                          models.MentorshipRequest.status != "REJECTED").count())
        helpers = db.query(models.CourseHelpOffer).filter_by(course_code=c.code).count()
        if below or asked or helpers:
            rescue.append({"course_id": c.id, "code": c.code, "name": c.name, "below_threshold": len(below),
                           "help_requests": asked, "helpers_available": helpers})

    week_ago = now - datetime.timedelta(days=7)
    releases = {(m.assessment_id) for a in assessments for m in a.marks if m.status == "PUBLISHED" and m.published_at and m.published_at >= week_ago}
    return {
        "user": {"id": user.id, "name": user.name, "faculty_profile": schemas.faculty_profile(user.faculty_profile)},
        "stats": {
            "courses": len([c for c in courses if c.is_active]),
            "students": len(students),
            "upcoming_classes": len(upcoming),
            "announcements": db.query(models.Announcement).filter(models.Announcement.course_id.in_(course_ids)).count() if course_ids else 0,
            "assessments": len(assessments),
            "marks_published": sum(1 for a in assessments for m in a.marks if m.status == "PUBLISHED"),
            "recent_mark_releases": len(releases),
            "pending_actions": len(pending),
        },
        "courses": [S.course(c, include_join_code=True) for c in courses],
        "upcoming_classes": [S.extra_class(x, faculty_view=True) for x in upcoming[:5]],
        "recent_announcements": [S.announcement(a, faculty_view=True) for a in recent_ann],
        "pending_actions": pending[:8],
        "rescue_insights": rescue,
        "rescue_threshold": trust_services.RESCUE_THRESHOLD,
    }


# ---------- Courses & enrolment ----------

@router.get("/courses")
def list_courses(user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    rows = db.query(models.Course).filter_by(faculty_id=user.id).order_by(models.Course.is_active.desc(), models.Course.code).all()
    return [S.course(c, include_join_code=True) for c in rows]


def _check_unique(db, body, exclude_id=None):
    q = db.query(models.Course).filter_by(code=body.code, section=body.section, academic_year=body.academic_year)
    if exclude_id:
        q = q.filter(models.Course.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=409, detail=f"{body.code} section {body.section} already exists for {body.academic_year}")


@router.post("/courses", status_code=201)
def create_course(body: S.CourseIn, user: models.User = Depends(require_faculty), db: Session = Depends(database.get_db)):
    _check_unique(db, body)
    c = models.Course(faculty_id=user.id, join_code=A.new_join_code(db), **body.model_dump())
    db.add(c)
    db.commit()
    db.refresh(c)
    return S.course(c, include_join_code=True)


@router.get("/courses/{course_id}")
def get_course(course_id: int, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    c = A.owned_course(db, course_id, user)
    data = S.course(c, include_join_code=True)
    data["students"] = [S.enrollment(e) for e in sorted(c.enrollments, key=lambda e: (e.section, e.student.name))]
    data["assessments"] = [S.assessment(a) for a in c.assessments]
    return data


@router.put("/courses/{course_id}")
def update_course(course_id: int, body: S.CourseUpdateIn, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    c = A.owned_course(db, course_id, user)
    _check_unique(db, body, exclude_id=c.id)
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    db.commit()
    return S.course(c, include_join_code=True)


@router.post("/courses/{course_id}/join-code")
def regenerate_join_code(course_id: int, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    c = A.owned_course(db, course_id, user)
    c.join_code = A.new_join_code(db)
    db.commit()
    return S.course(c, include_join_code=True)


@router.post("/courses/{course_id}/students", status_code=201)
def add_student(course_id: int, body: S.EnrollStudentIn, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    c = A.owned_course(db, course_id, user)
    student = db.query(models.User).filter_by(email=body.email.lower()).first()
    if not student or not student.is_active:
        raise HTTPException(status_code=404, detail="No active account with that email")
    if student.account_type != "STUDENT":
        raise HTTPException(status_code=400, detail="Only student accounts can be enrolled")
    if A.enrollment(db, c.id, student.id):
        raise HTTPException(status_code=409, detail=f"{student.name} is already enrolled")
    e = models.CourseEnrollment(course_id=c.id, student_id=student.id, section=(body.section or c.section).strip().upper())
    db.add(e)
    services.notify(db, student.id, "ANNOUNCEMENT", f"You were added to {c.code} {c.name} by {user.name}.", "/academics", course_id=c.id)
    db.commit()
    db.refresh(e)
    return S.enrollment(e)


@router.delete("/courses/{course_id}/students/{student_id}", status_code=204)
def remove_student(course_id: int, student_id: int, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    c = A.owned_course(db, course_id, user)
    e = A.enrollment(db, c.id, student_id)
    if not e:
        raise HTTPException(status_code=404, detail="Student is not enrolled in this course")
    db.delete(e)
    db.commit()


# ---------- Extra classes ----------

@router.get("/extra-classes")
def list_extra_classes(scope: Literal["upcoming", "past", "all"] = "upcoming", user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    X = models.ExtraClass
    q = db.query(X).join(models.Course).filter(models.Course.faculty_id == user.id)
    now = datetime.datetime.now()
    if scope == "upcoming":
        q = q.filter(X.end_at >= now).order_by(X.start_at)
    elif scope == "past":
        q = q.filter(X.end_at < now).order_by(X.start_at.desc())
    else:
        q = q.order_by(X.start_at.desc())
    return [S.extra_class(x, faculty_view=True) for x in q.all()]


@router.post("/extra-classes", status_code=201)
def create_extra_class(body: S.ExtraClassIn, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    c = A.owned_course(db, body.course_id, user)
    if not c.is_active:
        raise HTTPException(status_code=400, detail="This course is archived")
    if body.start_at <= datetime.datetime.now():
        raise HTTPException(status_code=400, detail="Extra classes must be scheduled in the future")
    clash = A.extra_class_conflict(db, c, body.start_at, body.end_at, body.location)
    if clash:
        raise HTTPException(status_code=409, detail=clash)
    x = models.ExtraClass(**body.model_dump())
    db.add(x)
    db.flush()
    _notify_students(db, c, [e.student_id for e in c.enrollments], "EXTRA_CLASS",
                     f"Extra class: {c.name} — {x.topic}, {_fmt(x.start_at)} in {x.location}.", "/academics")
    db.commit()
    db.refresh(x)
    return S.extra_class(x, faculty_view=True)


@router.put("/extra-classes/{class_id}")
def update_extra_class(class_id: int, body: S.ExtraClassIn, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    x = A.owned_extra_class(db, class_id, user)
    if x.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="A cancelled class cannot be edited")
    if body.course_id != x.course_id:
        raise HTTPException(status_code=400, detail="The course of an extra class cannot be changed")
    if body.start_at <= datetime.datetime.now():
        raise HTTPException(status_code=400, detail="Extra classes must be scheduled in the future")
    clash = A.extra_class_conflict(db, x.course, body.start_at, body.end_at, body.location, exclude_id=x.id)
    if clash:
        raise HTTPException(status_code=409, detail=clash)
    moved = (x.start_at, x.end_at, x.location) != (body.start_at, body.end_at, body.location)
    for k, v in body.model_dump().items():
        setattr(x, k, v)
    text = (f"Extra class moved: {x.course.name} — {x.topic} is now {_fmt(x.start_at)} in {x.location}." if moved
            else f"Extra class updated: {x.course.name} — {x.topic} ({_fmt(x.start_at)}).")
    _notify_students(db, x.course, [e.student_id for e in x.course.enrollments], "EXTRA_CLASS", text, "/academics")
    db.commit()
    return S.extra_class(x, faculty_view=True)


@router.post("/extra-classes/{class_id}/cancel")
def cancel_extra_class(class_id: int, body: S.CancelIn, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    x = A.owned_extra_class(db, class_id, user)
    if x.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="Already cancelled")
    x.status, x.cancel_reason = "CANCELLED", body.reason
    _notify_students(db, x.course, [e.student_id for e in x.course.enrollments], "EXTRA_CLASS",
                     f"Cancelled: {x.course.name} extra class on {_fmt(x.start_at)}" + (f" — {body.reason}" if body.reason else "."), "/academics")
    db.commit()
    return S.extra_class(x, faculty_view=True)


# ---------- Announcements ----------

@router.get("/announcements")
def list_announcements(user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    rows = (db.query(models.Announcement).join(models.Course).filter(models.Course.faculty_id == user.id)
            .order_by(models.Announcement.created_at.desc()).limit(100).all())
    return [S.announcement(a, faculty_view=True) for a in rows]


@router.post("/announcements", status_code=201)
def create_announcement(body: S.AnnouncementIn, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    c = A.owned_course(db, body.course_id, user)
    if body.target_type == "COURSE":
        recipients = [e.student_id for e in c.enrollments]
    elif body.target_type == "SECTION":
        recipients = [e.student_id for e in c.enrollments if e.section == body.target_section]
        if not recipients:
            raise HTTPException(status_code=400, detail=f"No students are enrolled in section {body.target_section}")
    else:
        if not A.enrollment(db, c.id, body.target_student_id):
            raise HTTPException(status_code=400, detail="That student is not enrolled in this course")
        recipients = [body.target_student_id]
    a = models.Announcement(author_id=user.id, **body.model_dump(exclude={"target_section", "target_student_id"}),
                            target_section=body.target_section if body.target_type == "SECTION" else None,
                            target_student_id=body.target_student_id if body.target_type == "STUDENT" else None)
    db.add(a)
    db.flush()
    prefix = "Important: " if body.is_important else ""
    _notify_students(db, c, recipients, "ANNOUNCEMENT", f"{prefix}{c.code} — {body.title}", "/academics?tab=announcements")
    db.commit()
    db.refresh(a)
    return {**S.announcement(a, faculty_view=True), "recipient_count": len(recipients)}


@router.delete("/announcements/{announcement_id}", status_code=204)
def delete_announcement(announcement_id: int, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    a = db.get(models.Announcement, announcement_id)
    if not a:
        raise HTTPException(status_code=404, detail="Announcement not found")
    A.owned_course(db, a.course_id, user)
    db.delete(a)
    db.commit()


# ---------- Assessments & marks ----------

@router.get("/courses/{course_id}/assessments")
def list_assessments(course_id: int, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    c = A.owned_course(db, course_id, user)
    return [S.assessment(a) for a in sorted(c.assessments, key=lambda a: a.created_at)]


@router.post("/courses/{course_id}/assessments", status_code=201)
def create_assessment(course_id: int, body: S.AssessmentIn, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    c = A.owned_course(db, course_id, user)
    name = body.name.strip()
    if any(a.name.lower() == name.lower() for a in c.assessments):
        raise HTTPException(status_code=409, detail=f"{c.code} already has an assessment called {name}")
    a = models.Assessment(course_id=c.id, name=name, max_marks=body.max_marks, assessment_date=body.assessment_date)
    db.add(a)
    db.commit()
    db.refresh(a)
    return S.assessment(a)


@router.delete("/assessments/{assessment_id}", status_code=204)
def delete_assessment(assessment_id: int, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    a = A.owned_assessment(db, assessment_id, user)
    if any(m.status == "PUBLISHED" for m in a.marks):
        raise HTTPException(status_code=400, detail="Unpublish all marks before deleting this assessment")
    db.delete(a)
    db.commit()


def _roster(a: models.Assessment):
    by_student = {m.student_id: m for m in a.marks}
    rows = []
    for e in sorted(a.course.enrollments, key=lambda e: (e.section, e.student.name)):
        m = by_student.get(e.student_id)
        rows.append({
            "student": {"id": e.student.id, "name": e.student.name, "email": e.student.email},
            "section": e.section,
            "mark_id": m.id if m else None,
            "marks_obtained": m.marks_obtained if m else None,
            "remarks": m.remarks if m else None,
            "status": m.status if m else "NOT_ENTERED",
            "published_at": m.published_at.isoformat() if m and m.published_at else None,
            "revisions": sum(1 for x in m.audit if x.action == "REVISE") if m else 0,
        })
    return {"assessment": S.assessment(a), "course": S.course(a.course), "rows": rows}


@router.get("/assessments/{assessment_id}/marks")
def get_marks(assessment_id: int, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    return _roster(A.owned_assessment(db, assessment_id, user))


@router.put("/assessments/{assessment_id}/marks")
def save_marks(assessment_id: int, body: S.MarksSaveIn, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    """Save marks. New and draft marks stay drafts; published marks change only with revise=true."""
    a = A.owned_assessment(db, assessment_id, user)
    enrolled = {e.student_id for e in a.course.enrollments}
    existing = {m.student_id: m for m in a.marks}
    revised = []
    for entry in body.entries:
        if entry.student_id not in enrolled:
            raise HTTPException(status_code=400, detail=f"Student {entry.student_id} is not enrolled in {a.course.code}")
        if entry.marks_obtained is not None and entry.marks_obtained > a.max_marks:
            raise HTTPException(status_code=400, detail=f"Marks cannot exceed the maximum of {a.max_marks:g}")
        m = existing.get(entry.student_id)
        if m is None:
            if entry.marks_obtained is None and not entry.remarks:
                continue
            m = models.StudentMark(assessment_id=a.id, student_id=entry.student_id)
            db.add(m)
            db.flush()
            action = "ENTER"
        else:
            unchanged = m.marks_obtained == entry.marks_obtained and (m.remarks or None) == (entry.remarks or None)
            if unchanged:
                continue
            if m.status == "PUBLISHED":
                if not body.revise:
                    raise HTTPException(status_code=409, detail=f"Marks for {m.student.name} are already published. Confirm a revision to change them.")
                if entry.marks_obtained is None:
                    raise HTTPException(status_code=400, detail="A published mark cannot be cleared; unpublish it instead")
                revised.append(m)
                action = "REVISE"
            else:
                action = "UPDATE"
        db.add(models.MarkAudit(mark_id=m.id, actor_id=user.id, action=action, old_value=m.marks_obtained, new_value=entry.marks_obtained))
        m.marks_obtained, m.remarks, m.updated_by = entry.marks_obtained, entry.remarks, user.id
    for m in revised:
        services.notify(db, m.student_id, "MARKS", f"Your {a.course.code} {a.name} marks were revised.", "/academics?tab=marks", course_id=a.course_id)
    db.commit()
    db.refresh(a)
    return _roster(a)


@router.post("/assessments/{assessment_id}/publish")
def publish_marks(assessment_id: int, body: S.PublishIn, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    a = A.owned_assessment(db, assessment_id, user)
    targets = [m for m in a.marks if m.status == "DRAFT" and m.marks_obtained is not None
               and (body.student_ids is None or m.student_id in body.student_ids)]
    if not targets:
        raise HTTPException(status_code=400, detail="No draft marks to publish. Enter and save marks first.")
    now = datetime.datetime.now()
    for m in targets:
        m.status, m.published_at, m.updated_by = "PUBLISHED", now, user.id
        db.add(models.MarkAudit(mark_id=m.id, actor_id=user.id, action="PUBLISH", new_value=m.marks_obtained))
        # The notification says marks are available, never the score itself.
        services.notify(db, m.student_id, "MARKS", f"{a.course.code} {a.name} marks are published.", "/academics?tab=marks", course_id=a.course_id)
        trust_services.notify_rescue_if_low(db, m)
    db.commit()
    db.refresh(a)
    return {**_roster(a), "published": len(targets)}


@router.post("/assessments/{assessment_id}/unpublish")
def unpublish_marks(assessment_id: int, body: S.PublishIn, user: models.User = Depends(faculty_or_admin), db: Session = Depends(database.get_db)):
    a = A.owned_assessment(db, assessment_id, user)
    targets = [m for m in a.marks if m.status == "PUBLISHED" and (body.student_ids is None or m.student_id in body.student_ids)]
    if not targets:
        raise HTTPException(status_code=400, detail="No published marks to unpublish")
    for m in targets:
        m.status, m.updated_by = "DRAFT", user.id
        db.add(models.MarkAudit(mark_id=m.id, actor_id=user.id, action="UNPUBLISH", old_value=m.marks_obtained))
        services.notify(db, m.student_id, "MARKS", f"{a.course.code} {a.name} marks were withdrawn for revision.", "/academics?tab=marks", course_id=a.course_id)
    db.commit()
    db.refresh(a)
    return {**_roster(a), "unpublished": len(targets)}
