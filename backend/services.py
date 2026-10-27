"""Shared domain helpers used by several routers."""
import datetime
from sqlalchemy import func, or_, and_
from sqlalchemy.orm import Session
import models

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def notify(db: Session, user_id: int, kind: str, text: str, link: str = None, course_id: int = None):
    """Queue a notification; caller commits."""
    db.add(models.Notification(user_id=user_id, kind=kind, text=text, link=link, course_id=course_id))


def rating_stats(db: Session, user_id: int):
    avg, count = db.query(func.avg(models.Feedback.rating), func.count(models.Feedback.id)).filter(
        models.Feedback.receiver_id == user_id
    ).one()
    return (round(float(avg), 2) if avg is not None else None), count


def to_minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def weekly_overlap_minutes(a_slots, b_slots):
    """Total minutes per week where both users have declared availability."""
    total = 0
    for a in a_slots:
        for b in b_slots:
            if a.day_of_week != b.day_of_week:
                continue
            start = max(to_minutes(a.start_time), to_minutes(b.start_time))
            end = min(to_minutes(a.end_time), to_minutes(b.end_time))
            if end > start:
                total += end - start
    return total


def shared_slots(a_slots, b_slots):
    """Concrete weekly windows where both users are free, earliest weekday first."""
    out = []
    for a in a_slots:
        for b in b_slots:
            if a.day_of_week != b.day_of_week:
                continue
            start = max(to_minutes(a.start_time), to_minutes(b.start_time))
            end = min(to_minutes(a.end_time), to_minutes(b.end_time))
            if end > start:
                out.append({"day": a.day_of_week, "start": f"{start // 60:02d}:{start % 60:02d}", "end": f"{end // 60:02d}:{end % 60:02d}"})
    return sorted(out, key=lambda s: (DAYS.index(s["day"]), s["start"]))


def within_availability(user: models.User, start: datetime.datetime, end: datetime.datetime) -> bool:
    """True if [start, end) lies inside one of the user's availability slots for that weekday."""
    if start.date() != end.date():
        return False
    day = DAYS[start.weekday()]
    s = start.hour * 60 + start.minute
    e = end.hour * 60 + end.minute
    return any(
        slot.day_of_week == day and to_minutes(slot.start_time) <= s and e <= to_minutes(slot.end_time)
        for slot in user.availabilities
    )


def conflicting_session(db: Session, user_ids, start, end, exclude_session_id=None):
    """Return an active session of any of the given users that overlaps [start, end)."""
    q = (
        db.query(models.MentorshipSession)
        .join(models.MentorshipRequest)
        .filter(
            models.MentorshipSession.status.in_(["SCHEDULED", "RESCHEDULED"]),
            models.MentorshipSession.start_at < end,
            models.MentorshipSession.end_at > start,
            or_(models.MentorshipRequest.learner_id.in_(user_ids), models.MentorshipRequest.mentor_id.in_(user_ids)),
        )
    )
    if exclude_session_id:
        q = q.filter(models.MentorshipSession.id != exclude_session_id)
    return q.first()


def share_course(db: Session, a: int, b: int) -> bool:
    """True if one user teaches a course the other is enrolled in."""
    C, E = models.Course, models.CourseEnrollment
    return db.query(E).join(C).filter(or_(
        and_(C.faculty_id == a, E.student_id == b),
        and_(C.faculty_id == b, E.student_id == a),
    )).first() is not None


def are_connected(db: Session, a: int, b: int) -> bool:
    """Users may message each other once a mentorship request between them has been accepted,
    or when one teaches a course the other is enrolled in."""
    if share_course(db, a, b):
        return True
    return (
        db.query(models.MentorshipRequest)
        .filter(
            models.MentorshipRequest.status.in_(["ACCEPTED", "COMPLETED"]),
            or_(
                and_(models.MentorshipRequest.learner_id == a, models.MentorshipRequest.mentor_id == b),
                and_(models.MentorshipRequest.learner_id == b, models.MentorshipRequest.mentor_id == a),
            ),
        )
        .first()
        is not None
    )
