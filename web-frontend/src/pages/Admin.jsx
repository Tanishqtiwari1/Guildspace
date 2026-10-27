import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorText } from '../api'
import { useAuth } from '../auth.jsx'
import { useApi, Loading, ErrorBox, Empty, StatusBadge, Stars, timeAgo, fmtDateTime } from '../components/ui.jsx'

const TABS = ['overview', 'faculty', 'users', 'reports', 'courses', 'skills', 'requests', 'sessions']

export default function Admin() {
  const [tab, setTab] = useState('overview')
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Administration</h1>
          <p>Manage users, skills, mentorship records and reports.</p>
        </div>
      </div>
      <div className="tabs">
        {TABS.map((t) => <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'faculty' && <FacultyAdmin />}
      {tab === 'courses' && <CoursesAdmin />}
      {tab === 'users' && <Users />}
      {tab === 'reports' && <ReportsAdmin />}
      {tab === 'skills' && <SkillsAdmin />}
      {tab === 'requests' && <RequestsAdmin />}
      {tab === 'sessions' && <SessionsAdmin />}
    </>
  )
}

function useAction(reload) {
  const [error, setError] = useState(null)
  const run = async (fn) => {
    setError(null)
    try { await fn(); reload() } catch (e) { setError(errorText(e)) }
  }
  return [error, run]
}

const Breakdown = ({ title, data }) => (
  <div className="card">
    <h3>{title}</h3>
    {Object.keys(data).length === 0 ? <span className="muted small">None yet</span> : (
      <div className="chips">{Object.entries(data).map(([k, v]) => <span key={k} className={`badge status-${k.toLowerCase()}`}>{k.toLowerCase()}: {v}</span>)}</div>
    )}
  </div>
)

function Overview() {
  const { data, loading, error, reload } = useApi('/api/admin/stats')
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox onRetry={reload}>{error}</ErrorBox>
  return (
    <>
      <div className="stats">
        {[['Users', `${data.active_users} / ${data.users}`, 'active / total'], ['Faculty', data.faculty, `${data.faculty_pending} awaiting verification`], ['Courses', data.courses], ['Skills', data.skills], ['Messages', data.messages],
          ['Feedback', data.feedback_count], ['Avg rating', data.avg_rating ?? '—'], ['Learning plans', data.learning_plans]].map(([l, v, sub]) => (
          <div className="stat" key={l}><div className="value">{v}</div><div className="label">{l}{sub ? ` (${sub})` : ''}</div></div>
        ))}
      </div>
      <div className="grid three">
        <Breakdown title="Requests" data={data.requests_by_status} />
        <Breakdown title="Sessions" data={data.sessions_by_status} />
        <Breakdown title="Reports" data={data.reports_by_status} />
      </div>
    </>
  )
}

function Users() {
  const { user: me } = useAuth()
  const [q, setQ] = useState('')
  const { data, loading, error, reload } = useApi(`/api/admin/users?q=${encodeURIComponent(q)}`)
  const [actionError, run] = useAction(reload)
  const patch = (u, body) => run(() => api.patch(`/api/admin/users/${u.id}`, body))
  return (
    <div className="card">
      <input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12, maxWidth: 320 }} aria-label="Search users" />
      <ErrorBox>{error || actionError}</ErrorBox>
      {loading && !data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Skills</th><th>Rating</th><th>Reports</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.id}>
                  <td><Link to={`/users/${u.id}`}>{u.name}</Link>{u.is_admin && <span className="badge ai" style={{ marginLeft: 6 }}>admin</span>}<div className="muted small">{u.email}</div></td>
                  <td>{u.account_type === 'FACULTY' ? 'faculty' : `student · ${u.role.toLowerCase()}`}</td>
                  <td>{u.skills.length}</td>
                  <td><Stars value={u.avg_rating} /></td>
                  <td>{u.reports_against}</td>
                  <td>{u.is_active ? <span className="badge status-completed">active</span> : <span className="badge status-cancelled">deactivated</span>}</td>
                  <td>
                    {u.id !== me.id && (
                      <div className="row">
                        <button className={`btn small ${u.is_active ? 'danger' : 'success'}`} onClick={() => {
                          if (!u.is_active || window.confirm(`Deactivate ${u.name}? Their open mentorships will be cancelled.`)) patch(u, { is_active: !u.is_active })
                        }}>{u.is_active ? 'Deactivate' : 'Reactivate'}</button>
                        <button className="btn small ghost" onClick={() => patch(u, { is_admin: !u.is_admin })}>{u.is_admin ? 'Remove admin' : 'Make admin'}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FacultyAdmin() {
  const { data, loading, error, reload } = useApi('/api/admin/faculty')
  const [actionError, run] = useAction(reload)
  const pending = (data || []).filter((f) => !f.faculty_profile?.verified)
  const rows = [...pending, ...(data || []).filter((f) => f.faculty_profile?.verified)]
  return (
    <div className="card">
      <p className="muted small">Faculty can create courses, contact students and publish marks only after you verify them.{pending.length > 0 && <strong> {pending.length} waiting.</strong>}</p>
      <ErrorBox>{error || actionError}</ErrorBox>
      {loading && !data ? <Loading /> : rows.length === 0 ? <Empty title="No faculty accounts yet" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Faculty</th><th>Department</th><th>Designation</th><th>Employee ID</th><th>Courses</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td><Link to={`/users/${f.id}`}>{f.name}</Link><div className="muted small">{f.email}</div></td>
                  <td>{f.faculty_profile?.department}</td>
                  <td>{f.faculty_profile?.designation || '—'}</td>
                  <td>{f.faculty_profile?.employee_id || '—'}</td>
                  <td>{f.course_count}</td>
                  <td>{f.faculty_profile?.verified ? <span className="badge status-completed">verified</span> : <span className="badge status-pending">pending</span>}</td>
                  <td>
                    {f.faculty_profile?.verified
                      ? <button className="btn small ghost" onClick={() => window.confirm(`Withdraw verification for ${f.name}? They will lose access to faculty tools.`) && run(() => api.post(`/api/admin/faculty/${f.id}/verify`, { verified: false }))}>Revoke</button>
                      : <button className="btn small success" onClick={() => run(() => api.post(`/api/admin/faculty/${f.id}/verify`, { verified: true }))}>Verify</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CoursesAdmin() {
  const { data, loading, error } = useApi('/api/admin/courses')
  if (loading && !data) return <Loading />
  return (
    <div className="card table-wrap">
      <ErrorBox>{error}</ErrorBox>
      {data?.length === 0 ? <Empty title="No courses yet" /> : (
        <table>
          <thead><tr><th>Code</th><th>Course</th><th>Faculty</th><th>Sem</th><th>Section</th><th>Year</th><th>Students</th><th>Status</th></tr></thead>
          <tbody>{data?.map((c) => (
            <tr key={c.id}><td><strong>{c.code}</strong></td><td>{c.name}</td><td>{c.faculty?.name}</td><td>{c.semester}</td><td>{c.sections.join(', ')}</td><td>{c.academic_year}</td><td>{c.student_count}</td>
              <td>{c.is_active ? <span className="badge status-completed">active</span> : <span className="badge">archived</span>}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}

function ReportsAdmin() {
  const [status, setStatus] = useState('OPEN')
  const { data, loading, error, reload } = useApi(`/api/admin/reports${status ? `?status=${status}` : ''}`)
  const [actionError, run] = useAction(reload)
  const [notes, setNotes] = useState({})
  return (
    <div className="card">
      <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 200, marginBottom: 12 }} aria-label="Filter by status">
        <option value="OPEN">Open</option><option value="RESOLVED">Resolved</option><option value="DISMISSED">Dismissed</option><option value="">All</option>
      </select>
      <ErrorBox>{error || actionError}</ErrorBox>
      {loading && !data ? <Loading /> : data?.length === 0 ? <Empty title="No reports" /> : (
        <ul className="list">
          {data?.map((r) => (
            <li key={r.id}>
              <div className="row between">
                <div>
                  <strong>{r.reporter.name}</strong> reported {r.reported_user ? <Link to={`/users/${r.reported_user.id}`}>{r.reported_user.name}</Link> : 'a platform issue'}
                  <span className="muted small"> · {timeAgo(r.created_at)}</span>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <p style={{ margin: '6px 0' }}>{r.reason}</p>
              {r.admin_note && <p className="muted small">Note: {r.admin_note}</p>}
              {r.status === 'OPEN' && (
                <div className="inline-form">
                  <div className="field"><input placeholder="Note for the reporter (optional)" value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} aria-label="Admin note" /></div>
                  <button className="btn small success" onClick={() => run(() => api.patch(`/api/admin/reports/${r.id}`, { status: 'RESOLVED', admin_note: notes[r.id] || null }))}>Resolve</button>
                  <button className="btn small ghost" onClick={() => run(() => api.patch(`/api/admin/reports/${r.id}`, { status: 'DISMISSED', admin_note: notes[r.id] || null }))}>Dismiss</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SkillsAdmin() {
  const { data, loading, error, reload } = useApi('/api/admin/skills')
  const [actionError, run] = useAction(reload)
  const [edit, setEdit] = useState(null)
  return (
    <div className="card">
      <ErrorBox>{error || actionError}</ErrorBox>
      {loading && !data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Skill</th><th>Category</th><th>Used by</th><th /></tr></thead>
            <tbody>
              {data?.map((s) => edit?.id === s.id ? (
                <tr key={s.id}>
                  <td><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="Skill name" /></td>
                  <td><input value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} aria-label="Category" /></td>
                  <td>{s.usage}</td>
                  <td className="row">
                    <button className="btn small" onClick={() => run(async () => { await api.put(`/api/admin/skills/${s.id}`, { name: edit.name, category: edit.category }); setEdit(null) })}>Save</button>
                    <button className="btn small ghost" onClick={() => setEdit(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={s.id}>
                  <td>{s.name}</td><td>{s.category}</td><td>{s.usage} user(s)</td>
                  <td className="row">
                    <button className="btn small ghost" onClick={() => setEdit({ id: s.id, name: s.name, category: s.category })}>Edit</button>
                    <button className="btn small ghost" onClick={() => window.confirm(`Delete ${s.name}?`) && run(() => api.delete(`/api/admin/skills/${s.id}`))}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RequestsAdmin() {
  const { data, loading, error } = useApi('/api/admin/requests')
  if (loading && !data) return <Loading />
  return (
    <div className="card table-wrap">
      <ErrorBox>{error}</ErrorBox>
      {data?.length === 0 ? <Empty title="No requests yet" /> : (
        <table>
          <thead><tr><th>Learner</th><th>Mentor</th><th>Skill</th><th>Score</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>{data?.map((r) => (
            <tr key={r.id}><td>{r.learner.name}</td><td>{r.mentor.name}</td><td>{r.skill.name}</td><td>{r.compatibility_score ?? '—'}</td><td><StatusBadge status={r.status} /></td><td>{timeAgo(r.created_at)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}

function SessionsAdmin() {
  const { data, loading, error } = useApi('/api/admin/sessions')
  if (loading && !data) return <Loading />
  return (
    <div className="card table-wrap">
      <ErrorBox>{error}</ErrorBox>
      {data?.length === 0 ? <Empty title="No sessions yet" /> : (
        <table>
          <thead><tr><th>When</th><th>Mentor</th><th>Learner</th><th>Skill</th><th>Mode</th><th>Status</th></tr></thead>
          <tbody>{data?.map((s) => (
            <tr key={s.id}><td>{fmtDateTime(s.start_at)}</td><td>{s.mentor.name}</td><td>{s.learner.name}</td><td>{s.skill.name}</td><td>{s.mode.toLowerCase()}</td><td><StatusBadge status={s.status} /></td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}
