"""AI service boundary (FR21-FR25, SRS 2.1).

Uses Claude when ANTHROPIC_API_KEY is set. When the key is missing or the call fails,
each function falls back to a rule-based generator built from the same database
records, and the result is labelled "rule-based" so it is never presented as AI output.
"""
import os
import re
import json
import logging

log = logging.getLogger("ai_service")
MODEL = os.getenv("CLAUDE_MODEL", "claude-opus-5-5")
LEVEL_WEEKS = {"BEGINNER": 4, "INTERMEDIATE": 6, "ADVANCED": 8}

_client = None


def ai_enabled() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def _get_client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic(timeout=90.0, max_retries=2)
    return _client


def _call_json(system: str, prompt: str, schema: dict):
    """Return parsed JSON matching `schema`, or None if AI is unavailable or the call fails."""
    if not ai_enabled():
        return None
    try:
        response = _get_client().beta.messages.create(
            model=MODEL,
            max_tokens=8000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        if response.stop_reason == "refusal":
            log.warning("Claude declined the request; using rule-based fallback")
            return None
        text = "".join(b.text for b in response.content if b.type == "text")
        return json.loads(text)
    except Exception as exc:  # network, auth, rate limit, malformed output: all degrade gracefully (FR24)
        log.warning("AI call failed (%s); using rule-based fallback", exc)
        return None


# ---------- Learning plan ----------

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "overview": {"type": "string"},
        "weeks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "week": {"type": "integer"},
                    "focus": {"type": "string"},
                    "activities": {"type": "array", "items": {"type": "string"}},
                    "milestone": {"type": "string"},
                },
                "required": ["week", "focus", "activities", "milestone"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "overview", "weeks"],
    "additionalProperties": False,
}


def generate_learning_plan(ctx: dict):
    """ctx: skill, category, target_level, goal, learner_bio, other_skills, weekly_minutes, mentor_name, mentor_level."""
    prompt = (
        "Create a week-by-week learning plan for this learner.\n\n"
        f"Skill: {ctx['skill']} (category: {ctx['category']})\n"
        f"Target level: {ctx['target_level']}\n"
        f"Learning goal: {ctx['goal']}\n"
        f"Learner bio: {ctx.get('learner_bio') or 'not provided'}\n"
        f"Skills the learner already has: {', '.join(ctx['other_skills']) or 'none listed'}\n"
        f"Weekly time available: {ctx['weekly_minutes'] / 60:.1f} hours\n"
        + (f"Mentor: {ctx['mentor_name']} ({ctx['mentor_level']} in {ctx['skill']})\n" if ctx.get("mentor_name") else "No mentor assigned yet.\n")
        + f"\nUse about {LEVEL_WEEKS.get(ctx['target_level'], 6)} weeks. Keep activities concrete and sized to the weekly time. "
        "Where a mentor exists, include what to cover in mentor sessions."
    )
    result = _call_json(
        "You design practical, realistic learning plans for a community mentorship platform. "
        "Ground every suggestion in the learner details given; do not promise outcomes.",
        prompt,
        PLAN_SCHEMA,
    )
    if result:
        return result, "ai"
    return _rule_based_plan(ctx), "rule-based"


def _rule_based_plan(ctx):
    skill, goal = ctx["skill"], ctx["goal"]
    n = LEVEL_WEEKS.get(ctx["target_level"], 6)
    hours = ctx["weekly_minutes"] / 60 if ctx["weekly_minutes"] else 2
    mentor = ctx.get("mentor_name")
    phases = [
        ("Foundations of " + skill, ["Set up tools and environment for " + skill, "Study core terminology and basic concepts"], "Can explain the basics of " + skill),
        ("Core concepts", ["Work through structured exercises on the fundamentals", "Note questions to raise with your mentor" if mentor else "Collect questions for the community"], "Completes basic exercises unaided"),
        ("Guided practice", [f"Practise tasks related to: {goal}", "Review mistakes and repeat weak areas"], "Solves typical problems with minimal help"),
        ("Applied project", [f"Start a small project aimed at: {goal}", "Get feedback on the project draft"], "Working first version of the project"),
        ("Deepening", ["Explore intermediate topics in " + skill, "Refactor or extend the project"], "Project extended with new techniques"),
        ("Review and next steps", ["Consolidate notes into a personal reference", "Identify the next goal beyond this plan"], "Goal reviewed: " + goal),
    ]
    weeks = []
    for i in range(n):
        focus, acts, milestone = phases[min(i * len(phases) // n, len(phases) - 1)]
        acts = list(acts)
        if mentor:
            acts.append(f"Mentor session with {mentor}: review progress on '{focus}'")
        weeks.append({"week": i + 1, "focus": focus, "activities": acts, "milestone": milestone})
    return {
        "title": f"{skill}: {goal}",
        "overview": (
            f"A {n}-week plan to reach {ctx['target_level'].lower()} level in {skill}, "
            f"sized for about {hours:.1f} hours per week based on your saved availability."
        ),
        "weeks": weeks,
    }


# ---------- Session summary ----------

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "topics": {"type": "array", "items": {"type": "string"}},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "next_steps": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["topics", "key_points", "next_steps"],
    "additionalProperties": False,
}

NEXT_STEP_WORDS = re.compile(r"\b(next|todo|to do|homework|practice|practise|will|should|need to|plan to|follow[- ]up)\b", re.I)


def summarize_session(ctx: dict):
    """ctx: skill, mentor, learner, date, notes."""
    prompt = (
        f"Summarize this {ctx['skill']} mentorship session between mentor {ctx['mentor']} and learner {ctx['learner']} "
        f"on {ctx['date']}. Use only what is in the notes.\n\nSession notes:\n{ctx['notes']}"
    )
    result = _call_json(
        "You write concise, factual mentorship session summaries: topics discussed, key points, and agreed next steps. "
        "Never invent details that are not in the notes.",
        prompt,
        SUMMARY_SCHEMA,
    )
    if result:
        return result, "ai"
    return _rule_based_summary(ctx["notes"]), "rule-based"


def _rule_based_summary(notes: str):
    parts = [p.strip(" -•*\t") for p in re.split(r"[\n\r]+|(?<=[.!?])\s+", notes) if p.strip(" -•*\t")]
    next_steps = [p for p in parts if NEXT_STEP_WORDS.search(p)]
    rest = [p for p in parts if p not in next_steps]
    topics = [p if len(p) <= 80 else p[:77] + "..." for p in rest[:3]]
    return {"topics": topics, "key_points": rest[3:10] or rest[:3], "next_steps": next_steps[:6]}


# ---------- Match explanation ----------

EXPLAIN_SCHEMA = {
    "type": "object",
    "properties": {"explanation": {"type": "string"}},
    "required": ["explanation"],
    "additionalProperties": False,
}


def explain_match(ctx: dict):
    """ctx: learner, mentor, skill, score, factors (list of {text, points, max})."""
    factor_lines = "\n".join(f"- {f['text']} ({f['points']}/{f['max']} pts)" for f in ctx["factors"])
    prompt = (
        f"Learner {ctx['learner']} is looking for help with {ctx['skill']}. Candidate mentor: {ctx['mentor']}. "
        f"Compatibility score: {ctx['score']}/100.\nScoring factors:\n{factor_lines}\n\n"
        "In 2-3 sentences, explain to the learner why this is or is not a good match and what to keep in mind. "
        "Use only the factors listed."
    )
    result = _call_json("You explain mentor recommendations clearly and honestly.", prompt, EXPLAIN_SCHEMA)
    if result:
        return result["explanation"], "ai"
    strengths = [f["text"] for f in ctx["factors"] if f["points"] > 0]
    gaps = [f["text"] for f in ctx["factors"] if f["points"] == 0]
    text = f"{ctx['mentor']} scores {ctx['score']}/100 for {ctx['skill']}."
    if strengths:
        text += " Strengths: " + " ".join(strengths)
    if gaps:
        text += " Keep in mind: " + " ".join(gaps)
    return text, "rule-based"
