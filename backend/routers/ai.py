"""FR21-FR22, FR25: AI-assisted learning plans."""
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import models, database, schemas, services, ai_service
from auth import get_current_user

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/status")
def status():
    return {"ai_enabled": ai_service.ai_enabled(), "model": ai_service.MODEL if ai_service.ai_enabled() else None}


@router.post("/learning-plans", status_code=201)
def create_plan(body: schemas.LearningPlanIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    skill = db.get(models.Skill, body.skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    need = next((s for s in user.skills if s.skill_id == skill.id and s.skill_type == "NEEDED"), None)
    # Use the learner's active mentor for this skill, if any, to size the plan around real sessions.
    req = db.query(models.MentorshipRequest).filter(
        models.MentorshipRequest.learner_id == user.id,
        models.MentorshipRequest.skill_id == skill.id,
        models.MentorshipRequest.status == "ACCEPTED",
    ).first()
    mentor = req.mentor if req else None
    mentor_level = next((s.level for s in mentor.skills if s.skill_id == skill.id and s.skill_type == "OFFERED"), None) if mentor else None
    weekly = (
        services.weekly_overlap_minutes(user.availabilities, mentor.availabilities) if mentor
        else sum(services.to_minutes(a.end_time) - services.to_minutes(a.start_time) for a in user.availabilities)
    )
    content, source = ai_service.generate_learning_plan({
        "skill": skill.name,
        "category": skill.category,
        "target_level": need.level if need else "INTERMEDIATE",
        "goal": body.goal.strip(),
        "learner_bio": user.bio,
        "other_skills": [s.skill.name for s in user.skills if s.skill_type == "OFFERED"],
        "weekly_minutes": weekly,
        "mentor_name": mentor.name if mentor else None,
        "mentor_level": mentor_level,
    })
    plan = models.LearningPlan(user_id=user.id, skill_id=skill.id, goal=body.goal.strip(), content=json.dumps(content), source=source)
    db.add(plan)
    if need and not need.goal:
        need.goal = body.goal.strip()
    db.commit()
    db.refresh(plan)
    return schemas.learning_plan(plan)


@router.get("/learning-plans")
def list_plans(user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    plans = db.query(models.LearningPlan).filter_by(user_id=user.id).order_by(models.LearningPlan.created_at.desc()).all()
    return [schemas.learning_plan(p) for p in plans]


@router.put("/learning-plans/{plan_id}")
def update_plan(plan_id: int, body: schemas.LearningPlanUpdateIn, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    """FR22: the learner reviews and edits the generated plan."""
    plan = db.get(models.LearningPlan, plan_id)
    if not plan or plan.user_id != user.id:
        raise HTTPException(status_code=404, detail="Plan not found")
    c = body.content
    if not isinstance(c.get("weeks"), list) or not all(isinstance(w, dict) and "focus" in w for w in c["weeks"]):
        raise HTTPException(status_code=422, detail="Plan content must contain a list of weeks with a focus")
    plan.content = json.dumps(c)
    db.commit()
    db.refresh(plan)
    return schemas.learning_plan(plan)


@router.delete("/learning-plans/{plan_id}", status_code=204)
def delete_plan(plan_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(database.get_db)):
    plan = db.get(models.LearningPlan, plan_id)
    if not plan or plan.user_id != user.id:
        raise HTTPException(status_code=404, detail="Plan not found")
    db.delete(plan)
    db.commit()
