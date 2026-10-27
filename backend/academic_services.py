"""Authorization and query helpers for the academic module.

Every rule here is enforced on the server; the frontend only mirrors it.
"""
import secrets
import string
from fastapi import HTTPException
from sqlalchemy import or_, and_, func
from sqlalchemy.orm import Session
import models

JOIN_ALPHABET = string.ascii_uppercase + string.digits


def new_join_code(db: Session) -> str:
    while True:
        code = "".join(secrets.choice(JOIN_ALPHABET) for _ in range(7))
        if not db.query(models.Course).filter_by(join_code=code).first():
            return code


def owned_course(db: Session, course_id: int, user: models.User) -> models.Course:
    """The course, if `user` teaches it (or is an admin). 404 otherwise, so other faculty
    cannot even confirm that the course exists."""
    c = db.get(models.Course, course_id)
    if not c or (c.faculty_id != user.id and not user.is_admin):
        raise HTTPException(status_code=404, detail="Course not found")
    return c


def owned_assessment(db: Session, assessment_id: int, user: models.User) -> models.Assessment:
    a = db.get(models.Assessment, assessment_id)
    if not a:
        raise HTTPException(status_code=404, detail="Assessment not found")
    owned_course(db, a.course_id, user)
    return a


def owned_extra_class(db: Session, class_id: int, user: models.User) -> models.ExtraClass:
    x = db.get(models.ExtraClass, class_id)
    if not x:
        raise HTTPException(status_code=404, detail="Extra class not found")
    owned_course(db, x.course_id, user)
    return x


def enrollment(db: Session, course_id: int, student_id: int):
    return db.query(models.CourseEnrollment).filter_by(course_id=course_id, student_id=student_id).first()


def student_course_ids(db: Session, student_id: int):
    return [cid for (cid,) in db.query(models.CourseEnrollment.course_id).filter_by(student_id=student_id)]


def visible_announcements_query(db: Session, student_id: int):
    """Announcements addressed to this student: whole course, their section, or them personally,
    restricted to courses they are enrolled in."""
    A, E = models.Announcement, models.CourseEnrollment
    return (
        db.query(A)
        .join(E, and_(E.course_id == A.course_id, E.student_id == student_id))
        .filter(or_(
            A.target_type == "COURSE",
            and_(A.target_type == "SECTION", A.target_section == E.section),
            and_(A.target_type == "STUDENT", A.target_student_id == student_id),
        ))
    )


def visible_extra_class(db: Session, class_id: int, student_id: int) -> models.ExtraClass:
    x = db.get(models.ExtraClass, class_id)
    if not x or not enrollment(db, x.course_id, student_id):
        raise HTTPException(status_code=404, detail="Extra class not found")
    return x


def extra_class_conflict(db: Session, course: models.Course, start, end, location, exclude_id=None):
    """Same faculty double-booked, or the same room booked by anyone at overlapping times."""
    X, C = models.ExtraClass, models.Course
    q = db.query(X).join(C).filter(X.status == "SCHEDULED", X.start_at < end, X.end_at > start)
    if exclude_id:
        q = q.filter(X.id != exclude_id)
    mine = q.filter(C.faculty_id == course.faculty_id).first()
    if mine:
        return f"You already have an extra class ({mine.course.code}: {mine.topic}) at {mine.start_at:%H:%M} that day"
    loc = location.strip().lower()
    if loc not in ("online", "virtual"):
        room = q.filter(func.lower(func.trim(X.location)) == loc).first()
        if room:
            return f"{location} is already booked for {room.course.code} from {room.start_at:%H:%M} to {room.end_at:%H:%M}"
    return None
