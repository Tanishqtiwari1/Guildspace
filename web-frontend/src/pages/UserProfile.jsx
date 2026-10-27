import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, errorText } from '../api'
import { useAuth } from '../auth.jsx'
import { useApi, Loading, ErrorBox, Empty, Avatar, Stars, Modal, Notice, timeAgo } from '../components/ui.jsx'

export default function UserProfile() {
  const { id } = useParams()
  const { user: me } = useAuth()
  const { data: u, loading, error } = useApi(`/api/users/${id}`)
  const [reporting, setReporting] = useState(false)
  const [notice, setNotice] = useState(null)

  if (loading && !u) return <Loading />
  if (error) return <ErrorBox>{error}</ErrorBox>
  const isMe = u.id === me.id
  const myNeeds = new Set(me.skills.filter((s) => s.skill_type === 'NEEDED').map((s) => s.skill_id))

  return (
    <>
      <div className="card">
        <div className="row between">
          <div className="row">
            <Avatar name={u.name} size={56} />
            <div>
              <h1 style={{ margin: 0 }}>{u.name}</h1>
              <div className="muted">
                {u.account_type === 'FACULTY'
                  ? `${u.designation || 'Faculty'} · ${u.department}`
                  : `${u.role.toLowerCase()} · ${u.location || 'location not set'} · prefers ${u.preferred_mode.toLowerCase()}`}
              </div>
              <Stars value={u.avg_rating} /> <span className="muted small">({u.rating_count} ratings)</span>
            </div>
          </div>
          {!isMe && (
            <div className="row">
              {u.account_type === 'STUDENT' && <Link className="btn ghost" to={`/record/${u.id}`}>Learning record</Link>}
              <Link className="btn ghost" to={`/messages/${u.id}`}>Message</Link>
              <button className="btn ghost" onClick={() => setReporting(true)}>Report</button>
            </div>
          )}
        </div>
        {u.bio && <p style={{ marginTop: 12 }}>{u.bio}</p>}
      </div>
      <Notice kind="success">{notice}</Notice>

      <div className="grid two" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Teaches</h2>
          {u.skills.filter((s) => s.skill_type === 'OFFERED').length === 0 ? <Empty title="Nothing listed" /> : (
            <ul className="list">
              {u.skills.filter((s) => s.skill_type === 'OFFERED').map((s) => (
                <li key={s.id} className="row between">
                  <span><strong>{s.skill_name}</strong> <span className="badge">{s.level.toLowerCase()}</span></span>
                  {!isMe && myNeeds.has(s.skill_id) && <Link className="btn small" to={`/find?skill=${s.skill_id}`}>See match</Link>}
                </li>
              ))}
            </ul>
          )}
          <h2 style={{ marginTop: 16 }}>Learning</h2>
          {u.skills.filter((s) => s.skill_type === 'NEEDED').length === 0 ? <Empty title="Nothing listed" /> : (
            <ul className="list">
              {u.skills.filter((s) => s.skill_type === 'NEEDED').map((s) => (
                <li key={s.id}><strong>{s.skill_name}</strong> <span className="badge">target {s.level.toLowerCase()}</span>{s.goal && <div className="muted small">{s.goal}</div>}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2>Availability</h2>
          {u.availability.length === 0 ? <Empty title="Not set" /> : (
            <div className="chips">{u.availability.map((a) => <span key={a.id} className="chip">{a.day_of_week.slice(0, 3)} {a.start_time}–{a.end_time}</span>)}</div>
          )}
          <h2 style={{ marginTop: 16 }}>Recent feedback</h2>
          {u.recent_feedback.length === 0 ? <Empty title="No feedback yet" /> : (
            <ul className="list">
              {u.recent_feedback.map((f) => (
                <li key={f.id}>
                  <Stars value={f.rating} /> <span className="muted small">by {f.giver.name} · {timeAgo(f.created_at)}</span>
                  {f.comment && <p className="small" style={{ margin: '4px 0 0' }}>{f.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {reporting && <ReportModal user={u} onClose={() => setReporting(false)} onDone={() => { setReporting(false); setNotice('Report submitted. An administrator will review it.') }} />}
    </>
  )
}

export function ReportModal({ user, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post('/api/reports', { reported_user_id: user?.id ?? null, reason })
      onDone()
    } catch (err) {
      setError(errorText(err))
    }
  }
  return (
    <Modal title={user ? `Report ${user.name}` : 'Report a problem'} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox>{error}</ErrorBox>
        <div className="field">
          <label htmlFor="r-reason">What happened?</label>
          <textarea id="r-reason" required minLength={5} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn danger">Submit report</button>
        </div>
      </form>
    </Modal>
  )
}
