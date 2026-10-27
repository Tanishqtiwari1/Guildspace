import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, errorText } from '../../api'
import { useAuth } from '../../auth.jsx'
import { useApi, Loading, ErrorBox, Empty, StatusBadge, Modal, fmtDateTime, fmtTime } from '../../components/ui.jsx'
import { useToast } from '../../components/feedback.jsx'
import Calendar from '../../components/Calendar.jsx'
import { AwaitingVerification } from './FacultyDashboard.jsx'

const today = () => new Date().toLocaleDateString('en-CA')

function ClassForm({ courses, initial, defaultCourse, onClose, onSaved }) {
  const [form, setForm] = useState(initial ? {
    course_id: String(initial.course.id), topic: initial.topic, date: initial.start_at.slice(0, 10),
    start: initial.start_at.slice(11, 16), end: initial.end_at.slice(11, 16), location: initial.location,
    description: initial.description || '', meeting_link: initial.meeting_link || '',
  } : { course_id: defaultCourse || String(courses[0]?.id || ''), topic: '', date: '', start: '16:00', end: '17:00', location: '', description: '', meeting_link: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const body = {
      course_id: Number(form.course_id), topic: form.topic, location: form.location,
      start_at: `${form.date}T${form.start}:00`, end_at: `${form.date}T${form.end}:00`,
      description: form.description || null, meeting_link: form.meeting_link || null,
    }
    try {
      const { data } = initial ? await api.put(`/api/faculty/extra-classes/${initial.id}`, body) : await api.post('/api/faculty/extra-classes', body)
      onSaved(data)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={initial ? 'Edit extra class' : 'Schedule an extra class'} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox>{error}</ErrorBox>
        <div className="field">
          <label htmlFor="x-course">Course</label>
          <select id="x-course" value={form.course_id} onChange={set('course_id')} disabled={!!initial} required>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} (Sec {c.section}, {c.student_count} students)</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="x-topic">Topic</label><input id="x-topic" required minLength={2} value={form.topic} onChange={set('topic')} placeholder="e.g. Linked Lists" /></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="x-date">Date</label><input id="x-date" type="date" required min={today()} value={form.date} onChange={set('date')} /></div>
          <div className="field"><label htmlFor="x-start">Start</label><input id="x-start" type="time" required value={form.start} onChange={set('start')} /></div>
          <div className="field"><label htmlFor="x-end">End</label><input id="x-end" type="time" required value={form.end} onChange={set('end')} /></div>
        </div>
        <div className="field"><label htmlFor="x-loc">Classroom / location</label><input id="x-loc" required value={form.location} onChange={set('location')} placeholder="e.g. Room AB2-304, or Online" /></div>
        <div className="field"><label htmlFor="x-link">Meeting link <span className="muted">(optional)</span></label><input id="x-link" type="url" value={form.meeting_link} onChange={set('meeting_link')} placeholder="https://…" /></div>
        <div className="field"><label htmlFor="x-desc">Description</label><textarea id="x-desc" maxLength={2000} value={form.description} onChange={set('description')} placeholder="What to prepare, what will be covered" /></div>
        <p className="muted small">{initial ? 'Enrolled students will be notified of the change.' : 'Every student enrolled in the course is notified when you publish.'}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Publishing…' : initial ? 'Save & notify' : 'Publish extra class'}</button>
        </div>
      </form>
    </Modal>
  )
}

function CancelDialog({ cls, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/api/faculty/extra-classes/${cls.id}/cancel`, { reason: reason || null })
      onDone()
    } catch (err) { setError(errorText(err)) }
  }
  return (
    <Modal title={`Cancel "${cls.topic}"?`} onClose={onClose}>
      <form onSubmit={submit}>
        <p>{cls.course.code} · {fmtDateTime(cls.start_at)}. All enrolled students will be notified.</p>
        <ErrorBox>{error}</ErrorBox>
        <div className="field"><label htmlFor="cx-reason">Reason <span className="muted">(shown to students)</span></label><input id="cx-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Keep class</button>
          <button className="btn danger">Cancel class</button>
        </div>
      </form>
    </Modal>
  )
}

export default function FacultyClasses() {
  const { user } = useAuth()
  const verified = user.faculty_profile?.verified
  const [params, setParams] = useSearchParams()
  const [scope, setScope] = useState('upcoming')
  const { data: courses } = useApi(verified ? '/api/faculty/courses' : null)
  const { data, loading, error, reload } = useApi(verified ? `/api/faculty/extra-classes?scope=${scope}` : null)
  const [editing, setEditing] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [calKey, setCalKey] = useState(0)
  const toast = useToast()
  const creating = params.get('new') === '1'
  const refresh = () => { reload(); setCalKey((k) => k + 1) }

  if (!verified) return <AwaitingVerification />
  const activeCourses = (courses || []).filter((c) => c.is_active)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Extra classes</h1>
          <p>Students enrolled in the course are notified and see the class on their dashboard and calendar.</p>
        </div>
        <button className="btn" disabled={!activeCourses.length} onClick={() => setParams({ new: '1' })}>+ Schedule extra class</button>
      </div>
      {courses && !activeCourses.length && <div className="alert warn"><span>Create a course first. <Link to="/faculty/courses?new=1">New course</Link></span></div>}

      <Calendar reloadKey={calKey} onSelect={(e) => { const x = data?.find((c) => c.id === e.id); if (x && x.status === 'SCHEDULED') setEditing(x) }} />

      <div className="tabs" style={{ marginTop: 20 }}>
        {['upcoming', 'past'].map((s) => <button key={s} className={`tab ${scope === s ? 'active' : ''}`} onClick={() => setScope(s)}>{s === 'upcoming' ? 'Upcoming' : 'Past'}</button>)}
      </div>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {loading && !data ? <Loading /> : data?.length === 0 ? <div className="card"><Empty title={scope === 'upcoming' ? 'No upcoming extra classes' : 'No past extra classes'} /></div> : (
        <div className="stack">
          {data?.map((x) => (
            <div key={x.id} className={`card class-card ${x.status === 'CANCELLED' ? 'cancelled' : ''}`}>
              <div className="date-chip">
                <span>{new Date(x.start_at).toLocaleDateString(undefined, { month: 'short' })}</span>
                <strong>{new Date(x.start_at).getDate()}</strong>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row between">
                  <strong>{x.course.name} — {x.topic}</strong>
                  <StatusBadge status={x.status} />
                </div>
                <div className="muted small">{fmtDateTime(x.start_at)} – {fmtTime(x.end_at)} · 📍 {x.location}{x.meeting_link && <> · <a href={x.meeting_link} target="_blank" rel="noreferrer">meeting link</a></>}</div>
                {x.description && <p className="small" style={{ margin: '6px 0 0' }}>{x.description}</p>}
                {x.status === 'CANCELLED' && x.cancel_reason && <p className="small muted" style={{ margin: '6px 0 0' }}>Reason: {x.cancel_reason}</p>}
                <div className="row" style={{ marginTop: 10 }}>
                  <span className="small muted">{x.added_to_schedule_count} student(s) added this to their schedule</span>
                  {x.status === 'SCHEDULED' && scope === 'upcoming' && (
                    <>
                      <button className="btn small ghost" onClick={() => setEditing(x)}>Edit</button>
                      <button className="btn small ghost" onClick={() => setCancelling(x)}>Cancel class</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && courses && (
        <ClassForm courses={editing ? courses : activeCourses} initial={editing} defaultCourse={params.get('course')}
          onClose={() => { setEditing(null); setParams({}) }}
          onSaved={(x) => { toast(editing ? 'Extra class updated; students notified' : `Published. ${x.course.code} students have been notified.`); setEditing(null); setParams({}); refresh() }} />
      )}
      {cancelling && <CancelDialog cls={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); toast('Class cancelled; students notified'); refresh() }} />}
    </>
  )
}
