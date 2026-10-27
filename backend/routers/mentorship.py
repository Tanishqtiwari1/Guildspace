"""FR13-FR18: mentorship requests and session scheduling."""
import json
import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session
import models, database, schemas, services, matching, ai_service, trust_services
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["mentorship"])


def _now():
    return datetime.datetime.now()


def _fmt(dt):
    return dt.strftime("%a %d %b, %H:%M")


# ---------- Requests ----------

@router.post("/requests", status_code=201)
def create_request(body: schemas.RequestIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    if body.mentor_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot send a mentorship request to yourself")
    mentor = db.get(models.User, body.mentor_id)
    skill = db.get(models.Skill, body.skill_id)
    if not mentor or not mentor.is_active:
        raise HTTPException(status_code=404, detail="Mentor not found")
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    if not any(s.skill_id == skill.id and s.skill_type == "OFFERED" for s in mentor.skills):
        raise HTTPException(status_code=400, detail=f"{mentor.name} does not offer {skill.name}")
    open_req = db.query(models.MentorshipRequest).filter(
        models.MentorshipRequest.learner_id == user.id,
        models.MentorshipRequest.mentor_id == mentor.id,
        models.MentorshipRequest.skill_id == skill.id,
        models.MentorshipRequest.status.in_(["PENDING", "ACCEPTED"]),
    ).first()
    if open_req:
        raise HTTPException(status_code=409, detail=f"You already have a {open_req.status.lower()} request with {mentor.name} for {skill.name}")
    score = matching.calculate_compatibility(user, mentor, skill.id, services.rating_stats(db, mentor.id),
                                             trust_services.reliability(db, mentor.id))["compatibility_score"]
    req = models.MentorshipRequest(learner_id=user.id, mentor_id=mentor.id, skill_id=skill.id, message=body.message.strip(), compatibility_score=score)
    db.add(req)
    db.flush()
    services.notify(db, mentor.id, "REQUEST", f"{user.name} requested mentorship in {skill.name}.", "/requests")
    db.commit()
    db.refresh(req)
    return schemas.request(req)


@router.get("/requests")
def list_requests(box: Literal["incoming", "outgoing", "all"] = "all", user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    q = db.query(models.MentorshipRequest)
    if box == "incoming":
        q = q.filter(models.MentorshipRequest.mentor_id == user.id)
    elif box == "outgoing":
        q = q.filter(models.MentorshipRequest.learner_id == user.id)
    else:
        q = q.filter(or_(models.MentorshipRequest.mentor_id == user.id, models.MentorshipRequest.learner_id == user.id))
    return [schemas.request(r) for r in q.order_by(models.MentorshipRequest.created_at.desc()).all()]


@router.patch("/requests/{request_id}")
def update_request(request_id: int, body: schemas.RequestActionIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    req = db.get(models.MentorshipRequest, request_id)
    if not req or user.id not in (req.learner_id, req.mentor_id):
        raise HTTPException(status_code=404, detail="Request not found")
    is_mentor = user.id == req.mentor_id
    other_id = req.learner_id if is_mentor else req.mentor_id
    skill = req.skill.name

    if body.action in ("ACCEPT", "REJECT"):
        if not is_mentor:
            raise HTTPException(status_code=403, detail="Only the mentor can accept or reject this request")
        if req.status != "PENDING":
            raise HTTPException(status_code=400, detail=f"Request is already {req.status.lower()}")
        req.status = "ACCEPTED" if body.action == "ACCEPT" else "REJECTED"
        verb = "accepted" if body.action == "ACCEPT" else "declined"
        services.notify(db, other_id, "REQUEST", f"{user.name} {verb} your {skill} mentorship request.", "/requests")
    elif body.action == "CANCEL":
        if req.status not in ("PENDING", "ACCEPTED"):
            raise HTTPException(status_code=400, detail=f"Cannot cancel a {req.status.lower()} request")
        req.status = "CANCELLED"
        for s in req.sessions:
            if s.status in ("SCHEDULED", "RESCHEDULED"):
                trust_services.cancel_session_record(db, s, user.id)
        services.notify(db, other_id, "REQUEST", f"{user.name} cancelled the {skill} mentorship.", "/requests")
    elif body.action == "COMPLETE":
        if req.status != "ACCEPTED":
            raise HTTPException(status_code=400, detail="Only an accepted mentorship can be marked completed")
        if any(s.status in ("SCHEDULED", "RESCHEDULED") for s in req.sessions):
            raise HTTPException(status_code=400, detail="Complete or cancel the remaining scheduled sessions first")
        req.status = "COMPLETED"
        services.notify(db, other_id, "REQUEST", f"{user.name} marked the {skill} mentorship as completed.", "/requests")
    db.commit()
    db.refresh(req)
    return schemas.request(req)


# ---------- Sessions ----------

def _check_slot(db, req, start, end, exclude_session_id=None):
    if start <= _now():
        raise HTTPException(status_code=400, detail="Sessions must be scheduled in the future")
    for person in (req.learner, req.mentor):
        if not services.within_availability(person, start, end):
            raise HTTPException(
                status_code=409,
                detail=f"{start.strftime('%A')} {start:%H:%M}-{end:%H:%M} is outside {person.name}'s saved availability",
            )
    clash = services.conflicting_session(db, [req.learner_id, req.mentor_id], start, end, exclude_session_id)
    if clash:
        raise HTTPException(status_code=409, detail=f"Conflicts with another session at {_fmt(clash.start_at)}")


def _session_out(db, s, user_id):
    given = db.query(models.Feedback).filter_by(session_id=s.id, giver_id=user_id).first() is not None
    data = schemas.session(s, given)
    is_mentor = user_id == s.request.mentor_id
    data.update({
        "hours": trust_services.session_hours(s),
        "credits_held": trust_services.held_for_session(db, s),
        "learner_confirmed": s.learner_confirmed_at is not None,
        "mentor_confirmed": s.mentor_confirmed_at is not None,
        "i_confirmed": (s.mentor_confirmed_at if is_mentor else s.learner_confirmed_at) is not None,
        "cancelled_by_me": s.cancelled_by == user_id,
        "late_cancellation": s.status == "CANCELLED" and trust_services.is_late_cancel(s),
        "no_show_user_id": s.no_show_user_id,
        "endorsed": db.query(models.Endorsement).filter_by(session_id=s.id).first() is not None,
    })
    return data


def _get_session(db, session_id, user):
    s = db.get(models.MentorshipSession, session_id)
    if not s or user.id not in (s.request.learner_id, s.request.mentor_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return s


@router.post("/sessions", status_code=201)
def create_session(body: schemas.SessionIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    req = db.get(models.MentorshipRequest, body.request_id)
    if not req or user.id not in (req.learner_id, req.mentor_id):
        raise HTTPException(status_code=404, detail="Request not found")
    if req.status != "ACCEPTED":
        raise HTTPException(status_code=400, detail="Sessions can only be scheduled for accepted mentorships")
    start, end = body.start_at.replace(tzinfo=None), body.end_at.replace(tzinfo=None)
    _check_slot(db, req, start, end)
    s = models.MentorshipSession(request_id=req.id, start_at=start, end_at=end, mode=body.mode, location_or_link=body.location_or_link)
    db.add(s)
    db.flush()
    trust_services.hold(db, s)  # learner's credits go into escrow; raises 402 if they don't have enough
    other = req.learner_id if user.id == req.mentor_id else req.mentor_id
    services.notify(db, other, "SESSION", f"{user.name} scheduled a {req.skill.name} session for {_fmt(start)}.", "/sessions")
    db.commit()
    db.refresh(s)
    return _session_out(db, s, user.id)


@router.get("/sessions")
def list_sessions(scope: Literal["upcoming", "past", "all"] = "all", user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    q = db.query(models.MentorshipSession).join(models.MentorshipRequest).filter(
        or_(models.MentorshipRequest.learner_id == user.id, models.MentorshipRequest.mentor_id == user.id)
    )
    if scope == "upcoming":
        q = q.filter(models.MentorshipSession.status.in_(["SCHEDULED", "RESCHEDULED"])).order_by(models.MentorshipSession.start_at)
    elif scope == "past":
        q = q.filter(models.MentorshipSession.status.in_(["COMPLETED", "CANCELLED", "NO_SHOW"])).order_by(models.MentorshipSession.start_at.desc())
    else:
        q = q.order_by(models.MentorshipSession.start_at.desc())
    return [_session_out(db, s, user.id) for s in q.all()]


@router.patch("/sessions/{session_id}/reschedule")
def reschedule(session_id: int, body: schemas.RescheduleIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    s = _get_session(db, session_id, user)
    if s.status not in ("SCHEDULED", "RESCHEDULED"):
        raise HTTPException(status_code=400, detail=f"Cannot reschedule a {s.status.lower()} session")
    start, end = body.start_at.replace(tzinfo=None), body.end_at.replace(tzinfo=None)
    _check_slot(db, s.request, start, end, exclude_session_id=s.id)
    s.start_at, s.end_at, s.status = start, end, "RESCHEDULED"
    s.learner_confirmed_at = s.mentor_confirmed_at = None
    trust_services.adjust_hold(db, s)
    other = s.request.learner_id if user.id == s.request.mentor_id else s.request.mentor_id
    services.notify(db, other, "SESSION", f"{user.name} moved the {s.request.skill.name} session to {_fmt(start)}.", "/sessions")
    db.commit()
    return _session_out(db, s, user.id)


@router.post("/sessions/{session_id}/cancel")
def cancel_session(session_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    s = _get_session(db, session_id, user)
    if s.status not in ("SCHEDULED", "RESCHEDULED"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel a {s.status.lower()} session")
    late = trust_services.cancel_session_record(db, s, user.id)
    other = s.request.learner_id if user.id == s.request.mentor_id else s.request.mentor_id
    services.notify(db, other, "SESSION", f"{user.name} cancelled the {s.request.skill.name} session on {_fmt(s.start_at)}"
                    + (" (less than 24 h notice)." if late else ".") + " Held credits were refunded.", "/sessions")
    db.commit()
    return _session_out(db, s, user.id)


@router.post("/sessions/{session_id}/complete")
def complete_session(session_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    """Each participant confirms the session happened. It completes, and credits move, only when both have."""
    s = _get_session(db, session_id, user)
    if s.status not in ("SCHEDULED", "RESCHEDULED"):
        raise HTTPException(status_code=400, detail=f"Cannot complete a {s.status.lower()} session")
    if s.start_at.date() > _now().date():
        raise HTTPException(status_code=400, detail="A session can only be marked completed on or after its scheduled day")
    is_mentor = user.id == s.request.mentor_id
    if (s.mentor_confirmed_at if is_mentor else s.learner_confirmed_at):
        raise HTTPException(status_code=400, detail="You already confirmed this session; waiting for the other person")
    if is_mentor:
        s.mentor_confirmed_at = _now()
    else:
        s.learner_confirmed_at = _now()
    other = s.request.learner_id if is_mentor else s.request.mentor_id
    skill = s.request.skill.name
    if s.mentor_confirmed_at and s.learner_confirmed_at:
        s.status = "COMPLETED"
        trust_services.settle(db, s)
        hrs = trust_services.session_hours(s)
        services.notify(db, s.request.mentor_id, "FEEDBACK", f"{skill} session confirmed by both. You earned {hrs:g} credit(s).", "/sessions")
        services.notify(db, s.request.learner_id, "FEEDBACK", f"{skill} session confirmed by both. Leave feedback for {s.request.mentor.name}.", "/sessions")
    else:
        services.notify(db, other, "SESSION", f"{user.name} confirmed the {skill} session took place. Please confirm too.", "/sessions")
    db.commit()
    return _session_out(db, s, user.id)


@router.post("/sessions/{session_id}/no-show")
def report_no_show(session_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    """Report that the OTHER participant did not attend. Lowers their reliability score."""
    s = _get_session(db, session_id, user)
    if s.status not in ("SCHEDULED", "RESCHEDULED"):
        raise HTTPException(status_code=400, detail=f"Cannot report a no-show for a {s.status.lower()} session")
    if s.end_at > _now():
        raise HTTPException(status_code=400, detail="You can report a no-show only after the session's end time")
    is_mentor = user.id == s.request.mentor_id
    other_id = s.request.learner_id if is_mentor else s.request.mentor_id
    if (s.learner_confirmed_at if is_mentor else s.mentor_confirmed_at):
        raise HTTPException(status_code=409, detail="The other person confirmed this session took place. Contact an admin if that is wrong.")
    s.status, s.no_show_user_id = "NO_SHOW", other_id
    if is_mentor:
        trust_services.settle(db, s, note="Learner did not attend")  # mentor kept the slot free
    else:
        trust_services.refund(db, s, note="Mentor did not attend")
    services.notify(db, other_id, "SESSION", f"{user.name} reported that you missed the {s.request.skill.name} session on {_fmt(s.start_at)}.", "/sessions")
    db.commit()
    return _session_out(db, s, user.id)


@router.post("/sessions/{session_id}/endorse", status_code=201)
def endorse(session_id: int, body: schemas.EndorseIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    """The mentor vouches for the level the learner reached in this skill."""
    s = _get_session(db, session_id, user)
    if user.id != s.request.mentor_id:
        raise HTTPException(status_code=403, detail="Only the mentor can endorse the learner")
    if s.status != "COMPLETED":
        raise HTTPException(status_code=400, detail="Endorsements are for sessions both people confirmed")
    if db.query(models.Endorsement).filter_by(session_id=s.id, endorser_id=user.id).first():
        raise HTTPException(status_code=409, detail="You already endorsed this session")
    e = models.Endorsement(session_id=s.id, endorser_id=user.id, user_id=s.request.learner_id, skill_id=s.request.skill_id,
                           level=body.level, note=body.note)
    db.add(e)
    services.notify(db, s.request.learner_id, "FEEDBACK", f"{user.name} endorsed your {s.request.skill.name} at {body.level.lower()} level.", f"/record/{s.request.learner_id}")
    db.commit()
    return _session_out(db, s, user.id)


@router.put("/sessions/{session_id}/notes")
def save_notes(session_id: int, body: schemas.SessionNotesIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    s = _get_session(db, session_id, user)
    s.notes = body.notes
    db.commit()
    return _session_out(db, s, user.id)


@router.post("/sessions/{session_id}/summary")
def summarize(session_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    """FR23: generate a session summary from the participants' notes."""
    s = _get_session(db, session_id, user)
    if s.status != "COMPLETED":
        raise HTTPException(status_code=400, detail="Summaries are generated for completed sessions")
    if not s.notes or len(s.notes.strip()) < 20:
        raise HTTPException(status_code=400, detail="Add session notes (at least a couple of sentences) before generating a summary")
    summary, source = ai_service.summarize_session({
        "skill": s.request.skill.name, "mentor": s.request.mentor.name, "learner": s.request.learner.name,
        "date": s.start_at.strftime("%d %b %Y"), "notes": s.notes,
    })
    s.summary, s.summary_source = json.dumps(summary), source
    db.commit()
    return _session_out(db, s, user.id)
