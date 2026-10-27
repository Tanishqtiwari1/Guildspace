"""Time credits (escrow), reliability, and Academic Rescue helpers.

Credits: 1 credit = 1 hour of mentoring. When a session is scheduled the learner's credits
are put on HOLD; they move to the mentor (EARNED) only once both people confirm the session
happened, and go back to the learner (REFUND) if it is cancelled or the mentor does not show up.
"""
import datetime
from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
import models
import services

STARTER_CREDITS = 2.0
LATE_CANCEL_HOURS = 24
RESCUE_THRESHOLD = 50.0      # % below which a published mark triggers Academic Rescue
GRADE_VERIFIED_AT = 60.0     # % a helper needs (on their own marks) for the opt-in badge


def _now():
    return datetime.datetime.now()


# ---------- Credits ----------

def ensure_starter(db: Session, user_id: int):
    """Every student account starts with STARTER_CREDITS, granted once."""
    u = db.get(models.User, user_id)
    if not u or u.account_type != "STUDENT":
        return
    if not db.query(models.CreditTransaction).filter_by(user_id=user_id, kind="STARTER").first():
        db.add(models.CreditTransaction(user_id=user_id, amount=STARTER_CREDITS, kind="STARTER", note="Welcome credits"))
        db.flush()


def balance(db: Session, user_id: int) -> float:
    total = db.query(func.coalesce(func.sum(models.CreditTransaction.amount), 0.0)).filter_by(user_id=user_id).scalar()
    return round(float(total), 2)


def session_hours(s: models.MentorshipSession) -> float:
    return round((s.end_at - s.start_at).total_seconds() / 3600, 2)


def held_for_session(db: Session, s: models.MentorshipSession) -> float:
    """Credits currently held from the learner for this session (HOLD minus REFUND)."""
    total = db.query(func.coalesce(func.sum(models.CreditTransaction.amount), 0.0)).filter(
        models.CreditTransaction.session_id == s.id,
        models.CreditTransaction.user_id == s.request.learner_id,
        models.CreditTransaction.kind.in_(["HOLD", "REFUND"]),
    ).scalar()
    return round(-float(total), 2)


def _require(db, learner_id, hours):
    ensure_starter(db, learner_id)
    have = balance(db, learner_id)
    if have + 1e-9 < hours:
        learner = db.get(models.User, learner_id)
        raise HTTPException(status_code=402, detail=(
            f"{learner.name} needs {hours:g} credit(s) for this session but has {have:g}. "
            "Credits are earned by teaching: 1 hour taught = 1 credit."))


def hold(db: Session, s: models.MentorshipSession):
    hours = session_hours(s)
    _require(db, s.request.learner_id, hours)
    db.add(models.CreditTransaction(user_id=s.request.learner_id, amount=-hours, kind="HOLD", session_id=s.id,
                                    note=f"Held for {s.request.skill.name} session"))


def adjust_hold(db: Session, s: models.MentorshipSession):
    """After a reschedule, hold more or refund the difference to match the new length."""
    diff = round(session_hours(s) - held_for_session(db, s), 2)
    if diff > 0:
        _require(db, s.request.learner_id, diff)
        db.add(models.CreditTransaction(user_id=s.request.learner_id, amount=-diff, kind="HOLD", session_id=s.id, note="Session made longer"))
    elif diff < 0:
        db.add(models.CreditTransaction(user_id=s.request.learner_id, amount=-diff, kind="REFUND", session_id=s.id, note="Session made shorter"))


def refund(db: Session, s: models.MentorshipSession, note="Session cancelled"):
    held = held_for_session(db, s)
    if held > 0:
        db.add(models.CreditTransaction(user_id=s.request.learner_id, amount=held, kind="REFUND", session_id=s.id, note=note))


def settle(db: Session, s: models.MentorshipSession, note="Session completed"):
    """Pay the mentor. Sessions booked before the ledger existed have no hold; charge them now."""
    held = held_for_session(db, s)
    if held <= 0:
        held = session_hours(s)
        db.add(models.CreditTransaction(user_id=s.request.learner_id, amount=-held, kind="HOLD", session_id=s.id, note="Charged at completion"))
    db.add(models.CreditTransaction(user_id=s.request.mentor_id, amount=held, kind="EARNED", session_id=s.id,
                                    note=f"Taught {s.request.skill.name} to {s.request.learner.name}"))


def cancel_session_record(db: Session, s: models.MentorshipSession, by_user_id: int):
    """Cancel, record who did it and when (for reliability), and refund the learner."""
    s.status, s.cancelled_by, s.cancelled_at = "CANCELLED", by_user_id, _now()
    refund(db, s)
    return is_late_cancel(s)


def is_late_cancel(s: models.MentorshipSession) -> bool:
    return bool(s.cancelled_at and s.cancelled_at > s.start_at - datetime.timedelta(hours=LATE_CANCEL_HOURS))


# ---------- Reliability ----------

def reliability(db: Session, user_id: int):
    """Share of a user's sessions they actually kept. Late cancellations and no-shows count against them."""
    R, S = models.MentorshipRequest, models.MentorshipSession
    rows = db.query(S).join(R).filter(or_(R.learner_id == user_id, R.mentor_id == user_id)).all()
    kept = sum(1 for s in rows if s.status == "COMPLETED")
    late = sum(1 for s in rows if s.status == "CANCELLED" and s.cancelled_by == user_id and is_late_cancel(s))
    no_shows = sum(1 for s in rows if s.status == "NO_SHOW" and s.no_show_user_id == user_id)
    events = kept + late + no_shows
    score = round(100 * kept / events) if events else None
    return {"score": score, "kept": kept, "late_cancellations": late, "no_shows": no_shows, "events": events}


def reliability_penalty(rel) -> int:
    """Points taken off a match score. Needs at least 3 tracked sessions before it applies."""
    if not rel or rel["score"] is None or rel["events"] < 3 or rel["score"] >= 90:
        return 0
    return -min(10, round((90 - rel["score"]) / 4))


# ---------- Academic Rescue ----------

def own_course_percentages(db: Session, student_id: int, course_code: str = None):
    """The student's OWN published marks as (course, assessment, percentage). Never anyone else's."""
    M, A, C = models.StudentMark, models.Assessment, models.Course
    q = (db.query(M, A, C).join(A, A.id == M.assessment_id).join(C, C.id == A.course_id)
         .filter(M.student_id == student_id, M.status == "PUBLISHED", M.marks_obtained.isnot(None)))
    if course_code:
        q = q.filter(C.code == course_code)
    return [(c, a, round(100 * m.marks_obtained / a.max_marks, 1)) for m, a, c in q.all()]


def grade_verified(db: Session, student_id: int, course_code: str) -> bool:
    pcts = [p for _, _, p in own_course_percentages(db, student_id, course_code)]
    return bool(pcts) and sum(pcts) / len(pcts) >= GRADE_VERIFIED_AT


def struggling_in(db: Session, student_id: int, course_code: str) -> bool:
    """True if the student's own published average in this course is below the rescue threshold."""
    pcts = [p for _, _, p in own_course_percentages(db, student_id, course_code)]
    return bool(pcts) and sum(pcts) / len(pcts) < RESCUE_THRESHOLD


def help_skill_for(db: Session, course: models.Course) -> models.Skill:
    """The teachable skill that represents 'help with this course'."""
    name = f"{course.code} · {course.name}"
    sk = db.query(models.Skill).filter(func.lower(models.Skill.name) == name.lower()).first()
    if not sk:
        sk = models.Skill(name=name, category="Course help", description=f"Peer help for {course.code} {course.name}")
        db.add(sk)
        db.flush()
    return sk


def help_skill_ids(db: Session, course_code: str):
    return [sid for (sid,) in db.query(models.CourseHelpOffer.skill_id).filter_by(course_code=course_code).distinct()]


def notify_rescue_if_low(db: Session, mark: models.StudentMark):
    """Private nudge after a low mark is published. Says help exists; never states the score."""
    a = mark.assessment
    if mark.marks_obtained is None or 100 * mark.marks_obtained / a.max_marks >= RESCUE_THRESHOLD:
        return
    helpers = db.query(models.CourseHelpOffer).filter(models.CourseHelpOffer.course_code == a.course.code,
                                                       models.CourseHelpOffer.user_id != mark.student_id).count()
    text = (f"Need a hand with {a.course.code}? {helpers} student{'s' if helpers != 1 else ''} who took it offer help."
            if helpers else f"Support is available for {a.course.code}: see upcoming extra classes and notices.")
    services.notify(db, mark.student_id, "MARKS", text, "/academics?tab=rescue", course_id=a.course_id)
