"""Compatibility scoring between a learner and a potential mentor (FR10-FR12).

Every factor is computed from database records; the weights add up to 100.
"""
from services import weekly_overlap_minutes, shared_slots

LEVELS = {"BEGINNER": 1, "INTERMEDIATE": 2, "ADVANCED": 3}

WEIGHTS = {
    "skill": 25,          # mentor offers the skill
    "level": 10,          # mentor's proficiency covers the learner's target level
    "availability": 25,   # weekly overlapping hours
    "mode": 15,           # interaction-mode compatibility
    "location": 10,       # same locality (matters for offline sessions)
    "exchange": 10,       # mentor wants to learn something the learner offers
    "reputation": 5,      # average rating from past sessions
}
FULL_OVERLAP_MINUTES = 180  # 3h/week of shared availability earns the full availability score


def _skill_entry(user, skill_id, skill_type):
    return next((s for s in user.skills if s.skill_id == skill_id and s.skill_type == skill_type), None)


def calculate_compatibility(learner, mentor, skill_id, mentor_rating=None, mentor_reliability=None):
    factors = []

    def add(key, points, text, positive=True):
        factors.append({"factor": key, "points": points, "max": WEIGHTS[key], "text": text, "positive": positive})

    offer = _skill_entry(mentor, skill_id, "OFFERED")
    need = _skill_entry(learner, skill_id, "NEEDED")
    skill_name = offer.skill.name if offer else (need.skill.name if need else "this skill")

    # 1. Skill and level
    if not offer:
        add("skill", 0, f"Does not offer {skill_name}.", False)
        add("level", 0, "No proficiency recorded for this skill.", False)
    else:
        add("skill", WEIGHTS["skill"], f"Offers {skill_name}.")
        mentor_lvl = LEVELS.get(offer.level, 1)
        target_lvl = LEVELS.get(need.level, 1) if need else 1
        if mentor_lvl > target_lvl:
            add("level", WEIGHTS["level"], f"{offer.level.title()} level is above your target ({(need.level if need else 'BEGINNER').title()}).")
        elif mentor_lvl == target_lvl:
            add("level", WEIGHTS["level"] // 2, f"{offer.level.title()} level equals your target level.")
        else:
            add("level", 0, f"{offer.level.title()} level is below your target level.", False)

    # 2. Availability overlap
    overlap = weekly_overlap_minutes(learner.availabilities, mentor.availabilities)
    if not learner.availabilities or not mentor.availabilities:
        who = "You have" if not learner.availabilities else "They have"
        add("availability", 0, f"{who} not set any availability yet.", False)
    elif overlap == 0:
        add("availability", 0, "Your weekly schedules do not overlap.", False)
    else:
        pts = round(WEIGHTS["availability"] * min(overlap, FULL_OVERLAP_MINUTES) / FULL_OVERLAP_MINUTES)
        add("availability", pts, f"{overlap / 60:.1f} h/week of overlapping availability.")

    # 3. Interaction mode
    lm, mm = learner.preferred_mode, mentor.preferred_mode
    if lm == mm:
        add("mode", WEIGHTS["mode"], f"Both prefer {lm.lower()} sessions.")
    elif "EITHER" in (lm, mm):
        add("mode", round(WEIGHTS["mode"] * 0.7), f"Modes are compatible ({lm.lower()} / {mm.lower()}).")
    else:
        add("mode", 0, f"Mode mismatch: you prefer {lm.lower()}, they prefer {mm.lower()}.", False)

    # 4. Location
    if learner.location and mentor.location and learner.location.strip().lower() == mentor.location.strip().lower():
        add("location", WEIGHTS["location"], f"Both located in {mentor.location}.")
    elif lm == "ONLINE" and mm in ("ONLINE", "EITHER"):
        add("location", round(WEIGHTS["location"] * 0.5), "Different locations, but sessions can be online.")
    else:
        add("location", 0, "Different or unspecified locations.", False)

    # 5. Mutual exchange: mentor needs something the learner offers
    learner_offers = {s.skill_id: s.skill.name for s in learner.skills if s.skill_type == "OFFERED"}
    mutual = [learner_offers[s.skill_id] for s in mentor.skills if s.skill_type == "NEEDED" and s.skill_id in learner_offers]
    if mutual:
        add("exchange", WEIGHTS["exchange"], f"Two-way exchange: they want to learn {', '.join(mutual)}, which you offer.")
    else:
        add("exchange", 0, "No two-way skill exchange found.", False)

    # 6. Reputation
    avg, count = mentor_rating if mentor_rating else (None, 0)
    if avg is None:
        add("reputation", 0, "No ratings yet.", False)
    else:
        add("reputation", round(WEIGHTS["reputation"] * avg / 5), f"Rated {avg:.1f}/5 across {count} session(s).")

    # 7. Reliability: a penalty only, so new users are never punished for having no history.
    rel = mentor_reliability
    if rel and rel["score"] is not None:
        from trust_services import reliability_penalty
        pen = reliability_penalty(rel)
        bad = rel["late_cancellations"] + rel["no_shows"]
        if pen:
            text = f"Reliability {rel['score']}%: {bad} late cancellation(s) or no-show(s) in {rel['events']} sessions."
        else:
            text = f"Reliable: kept {rel['kept']} of {rel['events']} tracked sessions ({rel['score']}%)."
        factors.append({"factor": "reliability", "points": pen, "max": 0, "text": text, "positive": pen == 0, "penalty": True})

    score = max(0, sum(f["points"] for f in factors))
    return {
        "mentor_id": mentor.id,
        "mentor_name": mentor.name,
        "mentor_bio": mentor.bio,
        "location": mentor.location,
        "mode": mentor.preferred_mode,
        "skill_id": skill_id,
        "skill_name": skill_name,
        "mentor_level": offer.level if offer else None,
        "avg_rating": avg,
        "reliability": rel["score"] if rel else None,
        "rating_count": count,
        "overlap_minutes": overlap,
        "shared_slots": shared_slots(learner.availabilities, mentor.availabilities),
        "mentor_teaches": [{"skill_id": s.skill_id, "name": s.skill.name, "level": s.level} for s in mentor.skills if s.skill_type == "OFFERED"],
        "mentor_wants": [{"skill_id": s.skill_id, "name": s.skill.name, "level": s.level} for s in mentor.skills if s.skill_type == "NEEDED"],
        "mutual_skills": mutual,
        "compatibility_score": score,
        "factors": factors,
        "match_explanation": [f["text"] for f in factors if f["positive"]],
    }
