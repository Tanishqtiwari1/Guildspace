"""FR29: personalized dashboard, assembled entirely from the current user's records."""
import datetime
from fastapi import APIRouter, Depends
from sqlalchemy import or_
from sqlalchemy.orm import Session
import models, database, schemas, services, trust_services
from auth import get_current_user
from routers.matches import find_mentors, find_learners

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def dashboard(user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    trust_services.ensure_starter(db, user.id)
    db.commit()
    R, S = models.MentorshipRequest, models.MentorshipSession
    mine = or_(R.learner_id == user.id, R.mentor_id == user.id)

    # Profile completeness drives the "next steps" checklist on the dashboard.
    checks = {
        "Add a short bio": bool(user.bio),
        "Set your location": bool(user.location),
        "Add a skill you can teach or want to learn": bool(user.skills),
        "Set your weekly availability": bool(user.availabilities),
    }

    sessions = db.query(S).join(R).filter(mine).all()
    completed = [s for s in sessions if s.status == "COMPLETED"]
    hours = lambda rows: round(sum((s.end_at - s.start_at).total_seconds() for s in rows) / 3600, 1)
    upcoming = sorted((s for s in sessions if s.status in ("SCHEDULED", "RESCHEDULED")), key=lambda s: s.start_at)

    avg, count = services.rating_stats(db, user.id)
    unread_msgs = db.query(models.Message).filter_by(receiver_id=user.id, is_read=False).count()
    latest_plan = db.query(models.LearningPlan).filter_by(user_id=user.id).order_by(models.LearningPlan.created_at.desc()).first()
    incoming = db.query(R).filter(R.mentor_id == user.id, R.status == "PENDING").order_by(R.created_at.desc()).all()
    notifications = db.query(models.Notification).filter_by(user_id=user.id).order_by(models.Notification.created_at.desc(), models.Notification.id.desc()).limit(6).all()

    return {
        "user": schemas.user_private(user),
        "profile_completion": {
            "percent": round(100 * sum(checks.values()) / len(checks)),
            "missing": [label for label, done in checks.items() if not done],
        },
        "stats": {
            "pending_incoming": len(incoming),
            "pending_outgoing": db.query(R).filter(R.learner_id == user.id, R.status == "PENDING").count(),
            "active_mentorships": db.query(R).filter(mine, R.status == "ACCEPTED").count(),
            "upcoming_sessions": len(upcoming),
            "completed_sessions": len(completed),
            "hours_learning": hours([s for s in completed if s.request.learner_id == user.id]),
            "hours_mentoring": hours([s for s in completed if s.request.mentor_id == user.id]),
            "avg_rating": avg,
            "rating_count": count,
            "unread_messages": unread_msgs,
            "credits": trust_services.balance(db, user.id),
            "reliability": trust_services.reliability(db, user.id),
            "awaiting_my_confirmation": sum(1 for s in sessions if s.status in ("SCHEDULED", "RESCHEDULED") and s.start_at.date() <= datetime.date.today()
                                            and not (s.mentor_confirmed_at if s.request.mentor_id == user.id else s.learner_confirmed_at)),
            "unread_notifications": db.query(models.Notification).filter_by(user_id=user.id, is_read=False).count(),
        },
        "top_mentor_matches": find_mentors(db, user, limit=3),
        "top_learner_matches": find_learners(db, user, limit=3) if user.role in ("MENTOR", "BOTH") else [],
        "incoming_requests": [schemas.request(r) for r in incoming[:5]],
        "upcoming_sessions": [schemas.session(s) for s in upcoming[:5]],
        "recent_activity": [schemas.notification(n) for n in notifications],
        "latest_plan": schemas.learning_plan(latest_plan) if latest_plan else None,
    }
