"""FR3, FR28: administrator management of users, skills, workflow records and reports."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
import models, database, schemas, services, trust_services
from auth import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _counts(db, column):
    return {k: v for k, v in db.query(column, func.count()).group_by(column).all()}


@router.get("/stats")
def stats(db: Session = Depends(database.get_db)):
    avg = db.query(func.avg(models.Feedback.rating)).scalar()
    return {
        "users": db.query(models.User).count(),
        "active_users": db.query(models.User).filter_by(is_active=True).count(),
        "skills": db.query(models.Skill).count(),
        "requests_by_status": _counts(db, models.MentorshipRequest.status),
        "sessions_by_status": _counts(db, models.MentorshipSession.status),
        "reports_by_status": _counts(db, models.Report.status),
        "messages": db.query(models.Message).count(),
        "feedback_count": db.query(models.Feedback).count(),
        "avg_rating": round(float(avg), 2) if avg is not None else None,
        "learning_plans": db.query(models.LearningPlan).count(),
        "faculty": db.query(models.User).filter_by(account_type="FACULTY").count(),
        "faculty_pending": db.query(models.FacultyProfile).filter_by(verified=False).count(),
        "courses": db.query(models.Course).count(),
    }


@router.get("/users")
def list_users(q: str = "", db: Session = Depends(database.get_db)):
    query = db.query(models.User)
    if q:
        query = query.filter(models.User.name.ilike(f"%{q}%") | models.User.email.ilike(f"%{q}%"))
    out = []
    for u in query.order_by(models.User.created_at.desc()).all():
        data = schemas.user_private(u)
        data["avg_rating"], data["rating_count"] = services.rating_stats(db, u.id)
        data["reports_against"] = db.query(models.Report).filter_by(reported_user_id=u.id).count()
        out.append(data)
    return out


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: schemas.AdminUserUpdateIn, admin: models.User = Depends(require_admin), db: Session = Depends(database.get_db)):
    u = db.get(models.User, user_id)
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.id == admin.id and (body.is_active is False or body.is_admin is False):
        raise HTTPException(status_code=400, detail="You cannot deactivate or demote your own account")
    if body.is_active is not None:
        u.is_active = body.is_active
        if not body.is_active:
            # Deactivation closes open mentorships so other users are not left waiting.
            for r in db.query(models.MentorshipRequest).filter(
                (models.MentorshipRequest.learner_id == u.id) | (models.MentorshipRequest.mentor_id == u.id),
                models.MentorshipRequest.status.in_(["PENDING", "ACCEPTED"]),
            ):
                r.status = "CANCELLED"
                for s in r.sessions:
                    if s.status in ("SCHEDULED", "RESCHEDULED"):
                        trust_services.cancel_session_record(db, s, u.id)
                other = r.mentor_id if r.learner_id == u.id else r.learner_id
                services.notify(db, other, "SYSTEM", f"Your {r.skill.name} mentorship with {u.name} was closed by an administrator.", "/requests")
    if body.is_admin is not None:
        u.is_admin = body.is_admin
    db.commit()
    db.refresh(u)
    return schemas.user_private(u)


@router.get("/skills")
def list_skills(db: Session = Depends(database.get_db)):
    usage = dict(db.query(models.UserSkill.skill_id, func.count()).group_by(models.UserSkill.skill_id).all())
    return [{**schemas.skill(s), "usage": usage.get(s.id, 0)} for s in db.query(models.Skill).order_by(models.Skill.name)]


@router.put("/skills/{skill_id}")
def update_skill(skill_id: int, body: schemas.SkillCreateIn, db: Session = Depends(database.get_db)):
    s = db.get(models.Skill, skill_id)
    if not s:
        raise HTTPException(status_code=404, detail="Skill not found")
    clash = db.query(models.Skill).filter(func.lower(models.Skill.name) == body.name.strip().lower(), models.Skill.id != skill_id).first()
    if clash:
        raise HTTPException(status_code=409, detail="Another skill already has this name")
    s.name, s.category, s.description = body.name.strip(), body.category.strip() or "General", body.description
    db.commit()
    return schemas.skill(s)


@router.delete("/skills/{skill_id}", status_code=204)
def delete_skill(skill_id: int, db: Session = Depends(database.get_db)):
    s = db.get(models.Skill, skill_id)
    if not s:
        raise HTTPException(status_code=404, detail="Skill not found")
    in_use = (
        db.query(models.MentorshipRequest).filter_by(skill_id=skill_id).count()
        + db.query(models.LearningPlan).filter_by(skill_id=skill_id).count()
    )
    if in_use:
        raise HTTPException(status_code=400, detail="Skill is referenced by mentorships or learning plans and cannot be deleted")
    db.query(models.UserSkill).filter_by(skill_id=skill_id).delete()
    db.delete(s)
    db.commit()


@router.get("/requests")
def list_requests(db: Session = Depends(database.get_db)):
    return [schemas.request(r) for r in db.query(models.MentorshipRequest).order_by(models.MentorshipRequest.created_at.desc()).limit(200)]


@router.get("/sessions")
def list_sessions(db: Session = Depends(database.get_db)):
    return [schemas.session(s) for s in db.query(models.MentorshipSession).order_by(models.MentorshipSession.start_at.desc()).limit(200)]


@router.get("/reports")
def list_reports(status: Optional[str] = None, db: Session = Depends(database.get_db)):
    q = db.query(models.Report)
    if status:
        q = q.filter_by(status=status)
    return [schemas.report(r) for r in q.order_by(models.Report.created_at.desc())]


@router.patch("/reports/{report_id}")
def update_report(report_id: int, body: schemas.ReportUpdateIn, db: Session = Depends(database.get_db)):
    r = db.get(models.Report, report_id)
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    r.status, r.admin_note = body.status, body.admin_note
    if body.status != "OPEN":
        services.notify(db, r.reporter_id, "REPORT", f"Your report was {body.status.lower()} by an administrator.", "/reports")
    db.commit()
    return schemas.report(r)


# ---------- Academic records ----------

@router.get("/faculty")
def list_faculty(db: Session = Depends(database.get_db)):
    rows = db.query(models.User).filter_by(account_type="FACULTY").order_by(models.User.created_at.desc()).all()
    return [{**schemas.user_brief(u), "email": u.email, "is_active": u.is_active,
             "faculty_profile": schemas.faculty_profile(u.faculty_profile),
             "course_count": db.query(models.Course).filter_by(faculty_id=u.id).count()} for u in rows]


@router.post("/faculty/{user_id}/verify")
def verify_faculty(user_id: int, body: schemas.FacultyVerifyIn, admin: models.User = Depends(require_admin), db: Session = Depends(database.get_db)):
    u = db.get(models.User, user_id)
    if not u or not u.faculty_profile:
        raise HTTPException(status_code=404, detail="Faculty account not found")
    fp = u.faculty_profile
    fp.verified = body.verified
    fp.verified_at, fp.verified_by = (models.utcnow(), admin.id) if body.verified else (None, None)
    services.notify(db, u.id, "SYSTEM",
                    "Your faculty account is verified. You can now create courses." if body.verified
                    else "Your faculty verification was withdrawn by an administrator.", "/")
    db.commit()
    return {**schemas.user_brief(u), "faculty_profile": schemas.faculty_profile(fp)}


@router.get("/courses")
def list_courses(db: Session = Depends(database.get_db)):
    import academic_schemas
    return [academic_schemas.course(c) for c in db.query(models.Course).order_by(models.Course.academic_year.desc(), models.Course.code)]
