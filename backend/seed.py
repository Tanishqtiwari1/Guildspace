"""Populate the database through the ORM.

    python seed.py            # skill catalogue only (safe to re-run)
    python seed.py --demo     # also create demo accounts for a walkthrough
    python seed.py --reset    # drop all tables first

Demo data is inserted as ordinary database rows; matches, scores and dashboards are
computed from it at request time exactly as for real users.
"""
import sys
from database import SessionLocal, engine, migrate
from auth import hash_password
import models

DEMO_PASSWORD = "demo1234"

SKILLS = [
    ("Python", "Programming"), ("JavaScript", "Programming"), ("React", "Web Development"),
    ("SQL", "Data"), ("Data Analysis", "Data"), ("Machine Learning", "Data"),
    ("UI/UX Design", "Design"), ("Figma", "Design"), ("Public Speaking", "Communication"),
    ("English Writing", "Communication"), ("Guitar", "Music"), ("Photography", "Creative"),
    ("Spanish", "Languages"), ("Excel", "Productivity"), ("Git", "Programming"),
]

# name, email, role, location, mode, bio, offered[(skill, level)], needed[(skill, target, goal)], availability[(day, start, end)]
DEMO_USERS = [
    ("Admin", "admin@demo.com", "BOTH", "Jaipur", "EITHER", "Platform administrator.", [], [], []),
    ("Tanishq Tiwari", "tanishq@demo.com", "BOTH", "Jaipur", "ONLINE",
     "CS student interested in data science and building web apps.",
     [("React", "INTERMEDIATE"), ("Git", "INTERMEDIATE")],
     [("Python", "INTERMEDIATE", "Use Python for data analysis projects"), ("Public Speaking", "BEGINNER", "Present project demos confidently")],
     [("Monday", "18:00", "21:00"), ("Wednesday", "18:00", "21:00"), ("Saturday", "10:00", "14:00")]),
    ("Aditya Verma", "aditya@demo.com", "MENTOR", "Jaipur", "ONLINE",
     "Backend engineer, 5 years of Python and SQL.",
     [("Python", "ADVANCED"), ("SQL", "ADVANCED")], [("React", "BEGINNER", "Build simple frontends for my APIs")],
     [("Monday", "17:00", "20:00"), ("Saturday", "09:00", "13:00")]),
    ("Priya Singh", "priya@demo.com", "MENTOR", "Delhi", "EITHER",
     "Data analyst who enjoys teaching Python and Excel.",
     [("Python", "INTERMEDIATE"), ("Data Analysis", "ADVANCED"), ("Excel", "ADVANCED")], [],
     [("Wednesday", "19:00", "21:00"), ("Sunday", "10:00", "12:00")]),
    ("Nehal Shah", "nehal@demo.com", "BOTH", "Jaipur", "OFFLINE",
     "Debate club lead; learning UI design.",
     [("Public Speaking", "ADVANCED"), ("English Writing", "INTERMEDIATE")], [("UI/UX Design", "BEGINNER", "Design a portfolio site")],
     [("Saturday", "11:00", "15:00"), ("Sunday", "11:00", "15:00")]),
    ("Rahul Mehta", "rahul@demo.com", "LEARNER", "Mumbai", "ONLINE",
     "Commerce graduate moving into analytics.",
     [], [("Data Analysis", "INTERMEDIATE", "Get a junior analyst role"), ("SQL", "BEGINNER", "Write reporting queries")],
     [("Tuesday", "19:00", "21:00"), ("Sunday", "10:00", "12:00")]),
]


# Faculty demo: one verified faculty member and one course with three enrolled students.
# Extra classes, announcements and marks are NOT seeded; the demo creates them live.
DEMO_FACULTY = ("Prof. Meera Iyer", "meera@demo.com", "Computer Science", "Associate Professor", "CSE-1042")
DEMO_COURSE = {"name": "Data Structures", "code": "CS201", "semester": 3, "section": "A", "academic_year": "2026-27",
               "description": "Linear and non-linear data structures, complexity analysis."}
DEMO_ENROLMENTS = [("tanishq@demo.com", "A"), ("nehal@demo.com", "A"), ("rahul@demo.com", "B")]


def seed_faculty(db):
    import academic_services
    name, email, dept, desig, emp = DEMO_FACULTY
    fac = db.query(models.User).filter_by(email=email).first()
    if not fac:
        fac = models.User(name=name, email=email, account_type="FACULTY", role="MENTOR", location="Jaipur",
                          password_hash=hash_password(DEMO_PASSWORD))
        db.add(fac)
        db.flush()
        db.add(models.FacultyProfile(user_id=fac.id, department=dept, designation=desig, employee_id=emp,
                                     verified=True, verified_at=models.utcnow()))
    course = db.query(models.Course).filter_by(code=DEMO_COURSE["code"], section=DEMO_COURSE["section"],
                                               academic_year=DEMO_COURSE["academic_year"]).first()
    if not course:
        course = models.Course(faculty_id=fac.id, join_code=academic_services.new_join_code(db), **DEMO_COURSE)
        db.add(course)
        db.flush()
    for student_email, section in DEMO_ENROLMENTS:
        st = db.query(models.User).filter_by(email=student_email).first()
        if st and not db.query(models.CourseEnrollment).filter_by(course_id=course.id, student_id=st.id).first():
            db.add(models.CourseEnrollment(course_id=course.id, student_id=st.id, section=section))
    db.commit()
    print(f"Faculty demo: {email} teaches {course.code} {course.name} (join code {course.join_code})")


def main():
    if "--reset" in sys.argv:
        models.Base.metadata.drop_all(bind=engine)
    models.Base.metadata.create_all(bind=engine)
    migrate()
    db = SessionLocal()
    try:
        skills = {s.name: s for s in db.query(models.Skill)}
        for name, cat in SKILLS:
            if name not in skills:
                skills[name] = models.Skill(name=name, category=cat)
                db.add(skills[name])
        db.commit()
        print(f"Skill catalogue: {len(skills)} skills")

        if "--demo" in sys.argv:
            for name, email, role, loc, mode, bio, offered, needed, avail in DEMO_USERS:
                if db.query(models.User).filter_by(email=email).first():
                    continue
                u = models.User(name=name, email=email, role=role, location=loc, preferred_mode=mode, bio=bio,
                                password_hash=hash_password(DEMO_PASSWORD), is_admin=(email == "admin@demo.com"))
                db.add(u)
                db.flush()
                for skill, level in offered:
                    db.add(models.UserSkill(user_id=u.id, skill_id=skills[skill].id, skill_type="OFFERED", level=level))
                for skill, level, goal in needed:
                    db.add(models.UserSkill(user_id=u.id, skill_id=skills[skill].id, skill_type="NEEDED", level=level, goal=goal))
                for day, start, end in avail:
                    db.add(models.Availability(user_id=u.id, day_of_week=day, start_time=start, end_time=end))
            db.commit()
            print(f"Demo accounts ready (password: {DEMO_PASSWORD}): " + ", ".join(u[1] for u in DEMO_USERS))
            seed_faculty(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
