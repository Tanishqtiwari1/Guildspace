# Guildspace: Community Skill Exchange & Mentorship Platform

**Live site:** https://tanishqtiwari1.github.io/Guildspace/ (frontend on GitHub Pages; needs the backend deployed, see *Deploying* below)

React frontend → REST API (FastAPI) → SQLAlchemy → SQLite. Every score, list and statistic is computed from database records at request time.

## Run it

**Backend** (port 8000)

```bash
cd backend
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt   # first time only
./venv/bin/python seed.py --demo        # skill catalogue + demo accounts (add --reset to wipe)
./venv/bin/python -m uvicorn main:app --port 8000
```

API docs: http://localhost:8000/docs

**Frontend** (port 5173)

```bash
cd web-frontend
npm install
npm run dev
```

Open http://localhost:5173. Demo accounts (`seed.py --demo`) all use the password `demo1234`: students `tanishq@demo.com`, `aditya@demo.com`, `priya@demo.com`, `nehal@demo.com`, `rahul@demo.com`; faculty `meera@demo.com` (verified, teaches CS201 with Tanishq, Nehal and Rahul enrolled); and `admin@demo.com` (administrator). On an empty database, the first account registered becomes the administrator.

**AI features (optional):** set `ANTHROPIC_API_KEY` before starting the backend to use Claude (`claude-opus-5-5`) for learning plans, session summaries and match explanations. Without it, the same endpoints use rule-based generators over the same data, and the UI labels that output "Rule-based (AI unavailable)".

**Tests:** `cd backend && ./venv/bin/python -m pytest tests`

## Deploying

The site has two halves: the React frontend (static files) and the FastAPI backend (a Python server). GitHub Pages can host only the first.

1. **Frontend → GitHub Pages.** `.github/workflows/pages.yml` builds `web-frontend` and publishes it on every push to `main`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
2. **Backend → Render (free).** On render.com: **New → Blueprint →** pick this repo. `render.yaml` sets up the service, a generated `SECRET_KEY`, CORS for the Pages site, and demo data on start. Free instances sleep when idle (the first request takes about 30 s) and reset their SQLite data on redeploy.
3. **Connect them.** Copy the Render URL (for example `https://guildspace-api.onrender.com`) into repo **Settings → Secrets and variables → Actions → Variables** as `API_URL`, then re-run the *Deploy frontend to GitHub Pages* workflow.

## Faculty & academic module

Three account types: **Student** (the skill-exchange features plus Academics), **Faculty**, and **Admin** (the `is_admin` flag). Faculty register with a department and can only create courses after an admin verifies them under Admin → Faculty.

| Feature | Faculty | Student |
|---|---|---|
| Courses | Create and edit courses; add students by email or share a join code; split students into sections | Join with a code; see their courses |
| Extra classes | Schedule, edit or cancel them on a calendar. Overlapping classes for the same faculty member, or in the same room, are rejected | Notified; class shows on dashboard and calendar; "Add to schedule" and `.ics` download |
| Announcements | Send to a whole course, one section, or one student | See only announcements addressed to them |
| Marks | Course → assessment → roster. Save drafts, publish (all or selected), revise published marks (asks for confirmation; every change is logged in `mark_audit`), unpublish | See **only their own published marks** |

**Marks privacy is enforced in the backend, not the UI.** Every student marks query filters on `student_id == current user` and `status == PUBLISHED`. A request for any other mark ID returns the same 404 as a missing one, and no endpoint takes a student ID as a parameter. Faculty endpoints check `course.faculty_id == current user` and return 404 for other faculty's courses. Notifications say that marks are published but never include the score. `tests/test_academics.py` covers these attack cases.

**Demo flow:** log in as `meera@demo.com` → Extra classes → schedule a class for CS201 → log in as `tanishq@demo.com` and see the notification and the class on the dashboard → as Meera, open Marks → create MTE-1 → enter marks → Save draft → Publish → as Tanishq, open Academics → My marks. Tanishq sees only his own result.

## Trust & support features

| Feature | What it does | Where |
|---|---|---|
| **Skill credits** (time banking) | 1 hour taught = 1 credit. Every student starts with 2. Scheduling a session puts the learner's credits on hold; the mentor is paid only after **both** people confirm the session happened. Cancellations and mentor no-shows refund the learner. The ledger is append-only. | `trust_services.py`, `routers/trust.py`, Skill Credits page |
| **Reliability** | Each user's score is the share of their tracked sessions they kept. Late cancellations (under 24 h notice) and reported no-shows count against them. After 3 or more tracked sessions, a score under 90% takes up to 10 points off match scores. New users are never penalised. | `trust_services.reliability`, `matching.py` |
| **Endorsements & learning record** | After a confirmed session, the mentor endorses the level the learner reached. `/record/:id` shows confirmed hours by skill, endorsements, rating and reliability, and can be saved as a PDF. It never includes marks. | `POST /api/sessions/{id}/endorse`, `GET /api/users/{id}/record` |
| **Academic Rescue** | When a student's **own** published mark is below 50%, they privately get matched with classmates or seniors who took that course and volunteered to help, plus the next extra class and exam notices. Helpers must have been enrolled in the course, can't volunteer while below 50% themselves, and can opt into a "grade-verified" badge (shown at 60% or more; the score itself is never shown). Faculty see anonymous counts only. Help requests reuse the normal request → session → credits flow. | `routers/academics.py` (`/rescue`, `/help-offers`), Academics → Get help |

`tests/test_trust.py` covers escrow, two-sided confirmation, no-shows, the reliability penalty, endorsements, and Rescue privacy.

## SRS traceability

| SRS | Where |
|---|---|
| FR1–FR3 registration, login, admin restriction | `routers/auth.py`, `auth.py` (bcrypt + JWT), `require_admin` |
| FR4–FR8 profile, skills, availability, mode | `routers/profile.py`, Profile page |
| FR9 search | `GET /api/search`, Find → Search tab |
| FR10–FR12 matching, score, explanation | `matching.py`, `routers/matches.py`, Find page |
| FR13–FR15 requests and states | `routers/mentorship.py`, Requests page |
| FR16–FR18 sessions, availability/conflict check | `routers/mentorship.py`, Sessions page |
| FR19–FR20 messaging, notifications | `routers/communication.py`, Messages / Notifications pages |
| FR21–FR25 AI plans and summaries, failure handling, labelling | `ai_service.py`, `routers/ai.py`, Learning plans / Sessions pages |
| FR26–FR28 feedback, reports, admin | `routers/feedback.py`, `routers/admin.py`, Admin page |
| FR29 dashboard | `routers/dashboard.py`, Dashboard page |
| §5.5 business rules | no self-requests, mentor-only accept/reject, availability-checked sessions, feedback only after completion, admin-only moderation (covered in `tests/`) |

## Compatibility score (out of 100)

| Factor | Points | How it's computed |
|---|---|---|
| Skill offered | 25 | mentor lists the skill as OFFERED |
| Level fit | 10 | mentor proficiency above (10) or equal to (5) the learner's target level |
| Availability | 25 | weekly overlapping minutes; 3 h/week or more earns full points |
| Interaction mode | 15 | same mode 15, one side "either" 10, online vs offline 0 |
| Location | 10 | same city 10; different city but both can meet online 5 |
| Two-way exchange | 10 | mentor wants to learn a skill the learner offers |
| Reputation | 5 | mentor's average session rating × 5 / 5 |
