from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Date, Text, Float, UniqueConstraint
from sqlalchemy.orm import relationship
from database import Base
import datetime


def utcnow():
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="BOTH")  # LEARNER, MENTOR, BOTH
    bio = Column(Text, nullable=True)
    location = Column(String, nullable=True)
    preferred_mode = Column(String, default="EITHER")  # ONLINE, OFFLINE, EITHER
    account_type = Column(String, default="STUDENT", nullable=False)  # STUDENT, FACULTY (admin is the is_admin flag)
    is_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)

    skills = relationship("UserSkill", back_populates="user", cascade="all, delete-orphan")
    availabilities = relationship("Availability", back_populates="user", cascade="all, delete-orphan")
    faculty_profile = relationship("FacultyProfile", back_populates="user", uselist=False, cascade="all, delete-orphan",
                                   foreign_keys="FacultyProfile.user_id")

    @property
    def is_faculty(self):
        return self.account_type == "FACULTY"

    @property
    def is_verified_faculty(self):
        return self.is_faculty and self.faculty_profile is not None and self.faculty_profile.verified


class Skill(Base):
    __tablename__ = "skills"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True, nullable=False)
    category = Column(String, default="General")
    description = Column(Text, nullable=True)


class UserSkill(Base):
    __tablename__ = "user_skills"
    __table_args__ = (UniqueConstraint("user_id", "skill_id", "skill_type"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    skill_id = Column(Integer, ForeignKey("skills.id"), nullable=False)
    skill_type = Column(String, nullable=False)  # OFFERED or NEEDED
    level = Column(String, default="BEGINNER")  # BEGINNER, INTERMEDIATE, ADVANCED (proficiency or target level)
    goal = Column(Text, nullable=True)  # learning goal, for NEEDED skills

    user = relationship("User", back_populates="skills")
    skill = relationship("Skill")


class Availability(Base):
    __tablename__ = "availabilities"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    day_of_week = Column(String, nullable=False)  # Monday, Tuesday, etc.
    start_time = Column(String, nullable=False)  # HH:MM
    end_time = Column(String, nullable=False)  # HH:MM

    user = relationship("User", back_populates="availabilities")


class MentorshipRequest(Base):
    __tablename__ = "mentorship_requests"
    id = Column(Integer, primary_key=True, index=True)
    learner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    mentor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    skill_id = Column(Integer, ForeignKey("skills.id"), nullable=False)
    status = Column(String, default="PENDING")  # PENDING, ACCEPTED, REJECTED, CANCELLED, COMPLETED
    message = Column(Text, nullable=True)
    compatibility_score = Column(Integer, nullable=True)  # score at the time the request was sent
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    learner = relationship("User", foreign_keys=[learner_id])
    mentor = relationship("User", foreign_keys=[mentor_id])
    skill = relationship("Skill")
    sessions = relationship("MentorshipSession", back_populates="request", cascade="all, delete-orphan")


class MentorshipSession(Base):
    __tablename__ = "sessions"
    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(Integer, ForeignKey("mentorship_requests.id"), nullable=False)
    start_at = Column(DateTime, nullable=False)
    end_at = Column(DateTime, nullable=False)
    mode = Column(String, default="ONLINE")  # ONLINE, OFFLINE
    location_or_link = Column(String, nullable=True)
    status = Column(String, default="SCHEDULED")  # SCHEDULED, RESCHEDULED, CANCELLED, COMPLETED, NO_SHOW
    # A session completes only when BOTH participants confirm it happened (credits move then).
    learner_confirmed_at = Column(DateTime, nullable=True)
    mentor_confirmed_at = Column(DateTime, nullable=True)
    cancelled_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    cancelled_at = Column(DateTime, nullable=True)
    no_show_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # who failed to attend
    notes = Column(Text, nullable=True)  # raw notes written by participants, input for the summary
    summary = Column(Text, nullable=True)  # JSON: topics, key_points, next_steps
    summary_source = Column(String, nullable=True)  # "ai" or "rule-based"
    created_at = Column(DateTime, default=utcnow)

    request = relationship("MentorshipRequest", back_populates="sessions")


class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    text = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False)
    sent_at = Column(DateTime, default=utcnow)


class Feedback(Base):
    __tablename__ = "feedback"
    __table_args__ = (UniqueConstraint("session_id", "giver_id"),)
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    giver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    receiver_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    rating = Column(Integer, nullable=False)  # 1-5
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    kind = Column(String, nullable=False)  # REQUEST, SESSION, MESSAGE, FEEDBACK, REPORT, SYSTEM, EXTRA_CLASS, ANNOUNCEMENT, MARKS
    text = Column(String, nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)  # set for academic notifications
    link = Column(String, nullable=True)  # frontend route to open
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


class Report(Base):
    __tablename__ = "reports"
    id = Column(Integer, primary_key=True, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reported_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reason = Column(Text, nullable=False)
    status = Column(String, default="OPEN")  # OPEN, RESOLVED, DISMISSED
    admin_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    reporter = relationship("User", foreign_keys=[reporter_id])
    reported_user = relationship("User", foreign_keys=[reported_user_id])


class LearningPlan(Base):
    __tablename__ = "learning_plans"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    skill_id = Column(Integer, ForeignKey("skills.id"), nullable=False)
    goal = Column(Text, nullable=False)
    content = Column(Text, nullable=False)  # JSON: title, weeks[{week, focus, activities, milestone}]
    source = Column(String, nullable=False)  # "ai" or "rule-based"
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    skill = relationship("Skill")


# ---------- College faculty & academic management ----------

class FacultyProfile(Base):
    """Faculty-specific details. Faculty can use academic features only after an admin verifies them."""
    __tablename__ = "faculty_profiles"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    department = Column(String, nullable=False)
    designation = Column(String, nullable=True)  # e.g. Assistant Professor
    employee_id = Column(String, nullable=True)
    verified = Column(Boolean, default=False)
    verified_at = Column(DateTime, nullable=True)
    verified_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    user = relationship("User", back_populates="faculty_profile", foreign_keys=[user_id])


class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (UniqueConstraint("code", "section", "academic_year"),)
    id = Column(Integer, primary_key=True, index=True)
    faculty_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=False)
    semester = Column(Integer, nullable=False)
    section = Column(String, nullable=False)  # default section; enrollments may carry their own (combined classes)
    academic_year = Column(String, nullable=False)  # e.g. 2026-27
    description = Column(Text, nullable=True)
    join_code = Column(String, unique=True, nullable=False, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)

    faculty = relationship("User")
    enrollments = relationship("CourseEnrollment", back_populates="course", cascade="all, delete-orphan")
    extra_classes = relationship("ExtraClass", back_populates="course", cascade="all, delete-orphan")
    assessments = relationship("Assessment", back_populates="course", cascade="all, delete-orphan")
    announcements = relationship("Announcement", back_populates="course", cascade="all, delete-orphan")


class CourseEnrollment(Base):
    __tablename__ = "course_enrollments"
    __table_args__ = (UniqueConstraint("course_id", "student_id"),)
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    section = Column(String, nullable=False)
    enrolled_at = Column(DateTime, default=utcnow)

    course = relationship("Course", back_populates="enrollments")
    student = relationship("User")


class ExtraClass(Base):
    __tablename__ = "extra_classes"
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    topic = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    start_at = Column(DateTime, nullable=False)
    end_at = Column(DateTime, nullable=False)
    location = Column(String, nullable=False)
    meeting_link = Column(String, nullable=True)
    status = Column(String, default="SCHEDULED")  # SCHEDULED, CANCELLED
    cancel_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    course = relationship("Course", back_populates="extra_classes")
    rsvps = relationship("ExtraClassRSVP", back_populates="extra_class", cascade="all, delete-orphan")


class ExtraClassRSVP(Base):
    """A student adding an extra class to their personal schedule."""
    __tablename__ = "extra_class_rsvps"
    __table_args__ = (UniqueConstraint("extra_class_id", "student_id"),)
    id = Column(Integer, primary_key=True, index=True)
    extra_class_id = Column(Integer, ForeignKey("extra_classes.id"), nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=utcnow)

    extra_class = relationship("ExtraClass", back_populates="rsvps")


class Announcement(Base):
    __tablename__ = "announcements"
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_type = Column(String, nullable=False)  # COURSE, SECTION, STUDENT
    target_section = Column(String, nullable=True)
    target_student_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    category = Column(String, default="GENERAL")  # GENERAL, EXTRA_CLASS, ASSIGNMENT, EXAM, NOTICE
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    is_important = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)

    course = relationship("Course", back_populates="announcements")
    author = relationship("User", foreign_keys=[author_id])
    target_student = relationship("User", foreign_keys=[target_student_id])


class Assessment(Base):
    __tablename__ = "assessments"
    __table_args__ = (UniqueConstraint("course_id", "name"),)
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    name = Column(String, nullable=False)  # e.g. MTE-1
    max_marks = Column(Float, nullable=False)
    assessment_date = Column(Date, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    course = relationship("Course", back_populates="assessments")
    marks = relationship("StudentMark", back_populates="assessment", cascade="all, delete-orphan")


class StudentMark(Base):
    """Private by default: only the student it belongs to (once published) and the course faculty can read it."""
    __tablename__ = "student_marks"
    __table_args__ = (UniqueConstraint("assessment_id", "student_id"),)
    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("assessments.id"), nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    marks_obtained = Column(Float, nullable=True)
    remarks = Column(Text, nullable=True)
    status = Column(String, default="DRAFT")  # DRAFT, PUBLISHED
    published_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    assessment = relationship("Assessment", back_populates="marks")
    student = relationship("User", foreign_keys=[student_id])
    audit = relationship("MarkAudit", back_populates="mark", cascade="all, delete-orphan")


class MarkAudit(Base):
    """Append-only history of every change to a mark, for academic integrity."""
    __tablename__ = "mark_audit"
    id = Column(Integer, primary_key=True, index=True)
    mark_id = Column(Integer, ForeignKey("student_marks.id"), nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String, nullable=False)  # ENTER, UPDATE, REVISE, PUBLISH, UNPUBLISH
    old_value = Column(Float, nullable=True)
    new_value = Column(Float, nullable=True)
    at = Column(DateTime, default=utcnow)

    mark = relationship("StudentMark", back_populates="audit")


# ---------- Time-credit ledger ----------

class CreditTransaction(Base):
    """Append-only ledger. A user's balance is the sum of their amounts (1 credit = 1 hour)."""
    __tablename__ = "credit_transactions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    amount = Column(Float, nullable=False)  # positive = credit in, negative = credit out
    kind = Column(String, nullable=False)  # STARTER, HOLD, REFUND, EARNED, ADJUST
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=True, index=True)
    note = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    session = relationship("MentorshipSession")


# ---------- Reliability & endorsements ----------

class Endorsement(Base):
    """A mentor vouching for the level a learner reached, tied to a completed session."""
    __tablename__ = "endorsements"
    __table_args__ = (UniqueConstraint("session_id", "endorser_id"),)
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=False)
    endorser_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    skill_id = Column(Integer, ForeignKey("skills.id"), nullable=False)
    level = Column(String, nullable=False)  # BEGINNER, INTERMEDIATE, ADVANCED reached
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    endorser = relationship("User", foreign_keys=[endorser_id])
    skill = relationship("Skill")


# ---------- Academic Rescue ----------

class CourseHelpOffer(Base):
    """A student who took a course volunteering to help others with it.
    Backed by an OFFERED UserSkill so help requests reuse the normal mentorship flow."""
    __tablename__ = "course_help_offers"
    __table_args__ = (UniqueConstraint("user_id", "course_code"),)
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_code = Column(String, nullable=False, index=True)
    skill_id = Column(Integer, ForeignKey("skills.id"), nullable=False)
    note = Column(String, nullable=True)
    share_grade_badge = Column(Boolean, default=False)  # opt-in: show "grade-verified" (never the score)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User")
    skill = relationship("Skill")
