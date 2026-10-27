"""Student academic endpoints and the shared calendar.

Privacy rule for marks: a student can only ever read rows where
StudentMark.student_id == the authenticated user's id AND status == PUBLISHED.
The rule is part of every query below; there is no endpoint that accepts a student id.
"""
import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session
import models, database, schemas, services, trust_services
import academic_schemas as S
import academic_services as A
from auth import get_current_user, require_student

router = APIRouter(prefix="/api/academics", tags=["academics"])


def _my_marks_query(db: Session, student_id: int):
    return (db.query(models.StudentMark)
            .filter(models.StudentMark.student_id == student_id, models.StudentMark.status == "PUBLISHED"))


@router.get("/overview")
def overview(user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    """The 'My Academics' block on the student dashboard."""
    course_ids = A.student_course_ids(db, user.id)
    X = models.ExtraClass
    upcoming = (db.query(X).filter(X.course_id.in_(course_ids), X.status == "SCHEDULED", X.end_at >= datetime.datetime.now())
                .order_by(X.start_at).limit(5).all()) if course_ids else []
    anns = A.visible_announcements_query(db, user.id).order_by(models.Announcement.created_at.desc()).limit(5).all()
    marks = _my_marks_query(db, user.id).order_by(models.StudentMark.published_at.desc()).limit(5).all()
    return {
        "course_count": len(course_ids),
        "upcoming_classes": [S.extra_class(x, student_id=user.id) for x in upcoming],
        "announcements": [S.announcement(a) for a in anns],
        "recent_marks": [S.my_mark(m) for m in marks],
    }


# ---------- Courses ----------

@router.get("/courses")
def my_courses(user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    rows = db.query(models.CourseEnrollment).filter_by(student_id=user.id).all()
    return [{**S.course(e.course), "my_section": e.section, "enrolled_at": schemas.iso(e.enrolled_at)} for e in rows]


@router.post("/courses/join", status_code=201)
def join_course(body: S.JoinCourseIn, user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    c = db.query(models.Course).filter_by(join_code=body.join_code.strip().upper()).first()
    if not c or not c.is_active:
        raise HTTPException(status_code=404, detail="No active course with that join code")
    if A.enrollment(db, c.id, user.id):
        raise HTTPException(status_code=409, detail=f"You are already enrolled in {c.code}")
    db.add(models.CourseEnrollment(course_id=c.id, student_id=user.id, section=c.section))
    services.notify(db, c.faculty_id, "SYSTEM", f"{user.name} joined {c.code} {c.name}.", f"/faculty/courses/{c.id}", course_id=c.id)
    db.commit()
    return S.course(c)


@router.delete("/courses/{course_id}", status_code=204)
def leave_course(course_id: int, user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    e = A.enrollment(db, course_id, user.id)
    if not e:
        raise HTTPException(status_code=404, detail="You are not enrolled in this course")
    db.delete(e)
    db.commit()


# ---------- Extra classes ----------

@router.get("/extra-classes")
def my_extra_classes(scope: Literal["upcoming", "past", "all"] = "upcoming", user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    course_ids = A.student_course_ids(db, user.id)
    if not course_ids:
        return []
    X = models.ExtraClass
    q = db.query(X).filter(X.course_id.in_(course_ids))
    now = datetime.datetime.now()
    if scope == "upcoming":
        q = q.filter(X.end_at >= now).order_by(X.start_at)
    elif scope == "past":
        q = q.filter(X.end_at < now).order_by(X.start_at.desc())
    else:
        q = q.order_by(X.start_at.desc())
    return [S.extra_class(x, student_id=user.id) for x in q.all()]


@router.post("/extra-classes/{class_id}/schedule")
def add_to_schedule(class_id: int, user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    x = A.visible_extra_class(db, class_id, user.id)
    if x.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="This class was cancelled")
    if not any(r.student_id == user.id for r in x.rsvps):
        db.add(models.ExtraClassRSVP(extra_class_id=x.id, student_id=user.id))
        db.commit()
        db.refresh(x)
    return S.extra_class(x, student_id=user.id)


@router.delete("/extra-classes/{class_id}/schedule")
def remove_from_schedule(class_id: int, user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    x = A.visible_extra_class(db, class_id, user.id)
    db.query(models.ExtraClassRSVP).filter_by(extra_class_id=x.id, student_id=user.id).delete()
    db.commit()
    db.refresh(x)
    return S.extra_class(x, student_id=user.id)


def _ics_escape(s):
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


@router.get("/extra-classes/{class_id}/ics")
def extra_class_ics(class_id: int, user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    """Calendar file so the student can add the class to their own calendar app."""
    x = A.visible_extra_class(db, class_id, user.id)
    fmt = "%Y%m%dT%H%M%S"
    body = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Guildspace//Academics//EN", "BEGIN:VEVENT",
        f"UID:extra-class-{x.id}@guildspace", f"DTSTAMP:{datetime.datetime.now(datetime.timezone.utc):%Y%m%dT%H%M%SZ}",
        f"DTSTART:{x.start_at.strftime(fmt)}", f"DTEND:{x.end_at.strftime(fmt)}",
        f"SUMMARY:{_ics_escape(x.course.name + ' — Extra class: ' + x.topic)}",
        f"LOCATION:{_ics_escape(x.location)}",
        f"DESCRIPTION:{_ics_escape((x.description or '') + (chr(10) + x.meeting_link if x.meeting_link else ''))}",
        f"STATUS:{'CANCELLED' if x.status == 'CANCELLED' else 'CONFIRMED'}",
        "END:VEVENT", "END:VCALENDAR", "",
    ])
    return Response(body, media_type="text/calendar",
                    headers={"Content-Disposition": f'attachment; filename="extra-class-{x.id}.ics"'})


# ---------- Announcements ----------

@router.get("/announcements")
def my_announcements(course_id: Optional[int] = None, user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    q = A.visible_announcements_query(db, user.id)
    if course_id:
        q = q.filter(models.Announcement.course_id == course_id)
    return [S.announcement(a) for a in q.order_by(models.Announcement.created_at.desc()).limit(100).all()]


# ---------- Marks (own, published only) ----------

@router.get("/marks")
def my_marks(user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    rows = _my_marks_query(db, user.id).order_by(models.StudentMark.published_at.desc()).all()
    return [S.my_mark(m) for m in rows]


@router.get("/marks/{mark_id}")
def my_mark(mark_id: int, user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    m = _my_marks_query(db, user.id).filter(models.StudentMark.id == mark_id).first()
    if m is None:
        # Same response whether the mark is someone else's, unpublished, or missing: nothing leaks.
        raise HTTPException(status_code=404, detail="Mark not found")
    return S.my_mark(m)


# ---------- Calendar (students and faculty) ----------

@router.get("/calendar")
def calendar(month: str, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    """Events for one month (YYYY-MM): extra classes for the user's courses and, for students,
    their mentorship sessions."""
    try:
        first = datetime.datetime.strptime(month, "%Y-%m")
    except ValueError:
        raise HTTPException(status_code=422, detail="month must be YYYY-MM")
    nxt = (first + datetime.timedelta(days=32)).replace(day=1)
    X = models.ExtraClass
    if user.is_faculty:
        cq = db.query(X).join(models.Course).filter(models.Course.faculty_id == user.id)
    else:
        cq = db.query(X).filter(X.course_id.in_(A.student_course_ids(db, user.id) or [-1]))
    events = [{
        "type": "EXTRA_CLASS", "id": x.id, "title": f"{x.course.code}: {x.topic}", "start_at": schemas.iso(x.start_at),
        "end_at": schemas.iso(x.end_at), "location": x.location, "status": x.status,
        "in_my_schedule": any(r.student_id == user.id for r in x.rsvps) if not user.is_faculty else None,
    } for x in cq.filter(X.start_at >= first, X.start_at < nxt).all()]
    if not user.is_faculty:
        R, MS = models.MentorshipRequest, models.MentorshipSession
        sessions = (db.query(MS).join(R).filter(or_(R.learner_id == user.id, R.mentor_id == user.id),
                                                 MS.start_at >= first, MS.start_at < nxt).all())
        events += [{
            "type": "SESSION", "id": s.id, "title": f"Mentorship: {s.request.skill.name}", "start_at": schemas.iso(s.start_at),
            "end_at": schemas.iso(s.end_at), "location": s.location_or_link or s.mode.lower(), "status": s.status,
        } for s in sessions]
    return sorted(events, key=lambda e: e["start_at"])


# ---------- Academic Rescue ----------

class HelpOfferIn(BaseModel):
    course_code: str = Field(min_length=2, max_length=20)
    note: Optional[str] = Field(default=None, max_length=200)
    share_grade_badge: bool = False


def _offer_out(db, o):
    verified = o.share_grade_badge and trust_services.grade_verified(db, o.user_id, o.course_code)
    return {"id": o.id, "course_code": o.course_code, "skill": schemas.skill(o.skill), "note": o.note,
            "share_grade_badge": o.share_grade_badge, "grade_verified": verified, "created_at": schemas.iso(o.created_at)}


@router.get("/help-offers/eligible")
def eligible_courses(user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    """Course codes this student has been enrolled in (any year). Only these can be offered."""
    rows = (db.query(models.Course).join(models.CourseEnrollment)
            .filter(models.CourseEnrollment.student_id == user.id).order_by(models.Course.academic_year.desc()).all())
    seen, out = set(), []
    for c in rows:
        if c.code not in seen:
            seen.add(c.code)
            if trust_services.struggling_in(db, user.id, c.code):
                continue  # can't volunteer for a course you're currently below the rescue threshold in
            out.append({"course_code": c.code, "name": c.name, "academic_year": c.academic_year,
                        "can_show_badge": trust_services.grade_verified(db, user.id, c.code)})
    return out


@router.get("/help-offers")
def my_help_offers(user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    return [_offer_out(db, o) for o in db.query(models.CourseHelpOffer).filter_by(user_id=user.id).all()]


@router.post("/help-offers", status_code=201)
def offer_help(body: HelpOfferIn, user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    code = body.course_code.strip().upper()
    course = (db.query(models.Course).join(models.CourseEnrollment)
              .filter(models.Course.code == code, models.CourseEnrollment.student_id == user.id)
              .order_by(models.Course.academic_year.desc()).first())
    if not course:
        raise HTTPException(status_code=403, detail=f"You can only offer help for courses you have taken. You were never enrolled in {code}.")
    if db.query(models.CourseHelpOffer).filter_by(user_id=user.id, course_code=code).first():
        raise HTTPException(status_code=409, detail=f"You already offer help with {code}")
    if trust_services.struggling_in(db, user.id, code):
        raise HTTPException(status_code=403, detail=f"You can offer help with {code} once your own results there are at least {trust_services.RESCUE_THRESHOLD:g}%.")
    skill = trust_services.help_skill_for(db, course)
    level = "ADVANCED" if trust_services.grade_verified(db, user.id, code) else "INTERMEDIATE"
    if not db.query(models.UserSkill).filter_by(user_id=user.id, skill_id=skill.id, skill_type="OFFERED").first():
        db.add(models.UserSkill(user_id=user.id, skill_id=skill.id, skill_type="OFFERED", level=level))
    if user.role == "LEARNER":
        user.role = "BOTH"  # offering help makes them a mentor for matching purposes
    o = models.CourseHelpOffer(user_id=user.id, course_code=code, skill_id=skill.id, note=body.note,
                               share_grade_badge=body.share_grade_badge)
    db.add(o)
    db.commit()
    db.refresh(o)
    return _offer_out(db, o)


@router.delete("/help-offers/{offer_id}", status_code=204)
def withdraw_help(offer_id: int, user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    o = db.get(models.CourseHelpOffer, offer_id)
    if not o or o.user_id != user.id:
        raise HTTPException(status_code=404, detail="Offer not found")
    db.query(models.UserSkill).filter_by(user_id=user.id, skill_id=o.skill_id, skill_type="OFFERED").delete()
    db.delete(o)
    db.commit()


@router.get("/rescue")
def rescue(user: models.User = Depends(require_student), db: Session = Depends(database.get_db)):
    """For each course where the student's OWN published mark is below the threshold:
    peers who took the course and offer help, the next extra class, and exam/assignment notices."""
    low = {}
    for course, a, pct in trust_services.own_course_percentages(db, user.id):
        if pct < trust_services.RESCUE_THRESHOLD:
            low.setdefault(course.code, {"course": course, "low": []})["low"].append({"assessment": a.name, "percentage": pct})
    enrolled = set(A.student_course_ids(db, user.id))
    now = datetime.datetime.now()
    out = []
    for code, item in low.items():
        course = item["course"]
        offers = (db.query(models.CourseHelpOffer).join(models.User, models.User.id == models.CourseHelpOffer.user_id)
                  .filter(models.CourseHelpOffer.course_code == code, models.CourseHelpOffer.user_id != user.id,
                          models.User.is_active.is_(True)).all())
        helpers = []
        for o in offers:
            h = o.user
            avg, count = services.rating_stats(db, h.id)
            existing = (db.query(models.MentorshipRequest)
                        .filter_by(learner_id=user.id, mentor_id=h.id, skill_id=o.skill_id)
                        .order_by(models.MentorshipRequest.created_at.desc()).first())
            helpers.append({
                "user": schemas.user_brief(h), "mode": h.preferred_mode, "skill_id": o.skill_id, "note": o.note,
                "grade_verified": o.share_grade_badge and trust_services.grade_verified(db, h.id, code),
                "avg_rating": avg, "rating_count": count,
                "reliability": trust_services.reliability(db, h.id)["score"],
                "overlap_minutes": services.weekly_overlap_minutes(user.availabilities, h.availabilities),
                "shared_slots": services.shared_slots(user.availabilities, h.availabilities)[:3],
                "request_status": existing.status if existing else None,
            })
        helpers.sort(key=lambda x: (not x["grade_verified"], -(x["avg_rating"] or 0), -x["overlap_minutes"]))
        course_ids = [cid for cid in enrolled if db.get(models.Course, cid).code == code]
        X = models.ExtraClass
        nxt = (db.query(X).filter(X.course_id.in_(course_ids or [-1]), X.status == "SCHEDULED", X.end_at >= now)
               .order_by(X.start_at).first())
        notices = (A.visible_announcements_query(db, user.id)
                   .filter(models.Announcement.course_id.in_(course_ids or [-1]), models.Announcement.category.in_(["EXAM", "ASSIGNMENT", "EXTRA_CLASS"]))
                   .order_by(models.Announcement.created_at.desc()).limit(3).all())
        out.append({
            "course": {"code": code, "name": course.name},
            "low_assessments": item["low"],  # the student's own results only
            "helpers": helpers,
            "next_extra_class": S.extra_class(nxt, student_id=user.id) if nxt else None,
            "notices": [S.announcement(n) for n in notices],
        })
    return {"threshold": trust_services.RESCUE_THRESHOLD, "courses": out}
