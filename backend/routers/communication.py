"""FR19-FR20: messaging and notifications."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session
import models, database, schemas, services
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["communication"])


@router.get("/messages/conversations")
def conversations(user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    """Everyone the user has an accepted/completed mentorship with, plus anyone they have messaged
    (including faculty-student conversations)."""
    reqs = db.query(models.MentorshipRequest).filter(
        models.MentorshipRequest.status.in_(["ACCEPTED", "COMPLETED"]),
        or_(models.MentorshipRequest.learner_id == user.id, models.MentorshipRequest.mentor_id == user.id),
    ).all()
    contact_ids = {r.mentor_id if r.learner_id == user.id else r.learner_id for r in reqs}
    for s, r in db.query(models.Message.sender_id, models.Message.receiver_id).filter(
        or_(models.Message.sender_id == user.id, models.Message.receiver_id == user.id)
    ).distinct():
        contact_ids.add(r if s == user.id else s)
    out = []
    for cid in contact_ids:
        contact = db.get(models.User, cid)
        thread = db.query(models.Message).filter(or_(
            and_(models.Message.sender_id == user.id, models.Message.receiver_id == cid),
            and_(models.Message.sender_id == cid, models.Message.receiver_id == user.id),
        ))
        last = thread.order_by(models.Message.sent_at.desc()).first()
        unread = thread.filter(models.Message.receiver_id == user.id, models.Message.is_read.is_(False)).count()
        out.append({"user": schemas.user_brief(contact), "last_message": schemas.message(last) if last else None, "unread": unread})
    out.sort(key=lambda c: c["last_message"]["sent_at"] if c["last_message"] else "", reverse=True)
    return out


@router.get("/messages/{other_id}")
def thread(other_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    if not services.are_connected(db, user.id, other_id):
        raise HTTPException(status_code=403, detail="You can message a user once a mentorship between you is accepted, or if you share a course")
    msgs = db.query(models.Message).filter(or_(
        and_(models.Message.sender_id == user.id, models.Message.receiver_id == other_id),
        and_(models.Message.sender_id == other_id, models.Message.receiver_id == user.id),
    )).order_by(models.Message.sent_at).all()
    for m in msgs:
        if m.receiver_id == user.id and not m.is_read:
            m.is_read = True
    db.commit()
    return [schemas.message(m) for m in msgs]


@router.post("/messages", status_code=201)
def send_message(body: schemas.MessageIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    if body.receiver_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot message yourself")
    if not services.are_connected(db, user.id, body.receiver_id):
        raise HTTPException(status_code=403, detail="You can message a user once a mentorship between you is accepted, or if you share a course")
    m = models.Message(sender_id=user.id, receiver_id=body.receiver_id, text=body.text)
    db.add(m)
    # One unread message notification per sender is enough; don't flood the list.
    existing = db.query(models.Notification).filter_by(
        user_id=body.receiver_id, kind="MESSAGE", is_read=False, link=f"/messages/{user.id}"
    ).first()
    if not existing:
        label = f"Message from your faculty {user.name}" if user.is_faculty else f"New message from {user.name}"
        services.notify(db, body.receiver_id, "MESSAGE", f"{label}.", f"/messages/{user.id}")
    db.commit()
    db.refresh(m)
    return schemas.message(m)


@router.get("/notifications")
def list_notifications(unread_only: bool = False, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    q = db.query(models.Notification).filter(models.Notification.user_id == user.id)
    if unread_only:
        q = q.filter(models.Notification.is_read.is_(False))
    return [schemas.notification(n) for n in q.order_by(models.Notification.created_at.desc(), models.Notification.id.desc()).limit(100).all()]


@router.post("/notifications/{notification_id}/read")
def mark_read(notification_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    n = db.get(models.Notification, notification_id)
    if not n or n.user_id != user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.is_read = True
    db.commit()
    return schemas.notification(n)


@router.post("/notifications/read-all")
def mark_all_read(user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    db.query(models.Notification).filter_by(user_id=user.id, is_read=False).update({"is_read": True})
    db.commit()
    return {"ok": True}
