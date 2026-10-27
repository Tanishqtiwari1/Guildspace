import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorText } from '../api'
import { useAuth } from '../auth.jsx'
import { useApi, Loading, ErrorBox, Empty, Avatar, StatusBadge, SourceBadge, Modal, fmtDateTime, fmtTime } from '../components/ui.jsx'
import { Icon } from '../components/brand.jsx'
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Slots where both users are available, computed from their saved availability. */
function sharedSlots(a, b) {
  const out = []
  for (const x of a) for (const y of b) {
    if (x.day_of_week !== y.day_of_week) continue
    const s = Math.max(toMin(x.start_time), toMin(y.start_time))
    const e = Math.min(toMin(x.end_time), toMin(y.end_time))
    if (e > s) out.push({ day: x.day_of_week, start: toHHMM(s), end: toHHMM(e) })
  }
  return out.sort((p, q) => DAYS.indexOf(p.day) - DAYS.indexOf(q.day) || p.start.localeCompare(q.start))
}

/** Next calendar date (from today) that falls on `day`. */
function nextDate(day) {
  const d = new Date()
  const want = (DAYS.indexOf(day) + 1) % 7 // JS: Sunday = 0
  while (d.getDay() !== want) d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA') // YYYY-MM-DD in local time
}

const localIso = (date, time) => `${date}T${time}:00`

export function ScheduleModal({ request, session, onClose, onDone }) {
  const { user } = useAuth()
  const r = request || { id: session.request_id, mentor: session.mentor, learner: session.learner, skill: session.skill }
  const other = r.mentor.id === user.id ? r.learner : r.mentor
  const { data: otherUser } = useApi(`/api/users/${other.id}`)
  const shared = otherUser ? sharedSlots(user.availability, otherUser.availability) : []
  const init = session
    ? { date: session.start_at.slice(0, 10), start: session.start_at.slice(11, 16), end: session.end_at.slice(11, 16) }
    : { date: '', start: '', end: '' }
  const [form, setForm] = useState({ ...init, mode: 'ONLINE', location_or_link: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const pick = (slot) => {
    const end = Math.min(toMin(slot.end), toMin(slot.start) + 60)
    setForm({ ...form, date: nextDate(slot.day), start: slot.start, end: toHHMM(end) })
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const times = { start_at: localIso(form.date, form.start), end_at: localIso(form.date, form.end) }
      if (session) await api.patch(`/api/sessions/${session.id}/reschedule`, times)
      else await api.post('/api/sessions', { request_id: r.id, ...times, mode: form.mode, location_or_link: form.location_or_link || null })
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={`${session ? 'Reschedule' : 'Schedule'} ${r.skill.name} session with ${other.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted small" style={{ marginBottom: 6 }}>Times you're both available (pick one to fill the form):</p>
        {!otherUser ? <Loading /> : shared.length === 0 ? (
          <div className="alert warn">You have no overlapping availability. One of you needs to <Link to="/profile">add more time slots</Link>.</div>
        ) : (
          <div className="chips" style={{ marginBottom: 14 }}>
            {shared.map((s, i) => (
              <button type="button" key={i} className="chip" style={{ cursor: 'pointer' }} onClick={() => pick(s)}>
                {s.day.slice(0, 3)} {s.start}–{s.end}
              </button>
            ))}
          </div>
        )}
        <ErrorBox>{error}</ErrorBox>
        <div className="form-grid">
          <div className="field"><label htmlFor="sc-date">Date</label><input id="sc-date" type="date" required value={form.date} min={new Date().toLocaleDateString('en-CA')} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div className="field"><label htmlFor="sc-start">Start</label><input id="sc-start" type="time" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
          <div className="field"><label htmlFor="sc-end">End</label><input id="sc-end" type="time" required value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
        </div>
        {!session && (
          <div className="form-grid">
            <div className="field">
              <label htmlFor="sc-mode">Mode</label>
              <select id="sc-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                <option value="ONLINE">Online</option><option value="OFFLINE">In person</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="sc-loc">{form.mode === 'ONLINE' ? 'Meeting link' : 'Place'}</label>
              <input id="sc-loc" value={form.location_or_link} onChange={(e) => setForm({ ...form, location_or_link: e.target.value })} />
            </div>
          </div>
        )}
        {form.date && form.start && form.end && form.end > form.start && (() => {
          const hrs = Math.round(((toMin(form.end) - toMin(form.start)) / 60) * 100) / 100
          const learnerIsMe = r.learner.id === user.id
          return (
            <div className="inner-box small" style={{ marginBottom: 12 }}>
              <Icon name="toll" size={16} style={{ color: 'var(--primary)' }} /> {hrs} h session: {learnerIsMe ? 'you put' : `${r.learner.name} puts`} <strong>{hrs} credit{hrs === 1 ? '' : 's'}</strong> on hold.
              They go to {r.mentor.id === user.id ? 'you' : r.mentor.name} only after you both confirm the session happened.
            </div>
          )
        })()}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : session ? 'Reschedule' : 'Schedule'}</button>
        </div>
      </form>
    </Modal>
  )
}

export default function Sessions() {
  const { user } = useAuth()
  const [scope, setScope] = useState('upcoming')
  const { data, loading, error, reload } = useApi(`/api/sessions?scope=${scope}`)
  const [rescheduling, setRescheduling] = useState(null)
  const [actionError, setActionError] = useState(null)

  const act = async (s, path, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return
    setActionError(null)
    try {
      await api.post(`/api/sessions/${s.id}/${path}`)
      reload()
    } catch (e) {
      setActionError(errorText(e))
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sessions</h1>
          <p>Schedule new sessions from an accepted request on the <Link to="/requests">Requests</Link> page.</p>
        </div>
      </div>
      <div className="tabs">
        <button className={`tab ${scope === 'upcoming' ? 'active' : ''}`} onClick={() => setScope('upcoming')}>Upcoming</button>
        <button className={`tab ${scope === 'past' ? 'active' : ''}`} onClick={() => setScope('past')}>Completed & cancelled</button>
      </div>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      <ErrorBox>{actionError}</ErrorBox>
      {loading && !data ? <Loading /> : data?.length === 0 ? (
        <div className="card"><Empty title={scope === 'upcoming' ? 'No upcoming sessions' : 'No past sessions yet'} /></div>
      ) : (
        <div className="stack">
          {data?.map((s) => (
            <SessionCard key={s.id} s={s} reload={reload}
              onReschedule={() => setRescheduling(s)}
              onCancel={() => act(s, 'cancel', (new Date(s.start_at) - new Date()) < 24 * 3600 * 1000
                ? 'This session starts within 24 hours. Cancelling now counts as a late cancellation and lowers your reliability score. Cancel anyway?'
                : 'Cancel this session? Held credits go back to the learner.')}
              onComplete={() => act(s, 'complete')}
              onNoShow={() => act(s, 'no-show', `Report that ${s.mentor.id === user.id ? s.learner.name : s.mentor.name} did not attend? This lowers their reliability score.`)} />
          ))}
        </div>
      )}
      {rescheduling && <ScheduleModal session={rescheduling} onClose={() => setRescheduling(null)} onDone={() => { setRescheduling(null); reload() }} />}
    </>
  )
}

function SessionCard({ s, reload, onReschedule, onCancel, onComplete, onNoShow }) {
  const { user } = useAuth()
  const isMentor = s.mentor.id === user.id
  const other = isMentor ? s.learner : s.mentor
  const active = ['SCHEDULED', 'RESCHEDULED'].includes(s.status)
  const now = new Date()
  const startsToday = new Date(s.start_at).toDateString() === now.toDateString() || new Date(s.start_at) < now
  const ended = new Date(s.end_at) < now
  const otherConfirmed = isMentor ? s.learner_confirmed : s.mentor_confirmed
  return (
    <div className="card">
      <div className="row between">
        <div className="row">
          <Avatar name={other.name} />
          <div>
            <strong>{s.skill.name}</strong> with <Link to={`/users/${other.id}`}>{other.name}</Link>
            <span className="muted small"> ({isMentor ? 'you mentor' : 'your mentor'})</span>
            <div className="muted small">{fmtDateTime(s.start_at)} – {fmtTime(s.end_at)} · {s.mode.toLowerCase()}{s.location_or_link ? ` · ${s.location_or_link}` : ''}</div>
          </div>
        </div>
        <div className="row">
          <span className="badge mono-tag" title="1 credit = 1 hour">{s.hours} h · {isMentor ? `earn ${s.hours}` : `${s.credits_held} held`} cr</span>
          <StatusBadge status={s.status === 'NO_SHOW' ? 'CANCELLED' : s.status} />
        </div>
      </div>
      {s.status === 'NO_SHOW' && (
        <div className="alert warn" style={{ marginTop: 12, marginBottom: 0 }}>
          {s.no_show_user_id === user.id ? 'Marked as a no-show for you. This lowers your reliability score.' : `${other.name} did not attend.`}
          {' '}{s.no_show_user_id === s.mentor.id ? 'The learner\'s credits were refunded.' : 'The mentor received the credits for the reserved time.'}
        </div>
      )}
      {s.status === 'CANCELLED' && s.late_cancellation && (
        <p className="small muted" style={{ margin: '10px 0 0' }}>Cancelled with less than 24 h notice{s.cancelled_by_me ? ' by you; this counts against your reliability.' : '.'}</p>
      )}
      {active && (
        <>
          {(s.i_confirmed || otherConfirmed) && (
            <div className="inner-box small" style={{ marginTop: 12 }}>
              <Icon name="verified_user" size={16} style={{ color: 'var(--success)' }} />{' '}
              {s.i_confirmed ? `You confirmed. Waiting for ${other.name} to confirm before credits move.` : `${other.name} confirmed this session took place. Confirm to complete it.`}
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            {!s.i_confirmed && !otherConfirmed && <button className="btn small ghost" onClick={onReschedule}>Reschedule</button>}
            {!s.i_confirmed && <button className="btn small ghost" onClick={onCancel}>Cancel</button>}
            {!s.i_confirmed && (
              <button className="btn small success" onClick={onComplete} disabled={!startsToday} title={startsToday ? '' : 'Available on the day of the session'}>
                <Icon name="check_circle" /> Confirm it happened
              </button>
            )}
            {ended && !otherConfirmed && !s.i_confirmed && (
              <button className="btn small ghost" onClick={onNoShow} title={`Report that ${other.name} did not attend`}>Report no-show</button>
            )}
          </div>
        </>
      )}
      {s.status === 'COMPLETED' && <PostSession s={s} reload={reload} isMentor={isMentor} />}
    </div>
  )
}

function PostSession({ s, reload, isMentor }) {
  const [notes, setNotes] = useState(s.notes || '')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [fb, setFb] = useState({ rating: 5, comment: '' })
  const [end, setEnd] = useState({ level: 'INTERMEDIATE', note: '' })

  const call = async (key, fn) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <hr className="divider" />
      <ErrorBox>{error}</ErrorBox>
      <div className="grid two">
        <div>
          <h3>Session notes</h3>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you cover? What should happen next?" maxLength={10000} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small ghost" disabled={busy || notes === (s.notes || '')} onClick={() => call('notes', () => api.put(`/api/sessions/${s.id}/notes`, { notes }))}>
              {busy === 'notes' ? 'Saving…' : 'Save notes'}
            </button>
            <button className="btn small" disabled={busy || !s.notes} title={s.notes ? '' : 'Save notes first'}
              onClick={() => call('summary', () => api.post(`/api/sessions/${s.id}/summary`))}>
              {busy === 'summary' ? 'Generating…' : s.summary ? 'Regenerate summary' : '✦ Generate summary'}
            </button>
          </div>
        </div>
        <div>
          {s.summary ? (
            <>
              <div className="row between"><h3 style={{ margin: 0 }}>Summary</h3><SourceBadge source={s.summary_source} /></div>
              <SummaryList title="Topics" items={s.summary.topics} />
              <SummaryList title="Key points" items={s.summary.key_points} />
              <SummaryList title="Next steps" items={s.summary.next_steps} />
            </>
          ) : <Empty title="No summary yet">Save notes, then generate a summary.</Empty>}
        </div>
      </div>
      <hr className="divider" />
      {isMentor && (s.endorsed ? (
        <p className="muted small">✓ You endorsed {s.learner.name}'s progress for this session.</p>
      ) : (
        <form className="inline-form" style={{ marginBottom: 14 }} onSubmit={(e) => { e.preventDefault(); call('endorse', () => api.post(`/api/sessions/${s.id}/endorse`, { level: end.level, note: end.note || null })) }}>
          <div className="field" style={{ flex: 0, minWidth: 170 }}>
            <label htmlFor={`en-l-${s.id}`}>Endorse {s.learner.name.split(' ')[0]}'s level</label>
            <select id={`en-l-${s.id}`} value={end.level} onChange={(e) => setEnd({ ...end, level: e.target.value })}>
              <option value="BEGINNER">Beginner</option><option value="INTERMEDIATE">Intermediate</option><option value="ADVANCED">Advanced</option>
            </select>
          </div>
          <div className="field" style={{ flex: 3 }}>
            <label htmlFor={`en-n-${s.id}`}>What they can now do</label>
            <input id={`en-n-${s.id}`} maxLength={500} value={end.note} onChange={(e) => setEnd({ ...end, note: e.target.value })} placeholder="e.g. Writes clean pandas groupby pipelines" />
          </div>
          <button className="btn mint" disabled={busy === 'endorse'}><Icon name="workspace_premium" /> Endorse</button>
        </form>
      ))}
      {s.feedback_given ? (
        <p className="muted small" style={{ margin: 0 }}>✓ You've left feedback for this session.</p>
      ) : (
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); call('fb', () => api.post('/api/feedback', { session_id: s.id, rating: Number(fb.rating), comment: fb.comment || null })) }}>
          <div className="field" style={{ flex: 0, minWidth: 110 }}>
            <label htmlFor={`fb-r-${s.id}`}>Rating</label>
            <select id={`fb-r-${s.id}`} value={fb.rating} onChange={(e) => setFb({ ...fb, rating: e.target.value })}>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 3 }}>
            <label htmlFor={`fb-c-${s.id}`}>Feedback</label>
            <input id={`fb-c-${s.id}`} value={fb.comment} maxLength={1000} onChange={(e) => setFb({ ...fb, comment: e.target.value })} placeholder="How was the session?" />
          </div>
          <button className="btn" disabled={busy === 'fb'}>Submit feedback</button>
        </form>
      )}
    </>
  )
}

const SummaryList = ({ title, items }) =>
  items?.length ? (
    <div style={{ marginTop: 8 }}>
      <strong className="small">{title}</strong>
      <ul className="small" style={{ margin: '2px 0', paddingLeft: 18 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  ) : null
