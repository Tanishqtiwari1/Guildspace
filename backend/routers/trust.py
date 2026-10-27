"""Time-credit ledger and verified learning records."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session
import models, database, schemas, services, trust_services
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api", tags=["trust"])


@router.get("/credits")
def my_credits(user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    trust_services.ensure_starter(db, user.id)
    db.commit()
    txns = (db.query(models.CreditTransaction).filter_by(user_id=user.id)
            .order_by(models.CreditTransaction.created_at.desc(), models.CreditTransaction.id.desc()).all())
    # Credits on hold for upcoming sessions, so the user can see what they've committed.
    R, S = models.MentorshipRequest, models.MentorshipSession
    upcoming = db.query(S).join(R).filter(R.learner_id == user.id, S.status.in_(["SCHEDULED", "RESCHEDULED"])).all()
    held = round(sum(trust_services.held_for_session(db, s) for s in upcoming), 2)

    def row(t):
        s = t.session
        return {
            "id": t.id, "amount": t.amount, "kind": t.kind, "note": t.note, "created_at": schemas.iso(t.created_at),
            "session": None if not s else {
                "id": s.id, "skill": s.request.skill.name, "start_at": schemas.iso(s.start_at),
                "with": (s.request.learner if s.request.mentor_id == user.id else s.request.mentor).name,
            },
        }
    return {
        "balance": trust_services.balance(db, user.id),
        "held": held,
        "earned_total": round(sum(t.amount for t in txns if t.kind == "EARNED"), 2),
        "spent_total": round(-sum(t.amount for t in txns if t.kind in ("HOLD", "REFUND")), 2) - held,
        "transactions": [row(t) for t in txns],
    }


class AdjustIn(BaseModel):
    amount: float = Field(ge=-50, le=50)
    note: str = Field(min_length=3, max_length=200)


@router.post("/admin/credits/{user_id}", status_code=201)
def admin_adjust(user_id: int, body: AdjustIn, admin: models.User = Depends(require_admin), db: Session = Depends(database.get_db)):
    u = db.get(models.User, user_id)
    if not u or u.account_type != "STUDENT":
        raise HTTPException(status_code=404, detail="Student not found")
    if body.amount == 0:
        raise HTTPException(status_code=400, detail="Amount cannot be zero")
    db.add(models.CreditTransaction(user_id=u.id, amount=body.amount, kind="ADJUST", note=f"{body.note} (by {admin.name})"))
    services.notify(db, u.id, "SYSTEM", f"An administrator adjusted your credits by {body.amount:+g}: {body.note}", "/credits")
    db.commit()
    return {"balance": trust_services.balance(db, u.id)}


@router.get("/users/{user_id}/record")
def learning_record(user_id: int, _: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    """A shareable record built only from sessions BOTH people confirmed, plus mentor endorsements.
    It never includes academic marks."""
    u = db.get(models.User, user_id)
    if not u or not u.is_active or u.account_type != "STUDENT":
        raise HTTPException(status_code=404, detail="Learning record not found")
    R, S = models.MentorshipRequest, models.MentorshipSession
    done = (db.query(S).join(R).filter(or_(R.learner_id == u.id, R.mentor_id == u.id), S.status == "COMPLETED")
            .order_by(S.start_at.desc()).all())
    by_skill = {}
    for s in done:
        role = "taught" if s.request.mentor_id == u.id else "learned"
        b = by_skill.setdefault((s.request.skill.name, role), {"skill": s.request.skill.name, "role": role, "sessions": 0, "hours": 0.0, "partners": set()})
        b["sessions"] += 1
        b["hours"] = round(b["hours"] + trust_services.session_hours(s), 2)
        b["partners"].add((s.request.learner if role == "taught" else s.request.mentor).name)
    endorsements = db.query(models.Endorsement).filter_by(user_id=u.id).order_by(models.Endorsement.created_at.desc()).all()
    avg, count = services.rating_stats(db, u.id)
    return {
        "user": {"id": u.id, "name": u.name, "location": u.location, "member_since": schemas.iso(u.created_at)},
        "hours_taught": round(sum(b["hours"] for b in by_skill.values() if b["role"] == "taught"), 2),
        "hours_learned": round(sum(b["hours"] for b in by_skill.values() if b["role"] == "learned"), 2),
        "sessions_completed": len(done),
        "rating": {"avg": avg, "count": count},
        "reliability": trust_services.reliability(db, u.id),
        "skills": [{**b, "partners": sorted(b["partners"])} for b in sorted(by_skill.values(), key=lambda b: -b["hours"])],
        "endorsements": [{
            "id": e.id, "skill": e.skill.name, "level": e.level, "note": e.note,
            "endorser": schemas.user_brief(e.endorser), "created_at": schemas.iso(e.created_at),
        } for e in endorsements],
        "verification": "Every entry comes from a session that both participants confirmed on Guildspace.",
    }
