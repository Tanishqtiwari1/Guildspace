import { Link } from 'react-router-dom'
import { useAuth } from '../../auth.jsx'
import { useApi, Loading, ErrorBox, Empty, StatusBadge, fmtDateTime, fmtTime, timeAgo } from '../../components/ui.jsx'

export const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function AwaitingVerification() {
  return (
    <div className="card" style={{ maxWidth: 620 }}>
      <h2>⏳ Your faculty account is awaiting verification</h2>
      <p>An administrator needs to confirm that you are college faculty before you can create courses or contact students. You'll get a notification as soon as that happens.</p>
      <Link to="/profile" className="btn ghost">Review your faculty details</Link>
    </div>
  )
}

export default function FacultyDashboard() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useApi('/api/faculty/dashboard')
  const title = `${greeting()}, ${user.faculty_profile?.designation?.includes('Prof') ? 'Professor' : user.name.split(' ')[0]}`

  if (!user.faculty_profile?.verified) {
    return <><div className="page-head"><div><h1>{title}</h1></div></div><AwaitingVerification /></>
  }
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox onRetry={reload}>{error}</ErrorBox>
  const { stats } = data

  return (
    <>
      <div className="card welcome">
        <div>
          <h1><span className="shimmer">{title}</span> <span className="live-pill"><span className="live-dot" />Verified faculty</span></h1>
          <div className="meta">
            {user.faculty_profile?.department} · <strong style={{ color: 'var(--text)' }}>{stats.courses} course{stats.courses === 1 ? '' : 's'}</strong> · {stats.upcoming_classes} upcoming class{stats.upcoming_classes === 1 ? '' : 'es'} · {stats.recent_mark_releases} marks release{stats.recent_mark_releases === 1 ? '' : 's'} this week
          </div>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/faculty/announcements">New announcement</Link>
          <Link className="btn" to="/faculty/classes?new=1">Schedule extra class</Link>
        </div>
      </div>

      <div className="stats">
        <Stat label="Active courses" value={stats.courses} />
        <Stat label="Students" value={stats.students} />
        <Stat label="Upcoming extra classes" value={stats.upcoming_classes} />
        <Stat label="Announcements sent" value={stats.announcements} />
        <Stat label="Marks published" value={stats.marks_published} />
        <Stat label="Pending actions" value={stats.pending_actions} tone={stats.pending_actions ? 'warn' : ''} />
      </div>

      <div className="grid two">
        <div className="card">
          <div className="card-head"><h2>My courses</h2><Link to="/faculty/courses" className="small">Manage</Link></div>
          {data.courses.length === 0 ? (
            <Empty title="No courses yet"><Link to="/faculty/courses?new=1">Create your first course</Link></Empty>
          ) : (
            <ul className="list">
              {data.courses.map((c) => (
                <li key={c.id} className="row between">
                  <div>
                    <Link to={`/faculty/courses/${c.id}`}><strong>{c.code}</strong> {c.name}</Link>
                    <div className="muted small">Sem {c.semester} · Section {c.section} · {c.academic_year} · {c.student_count} student(s)</div>
                  </div>
                  {!c.is_active && <span className="badge">archived</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h2>Pending actions</h2></div>
          {data.pending_actions.length === 0 ? <Empty title="All caught up ✓" /> : (
            <ul className="list">
              {data.pending_actions.map((p, i) => (
                <li key={i} className="row between">
                  <span className="small">{p.kind === 'NO_STUDENTS' ? '👥' : p.kind === 'MARKS_DRAFT' ? '📝' : '✎'} {p.text}</span>
                  <Link className="btn small ghost" to={p.link}>Open</Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card" style={{ borderTop: '4px solid var(--warn-strong)' }}>
          <div className="card-head">
            <div><h2>Academic Rescue insights</h2><div className="sub">Anonymous counts. Students who ask peers for help are never named.</div></div>
          </div>
          {data.rescue_insights.length === 0 ? <Empty title="No students below the threshold">When a published mark is below {data.rescue_threshold}%, the student privately gets matched with peers who took the course.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Course</th><th>Below {data.rescue_threshold}%</th><th>Peer help requests</th><th>Peer helpers</th></tr></thead>
                <tbody>{data.rescue_insights.map((r) => (
                  <tr key={r.course_id}>
                    <td><strong>{r.code}</strong> <span className="muted small">{r.name}</span></td>
                    <td className="mono">{r.below_threshold}</td>
                    <td className="mono">{r.help_requests}</td>
                    <td className="mono">{r.helpers_available}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {data.rescue_insights.some((r) => r.below_threshold > r.helpers_available) && (
            <p className="small muted" style={{ margin: '10px 0 0' }}>Some courses have more students who need help than peer helpers. An extra class may help.</p>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h2>Upcoming extra classes</h2><Link to="/faculty/classes" className="small">Calendar</Link></div>
          {data.upcoming_classes.length === 0 ? <Empty title="Nothing scheduled" /> : (
            <ul className="list">
              {data.upcoming_classes.map((x) => (
                <li key={x.id}>
                  <div className="row between">
                    <strong>{x.course.code} — {x.topic}</strong>
                    <StatusBadge status={x.status} />
                  </div>
                  <div className="muted small">{fmtDateTime(x.start_at)} – {fmtTime(x.end_at)} · {x.location} · {x.added_to_schedule_count} added to schedule</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h2>Recent announcements</h2><Link to="/faculty/announcements" className="small">All</Link></div>
          {data.recent_announcements.length === 0 ? <Empty title="No announcements yet" /> : (
            <ul className="list">
              {data.recent_announcements.map((a) => (
                <li key={a.id}>
                  <strong>{a.is_important && '❗ '}{a.title}</strong>
                  <div className="muted small">{a.course.code} · {audience(a)} · {timeAgo(a.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}

export const audience = (a) =>
  a.target_type === 'COURSE' ? 'whole course' : a.target_type === 'SECTION' ? `section ${a.target_section}` : `to ${a.target_student?.name ?? 'one student'}`

const Stat = ({ label, value, tone }) => (
  <div className={`stat ${tone || ''}`}>
    <div className="value">{value}</div>
    <div className="label">{label}</div>
  </div>
)
