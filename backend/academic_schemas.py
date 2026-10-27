"""Validation models and serializers for the faculty & academic module."""
import datetime
import re
from typing import Literal, Optional, List
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
import models
from schemas import iso, user_brief

YEAR_RE = re.compile(r"^\d{4}-\d{2}$")


# ---------- Inputs ----------

class CourseIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=2, max_length=20)
    semester: int = Field(ge=1, le=12)
    section: str = Field(min_length=1, max_length=10)
    academic_year: str
    description: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("code", "section")
    @classmethod
    def upper(cls, v):
        return v.strip().upper()

    @field_validator("academic_year")
    @classmethod
    def year(cls, v):
        v = v.strip()
        if not YEAR_RE.match(v) or v[5:7] != f"{(int(v[2:4]) + 1) % 100:02d}":
            raise ValueError("Academic year must look like 2026-27")
        return v


class CourseUpdateIn(CourseIn):
    is_active: bool = True


class EnrollStudentIn(BaseModel):
    email: EmailStr
    section: Optional[str] = Field(default=None, max_length=10)


class JoinCourseIn(BaseModel):
    join_code: str = Field(min_length=4, max_length=12)


class ExtraClassIn(BaseModel):
    course_id: int
    topic: str = Field(min_length=2, max_length=150)
    start_at: datetime.datetime
    end_at: datetime.datetime
    location: str = Field(min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=2000)
    meeting_link: Optional[str] = Field(default=None, max_length=300)

    @field_validator("meeting_link")
    @classmethod
    def link(cls, v):
        if v and not v.strip().lower().startswith(("http://", "https://")):
            raise ValueError("Meeting link must start with http:// or https://")
        return v.strip() if v else None

    @model_validator(mode="after")
    def check_range(self):
        self.start_at, self.end_at = self.start_at.replace(tzinfo=None), self.end_at.replace(tzinfo=None)
        if self.end_at <= self.start_at:
            raise ValueError("End time must be after start time")
        if self.start_at.date() != self.end_at.date():
            raise ValueError("An extra class must start and end on the same day")
        if self.end_at - self.start_at > datetime.timedelta(hours=6):
            raise ValueError("An extra class cannot be longer than 6 hours")
        return self


class CancelIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class AnnouncementIn(BaseModel):
    course_id: int
    target_type: Literal["COURSE", "SECTION", "STUDENT"] = "COURSE"
    target_section: Optional[str] = Field(default=None, max_length=10)
    target_student_id: Optional[int] = None
    category: Literal["GENERAL", "EXTRA_CLASS", "ASSIGNMENT", "EXAM", "NOTICE"] = "GENERAL"
    title: str = Field(min_length=3, max_length=150)
    body: str = Field(min_length=3, max_length=5000)
    is_important: bool = False

    @model_validator(mode="after")
    def check_target(self):
        if self.target_type == "SECTION" and not self.target_section:
            raise ValueError("Choose a section")
        if self.target_type == "STUDENT" and not self.target_student_id:
            raise ValueError("Choose a student")
        if self.target_section:
            self.target_section = self.target_section.strip().upper()
        return self


class AssessmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    max_marks: float = Field(gt=0, le=1000)
    assessment_date: Optional[datetime.date] = None


class MarkEntryIn(BaseModel):
    student_id: int
    marks_obtained: Optional[float] = Field(default=None, ge=0)
    remarks: Optional[str] = Field(default=None, max_length=500)


class MarksSaveIn(BaseModel):
    entries: List[MarkEntryIn] = Field(max_length=500)
    revise: bool = False  # must be true to change a mark that is already published


class PublishIn(BaseModel):
    student_ids: Optional[List[int]] = None  # None = every student with a mark entered


# ---------- Serializers ----------

def course(c: models.Course, include_join_code=False):
    data = {
        "id": c.id,
        "name": c.name,
        "code": c.code,
        "semester": c.semester,
        "section": c.section,
        "academic_year": c.academic_year,
        "description": c.description,
        "is_active": c.is_active,
        "faculty": user_brief(c.faculty),
        "faculty_department": c.faculty.faculty_profile.department if c.faculty and c.faculty.faculty_profile else None,
        "student_count": len(c.enrollments),
        "sections": sorted({e.section for e in c.enrollments} | {c.section}),
    }
    if include_join_code:  # only the course's faculty sees the code students use to join
        data["join_code"] = c.join_code
    return data


def enrollment(e: models.CourseEnrollment):
    return {"student": {"id": e.student.id, "name": e.student.name, "email": e.student.email},
            "section": e.section, "enrolled_at": iso(e.enrolled_at)}


def extra_class(x: models.ExtraClass, student_id=None, faculty_view=False):
    data = {
        "id": x.id,
        "course": {"id": x.course.id, "name": x.course.name, "code": x.course.code, "section": x.course.section},
        "faculty": user_brief(x.course.faculty),
        "topic": x.topic,
        "description": x.description,
        "start_at": iso(x.start_at),
        "end_at": iso(x.end_at),
        "location": x.location,
        "meeting_link": x.meeting_link,
        "status": x.status,
        "cancel_reason": x.cancel_reason,
        "updated_at": iso(x.updated_at),
        "created_at": iso(x.created_at),
    }
    if student_id is not None:
        data["in_my_schedule"] = any(r.student_id == student_id for r in x.rsvps)
    if faculty_view:
        data["added_to_schedule_count"] = len(x.rsvps)
    return data


def announcement(a: models.Announcement, faculty_view=False):
    data = {
        "id": a.id,
        "course": {"id": a.course.id, "name": a.course.name, "code": a.course.code},
        "author": user_brief(a.author),
        "target_type": a.target_type,
        "target_section": a.target_section,
        "category": a.category,
        "title": a.title,
        "body": a.body,
        "is_important": a.is_important,
        "created_at": iso(a.created_at),
    }
    if faculty_view:
        data["target_student"] = user_brief(a.target_student)
    return data


def assessment(a: models.Assessment):
    published = sum(1 for m in a.marks if m.status == "PUBLISHED")
    entered = sum(1 for m in a.marks if m.marks_obtained is not None)
    return {
        "id": a.id,
        "course_id": a.course_id,
        "name": a.name,
        "max_marks": a.max_marks,
        "assessment_date": a.assessment_date.isoformat() if a.assessment_date else None,
        "marks_entered": entered,
        "marks_published": published,
        "student_count": len(a.course.enrollments),
    }


def my_mark(m: models.StudentMark):
    """Student-facing view of their own mark. Contains no other student's data."""
    a = m.assessment
    return {
        "id": m.id,
        "course": {"id": a.course.id, "name": a.course.name, "code": a.course.code},
        "assessment": {"id": a.id, "name": a.name, "max_marks": a.max_marks,
                       "assessment_date": a.assessment_date.isoformat() if a.assessment_date else None},
        "marks_obtained": m.marks_obtained,
        "percentage": round(100 * m.marks_obtained / a.max_marks, 1) if m.marks_obtained is not None else None,
        "remarks": m.remarks,
        "published_at": iso(m.published_at),
    }
