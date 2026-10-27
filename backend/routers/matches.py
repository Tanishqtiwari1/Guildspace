"""FR10-FR12: compatibility-ranked matches with explanations."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
import models, database, services, matching, ai_service, trust_services
from auth import get_current_user

router = APIRouter(prefix="/api/matches", tags=["matching"])


def _active_users(db: Session):
    return db.query(models.User).options(
        selectinload(models.User.skills).selectinload(models.UserSkill.skill),
        selectinload(models.User.availabilities),
    ).filter(models.User.is_active.is_(True))


def find_mentors(db: Session, learner: models.User, skill_id: Optional[int] = None, limit: int = 20):
    """Rank mentors for the learner's needed skills (or one specific skill)."""
    needed = [s.skill_id for s in learner.skills if s.skill_type == "NEEDED"]
    skill_ids = [skill_id] if skill_id else needed
    if not skill_ids:
        return []
    mentor_ids = {
        row.user_id
        for row in db.query(models.UserSkill.user_id).filter(
            models.UserSkill.skill_id.in_(skill_ids),
            models.UserSkill.skill_type == "OFFERED",
            models.UserSkill.user_id != learner.id,
        )
    }
    mentors = _active_users(db).filter(models.User.id.in_(mentor_ids), models.User.role.in_(["MENTOR", "BOTH"])).all()
    results = []
    for mentor in mentors:
        rating = services.rating_stats(db, mentor.id)
        rel = trust_services.reliability(db, mentor.id)
        for sid in skill_ids:
            if any(s.skill_id == sid and s.skill_type == "OFFERED" for s in mentor.skills):
                results.append(matching.calculate_compatibility(learner, mentor, sid, rating, rel))
    results.sort(key=lambda m: m["compatibility_score"], reverse=True)
    return results[:limit]


def find_learners(db: Session, mentor: models.User, limit: int = 20):
    """Learners who need a skill this user offers, scored from the learner's side."""
    offered = [s.skill_id for s in mentor.skills if s.skill_type == "OFFERED"]
    if not offered:
        return []
    learner_ids = {
        row.user_id
        for row in db.query(models.UserSkill.user_id).filter(
            models.UserSkill.skill_id.in_(offered),
            models.UserSkill.skill_type == "NEEDED",
            models.UserSkill.user_id != mentor.id,
        )
    }
    rating = services.rating_stats(db, mentor.id)
    rel = trust_services.reliability(db, mentor.id)
    results = []
    for learner in _active_users(db).filter(models.User.id.in_(learner_ids)).all():
        for s in learner.skills:
            if s.skill_type == "NEEDED" and s.skill_id in offered:
                m = matching.calculate_compatibility(learner, mentor, s.skill_id, rating, rel)
                results.append({
                    "learner_id": learner.id,
                    "learner_name": learner.name,
                    "learner_bio": learner.bio,
                    "location": learner.location,
                    "mode": learner.preferred_mode,
                    "skill_id": s.skill_id,
                    "skill_name": m["skill_name"],
                    "target_level": s.level,
                    "goal": s.goal,
                    "compatibility_score": m["compatibility_score"],
                    "factors": m["factors"],
                    "match_explanation": m["match_explanation"],
                })
    results.sort(key=lambda m: m["compatibility_score"], reverse=True)
    return results[:limit]


@router.get("")
def recommended_mentors(skill_id: Optional[int] = None, limit: int = 20, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    return find_mentors(db, user, skill_id, min(limit, 50))


@router.get("/learners")
def recommended_learners(limit: int = 20, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    return find_learners(db, user, min(limit, 50))


@router.get("/{mentor_id}/explain")
def explain(mentor_id: int, skill_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    mentor = db.get(models.User, mentor_id)
    skill = db.get(models.Skill, skill_id)
    if not mentor or not mentor.is_active or not skill:
        raise HTTPException(status_code=404, detail="Mentor or skill not found")
    m = matching.calculate_compatibility(user, mentor, skill_id, services.rating_stats(db, mentor.id), trust_services.reliability(db, mentor.id))
    text, source = ai_service.explain_match({
        "learner": user.name, "mentor": mentor.name, "skill": skill.name,
        "score": m["compatibility_score"], "factors": m["factors"],
    })
    return {**m, "narrative": text, "narrative_source": source}
