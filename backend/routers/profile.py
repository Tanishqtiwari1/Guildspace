"""FR4-FR9: profile, skills, availability and search."""
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
import models, database, schemas, services
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["profile"])


@router.put("/users/me")
def update_profile(body: schemas.ProfileIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    data = body.model_dump(exclude_unset=True)
    faculty_fields = {k: data.pop(k) for k in ("department", "designation") if k in data}
    for field, value in data.items():
        setattr(user, field, value.strip() if isinstance(value, str) else value)
    if faculty_fields and user.faculty_profile:
        if "department" in faculty_fields and not (faculty_fields["department"] or "").strip():
            raise HTTPException(status_code=422, detail="Department cannot be empty")
        for field, value in faculty_fields.items():
            setattr(user.faculty_profile, field, value.strip() if value else None)
    db.commit()
    db.refresh(user)
    return schemas.user_private(user)


@router.get("/users/{user_id}")
def get_user(user_id: int, db: Session = Depends(database.get_db), _: models.User = Depends(get_current_user)):
    target = db.get(models.User, user_id)
    if not target or not target.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    avg, count = services.rating_stats(db, user_id)
    data = schemas.user_public(target, avg, count)
    recent = (
        db.query(models.Feedback, models.User)
        .join(models.User, models.User.id == models.Feedback.giver_id)
        .filter(models.Feedback.receiver_id == user_id)
        .order_by(models.Feedback.created_at.desc())
        .limit(5)
        .all()
    )
    data["recent_feedback"] = [schemas.feedback(f, giver) for f, giver in recent]
    return data


# ---------- Skill catalogue ----------

@router.get("/skills")
def list_skills(q: str = "", db: Session = Depends(database.get_db)):
    query = db.query(models.Skill)
    if q:
        query = query.filter(models.Skill.name.ilike(f"%{q}%"))
    return [schemas.skill(s) for s in query.order_by(models.Skill.name).all()]


@router.post("/skills", status_code=201)
def create_skill(body: schemas.SkillCreateIn, db: Session = Depends(database.get_db), _: models.User = Depends(get_current_user)):
    name = " ".join(body.name.split())
    existing = db.query(models.Skill).filter(func.lower(models.Skill.name) == name.lower()).first()
    if existing:
        return schemas.skill(existing)
    s = models.Skill(name=name, category=body.category.strip() or "General", description=body.description)
    db.add(s)
    db.commit()
    db.refresh(s)
    return schemas.skill(s)


# ---------- User skills (FR6, FR7) ----------

@router.post("/users/me/skills", status_code=201)
def add_user_skill(body: schemas.UserSkillIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    if not db.get(models.Skill, body.skill_id):
        raise HTTPException(status_code=404, detail="Skill not found")
    dup = db.query(models.UserSkill).filter_by(user_id=user.id, skill_id=body.skill_id, skill_type=body.skill_type).first()
    if dup:
        raise HTTPException(status_code=409, detail="You already listed this skill")
    us = models.UserSkill(user_id=user.id, **body.model_dump())
    db.add(us)
    db.commit()
    db.refresh(us)
    return schemas.user_skill(us)


@router.put("/users/me/skills/{user_skill_id}")
def update_user_skill(user_skill_id: int, body: schemas.UserSkillUpdateIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    us = db.get(models.UserSkill, user_skill_id)
    if not us or us.user_id != user.id:
        raise HTTPException(status_code=404, detail="Skill entry not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(us, field, value)
    db.commit()
    db.refresh(us)
    return schemas.user_skill(us)


@router.delete("/users/me/skills/{user_skill_id}", status_code=204)
def delete_user_skill(user_skill_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    us = db.get(models.UserSkill, user_skill_id)
    if not us or us.user_id != user.id:
        raise HTTPException(status_code=404, detail="Skill entry not found")
    db.delete(us)
    db.commit()


# ---------- Availability (FR5) ----------

@router.post("/users/me/availability", status_code=201)
def add_availability(body: schemas.AvailabilityIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    new_s, new_e = services.to_minutes(body.start_time), services.to_minutes(body.end_time)
    for slot in user.availabilities:
        if slot.day_of_week == body.day_of_week and services.to_minutes(slot.start_time) < new_e and new_s < services.to_minutes(slot.end_time):
            raise HTTPException(status_code=409, detail=f"Overlaps your existing {slot.day_of_week} {slot.start_time}-{slot.end_time} slot")
    a = models.Availability(user_id=user.id, **body.model_dump())
    db.add(a)
    db.commit()
    db.refresh(a)
    return schemas.availability(a)


@router.delete("/users/me/availability/{availability_id}", status_code=204)
def delete_availability(availability_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    a = db.get(models.Availability, availability_id)
    if not a or a.user_id != user.id:
        raise HTTPException(status_code=404, detail="Availability slot not found")
    db.delete(a)
    db.commit()


# ---------- Search (FR9) ----------

@router.get("/search")
def search(
    q: str = "",
    type: Literal["mentor", "learner", "any"] = "any",
    skill_id: Optional[int] = None,
    mode: Optional[Literal["ONLINE", "OFFLINE", "EITHER"]] = None,
    location: str = "",
    user: models.User = Depends(get_current_user),
    db: Session = Depends(database.get_db),
):
    query = db.query(models.User).filter(models.User.is_active.is_(True), models.User.id != user.id)
    skill_type = {"mentor": "OFFERED", "learner": "NEEDED"}.get(type)
    if q or skill_id or skill_type:
        sub = db.query(models.UserSkill.user_id).join(models.Skill)
        if skill_type:
            sub = sub.filter(models.UserSkill.skill_type == skill_type)
        if skill_id:
            sub = sub.filter(models.UserSkill.skill_id == skill_id)
        if q:
            # free text matches a person's name or bio, or one of their skills
            query = query.filter(or_(
                models.User.name.ilike(f"%{q}%"),
                models.User.bio.ilike(f"%{q}%"),
                models.User.id.in_(sub.filter(models.Skill.name.ilike(f"%{q}%"))),
            ))
            if skill_id or skill_type:
                query = query.filter(models.User.id.in_(sub))
        else:
            query = query.filter(models.User.id.in_(sub))
    if mode:
        query = query.filter(models.User.preferred_mode.in_([mode, "EITHER"]) if mode != "EITHER" else True)
    if location:
        query = query.filter(models.User.location.ilike(f"%{location}%"))
    results = []
    for u in query.order_by(models.User.name).limit(50).all():
        avg, count = services.rating_stats(db, u.id)
        results.append(schemas.user_public(u, avg, count))
    return results
