"""FR26-FR27: post-session feedback and user reports."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import models, database, schemas, services
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["feedback"])


@router.post("/feedback", status_code=201)
def submit_feedback(body: schemas.FeedbackIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    s = db.get(models.MentorshipSession, body.session_id)
    if not s or user.id not in (s.request.learner_id, s.request.mentor_id):
        raise HTTPException(status_code=404, detail="Session not found")
    if s.status != "COMPLETED":
        raise HTTPException(status_code=400, detail="Feedback can only be given for completed sessions")
    if db.query(models.Feedback).filter_by(session_id=s.id, giver_id=user.id).first():
        raise HTTPException(status_code=409, detail="You have already given feedback for this session")
    receiver_id = s.request.mentor_id if user.id == s.request.learner_id else s.request.learner_id
    f = models.Feedback(session_id=s.id, giver_id=user.id, receiver_id=receiver_id, rating=body.rating, comment=body.comment)
    db.add(f)
    services.notify(db, receiver_id, "FEEDBACK", f"{user.name} rated your {s.request.skill.name} session {body.rating}/5.", f"/users/{receiver_id}")
    db.commit()
    db.refresh(f)
    return schemas.feedback(f, user)


@router.post("/reports", status_code=201)
def submit_report(body: schemas.ReportIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    if body.reported_user_id is not None:
        if body.reported_user_id == user.id:
            raise HTTPException(status_code=400, detail="You cannot report yourself")
        if not db.get(models.User, body.reported_user_id):
            raise HTTPException(status_code=404, detail="Reported user not found")
    r = models.Report(reporter_id=user.id, reported_user_id=body.reported_user_id, reason=body.reason.strip())
    db.add(r)
    for admin in db.query(models.User).filter_by(is_admin=True, is_active=True):
        services.notify(db, admin.id, "REPORT", f"New report submitted by {user.name}.", "/admin")
    db.commit()
    db.refresh(r)
    return schemas.report(r)


@router.get("/reports/mine")
def my_reports(user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    rows = db.query(models.Report).filter_by(reporter_id=user.id).order_by(models.Report.created_at.desc()).all()
    return [schemas.report(r) for r in rows]
