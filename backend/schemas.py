"""Request validation models (Pydantic) and response serializers."""
import json
import datetime
import re
from typing import Literal, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
import models

Role = Literal["LEARNER", "MENTOR", "BOTH"]
Mode = Literal["ONLINE", "OFFLINE", "EITHER"]
Level = Literal["BEGINNER", "INTERMEDIATE", "ADVANCED"]
Day = Literal["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


# ---------- Inputs ----------

class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    role: Role = "BOTH"
    location: Optional[str] = Field(default=None, max_length=80)
    preferred_mode: Mode = "EITHER"
    account_type: Literal["STUDENT", "FACULTY"] = "STUDENT"
    department: Optional[str] = Field(default=None, max_length=80)
    designation: Optional[str] = Field(default=None, max_length=80)
    employee_id: Optional[str] = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def faculty_needs_department(self):
        if self.account_type == "FACULTY" and not (self.department or "").strip():
            raise ValueError("Faculty accounts must include a department")
        return self


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    department: Optional[str] = Field(default=None, max_length=80)
    designation: Optional[str] = Field(default=None, max_length=80)
    bio: Optional[str] = Field(default=None, max_length=1000)
    role: Optional[Role] = None
    location: Optional[str] = Field(default=None, max_length=80)
    preferred_mode: Optional[Mode] = None


class SkillCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    category: str = Field(default="General", max_length=40)
    description: Optional[str] = Field(default=None, max_length=500)


class UserSkillIn(BaseModel):
    skill_id: int
    skill_type: Literal["OFFERED", "NEEDED"]
    level: Level = "BEGINNER"
    goal: Optional[str] = Field(default=None, max_length=500)


class UserSkillUpdateIn(BaseModel):
    level: Optional[Level] = None
    goal: Optional[str] = Field(default=None, max_length=500)


class AvailabilityIn(BaseModel):
    day_of_week: Day
    start_time: str
    end_time: str

    @model_validator(mode="after")
    def check_times(self):
        if not TIME_RE.match(self.start_time) or not TIME_RE.match(self.end_time):
            raise ValueError("Times must be HH:MM (24-hour)")
        if self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        return self


class RequestIn(BaseModel):
    mentor_id: int
    skill_id: int
    message: str = Field(default="", max_length=1000)


class RequestActionIn(BaseModel):
    action: Literal["ACCEPT", "REJECT", "CANCEL", "COMPLETE"]


class SessionIn(BaseModel):
    request_id: int
    start_at: datetime.datetime
    end_at: datetime.datetime
    mode: Literal["ONLINE", "OFFLINE"] = "ONLINE"
    location_or_link: Optional[str] = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def check_range(self):
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        if (self.end_at - self.start_at) > datetime.timedelta(hours=4):
            raise ValueError("A session cannot be longer than 4 hours")
        return self


class RescheduleIn(BaseModel):
    start_at: datetime.datetime
    end_at: datetime.datetime

    @model_validator(mode="after")
    def check_range(self):
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class SessionNotesIn(BaseModel):
    notes: str = Field(max_length=10000)


class MessageIn(BaseModel):
    receiver_id: int
    text: str = Field(min_length=1, max_length=2000)

    @field_validator("text")
    @classmethod
    def strip(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Message cannot be empty")
        return v


class EndorseIn(BaseModel):
    level: Level
    note: Optional[str] = Field(default=None, max_length=500)


class FeedbackIn(BaseModel):
    session_id: int
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = Field(default=None, max_length=1000)


class ReportIn(BaseModel):
    reported_user_id: Optional[int] = None
    reason: str = Field(min_length=5, max_length=2000)


class ReportUpdateIn(BaseModel):
    status: Literal["OPEN", "RESOLVED", "DISMISSED"]
    admin_note: Optional[str] = Field(default=None, max_length=1000)


class FacultyVerifyIn(BaseModel):
    verified: bool


class AdminUserUpdateIn(BaseModel):
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None


class LearningPlanIn(BaseModel):
    skill_id: int
    goal: str = Field(min_length=3, max_length=500)


class LearningPlanUpdateIn(BaseModel):
    content: dict


# ---------- Serializers ----------

def iso(dt):
    return dt.isoformat() if dt else None


def user_public(u: models.User, avg_rating=None, rating_count=0):
    return {
        "id": u.id,
        "name": u.name,
        "account_type": u.account_type,
        "department": u.faculty_profile.department if u.faculty_profile else None,
        "designation": u.faculty_profile.designation if u.faculty_profile else None,
        "role": u.role,
        "bio": u.bio,
        "location": u.location,
        "preferred_mode": u.preferred_mode,
        "avg_rating": avg_rating,
        "rating_count": rating_count,
        "skills": [user_skill(s) for s in u.skills],
        "availability": [availability(a) for a in u.availabilities],
    }


def faculty_profile(fp: Optional[models.FacultyProfile]):
    if fp is None:
        return None
    return {"department": fp.department, "designation": fp.designation, "employee_id": fp.employee_id,
            "verified": fp.verified, "verified_at": iso(fp.verified_at)}


def user_private(u: models.User):
    data = user_public(u)
    data.update({"email": u.email, "is_admin": u.is_admin, "is_active": u.is_active, "created_at": iso(u.created_at),
                 "account_type": u.account_type, "faculty_profile": faculty_profile(u.faculty_profile)})
    return data


def user_brief(u: Optional[models.User]):
    if u is None:
        return None
    return {"id": u.id, "name": u.name, "location": u.location}


def skill(s: models.Skill):
    return {"id": s.id, "name": s.name, "category": s.category, "description": s.description}


def user_skill(us: models.UserSkill):
    return {
        "id": us.id,
        "skill_id": us.skill_id,
        "skill_name": us.skill.name if us.skill else None,
        "category": us.skill.category if us.skill else None,
        "skill_type": us.skill_type,
        "level": us.level,
        "goal": us.goal,
    }


def availability(a: models.Availability):
    return {"id": a.id, "day_of_week": a.day_of_week, "start_time": a.start_time, "end_time": a.end_time}


def request(r: models.MentorshipRequest):
    return {
        "id": r.id,
        "learner": user_brief(r.learner),
        "mentor": user_brief(r.mentor),
        "skill": skill(r.skill) if r.skill else None,
        "status": r.status,
        "message": r.message,
        "compatibility_score": r.compatibility_score,
        "created_at": iso(r.created_at),
        "updated_at": iso(r.updated_at),
        "session_count": len(r.sessions),
    }


def session(s: models.MentorshipSession, feedback_given_by_me=None):
    r = s.request
    return {
        "id": s.id,
        "request_id": s.request_id,
        "learner": user_brief(r.learner),
        "mentor": user_brief(r.mentor),
        "skill": skill(r.skill) if r.skill else None,
        "start_at": iso(s.start_at),
        "end_at": iso(s.end_at),
        "mode": s.mode,
        "location_or_link": s.location_or_link,
        "status": s.status,
        "notes": s.notes,
        "summary": json.loads(s.summary) if s.summary else None,
        "summary_source": s.summary_source,
        "feedback_given": feedback_given_by_me,
    }


def message(m: models.Message):
    return {
        "id": m.id,
        "sender_id": m.sender_id,
        "receiver_id": m.receiver_id,
        "text": m.text,
        "is_read": m.is_read,
        "sent_at": iso(m.sent_at),
    }


def notification(n: models.Notification):
    return {"id": n.id, "kind": n.kind, "text": n.text, "link": n.link, "is_read": n.is_read, "created_at": iso(n.created_at)}


def feedback(f: models.Feedback, giver=None):
    return {
        "id": f.id,
        "session_id": f.session_id,
        "giver": user_brief(giver),
        "rating": f.rating,
        "comment": f.comment,
        "created_at": iso(f.created_at),
    }


def report(r: models.Report):
    return {
        "id": r.id,
        "reporter": user_brief(r.reporter),
        "reported_user": user_brief(r.reported_user),
        "reason": r.reason,
        "status": r.status,
        "admin_note": r.admin_note,
        "created_at": iso(r.created_at),
    }


def learning_plan(p: models.LearningPlan):
    return {
        "id": p.id,
        "skill": skill(p.skill) if p.skill else None,
        "goal": p.goal,
        "content": json.loads(p.content),
        "source": p.source,
        "created_at": iso(p.created_at),
        "updated_at": iso(p.updated_at),
    }
