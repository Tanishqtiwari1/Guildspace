import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, errorText } from '../../api'
import { useAuth } from '../../auth.jsx'
import { useApi, Loading, ErrorBox, Empty, Modal } from '../../components/ui.jsx'
import { useToast } from '../../components/feedback.jsx'
import { AwaitingVerification } from './FacultyDashboard.jsx'

const currentAcademicYear = () => {
  const d = new Date()
  const start = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1 // session starts in July
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

export function CourseForm({ course, onClose, onSaved }) {
  const [form, setForm] = useState(course
    ? { name: course.name, code: course.code, semester: course.semester, section: course.section, academic_year: course.academic_year, description: course.description || '', is_active: course.is_active }
    : { name: '', code: '', semester: 1, section: 'A', academic_year: currentAcademicYear(), description: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = { ...form, semester: Number(form.semester), description: form.description || null }
      const { data } = course ? await api.put(`/api/faculty/courses/${course.id}`, body) : await api.post('/api/faculty/courses', body)
      onSaved(data)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={course ? `Edit ${course.code}` : 'Create a course'} onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox>{error}</ErrorBox>
        <div className="field"><label htmlFor="c-name">Course name</label><input id="c-name" required minLength={2} value={form.name} onChange={set('name')} placeholder="e.g. Data Structures" /></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="c-code">Course code</label><input id="c-code" required value={form.code} onChange={set('code')} placeholder="CS201" /></div>
          <div className="field"><label htmlFor="c-sem">Semester</label>
            <select id="c-sem" value={form.semester} onChange={set('semester')}>{Array.from({ length: 10 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select>
          </div>
          <div className="field"><label htmlFor="c-sec">Section</label><input id="c-sec" required maxLength={10} value={form.section} onChange={set('section')} /></div>
          <div className="field"><label htmlFor="c-year">Academic year</label><input id="c-year" required pattern="\d{4}-\d{2}" title="e.g. 2026-27" value={form.academic_year} onChange={set('academic_year')} /></div>
        </div>
        <div className="field"><label htmlFor="c-desc">Description</label><textarea id="c-desc" maxLength={1000} value={form.description} onChange={set('description')} /></div>
        {course && (
          <label className="row" style={{ fontWeight: 400 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Course is active (uncheck to archive)
          </label>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : course ? 'Save changes' : 'Create course'}</button>
        </div>
      </form>
    </Modal>
  )
}

export default function FacultyCourses() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const { data, loading, error, reload } = useApi(user.faculty_profile?.verified ? '/api/faculty/courses' : null)
  const toast = useToast()
  const navigate = useNavigate()
  const creating = params.get('new') === '1'

  if (!user.faculty_profile?.verified) return <AwaitingVerification />
  return (
    <>
      <div className="page-head">
        <div>
          <h1>My courses</h1>
          <p>Students join with the course's join code, or you can add them by email.</p>
        </div>
        <button className="btn" onClick={() => setParams({ new: '1' })}>+ New course</button>
      </div>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {loading && !data ? <Loading /> : data?.length === 0 ? (
        <div className="card"><Empty title="You haven't created any courses">Create a course to schedule extra classes, post announcements and publish marks.</Empty></div>
      ) : (
        <div className="grid three">
          {data?.map((c) => (
            <Link key={c.id} to={`/faculty/courses/${c.id}`} className={`card course-card ${c.is_active ? '' : 'archived'}`}>
              <div className="row between">
                <span className="course-code">{c.code}</span>
                {c.is_active ? <span className="badge">Sem {c.semester}</span> : <span className="badge">archived</span>}
              </div>
              <h3 style={{ margin: '8px 0 4px' }}>{c.name}</h3>
              <div className="muted small">Section {c.section} · {c.academic_year}</div>
              <div className="row between" style={{ marginTop: 12 }}>
                <span className="small">👥 {c.student_count} student{c.student_count === 1 ? '' : 's'}</span>
                <span className="small muted">Code <strong className="mono">{c.join_code}</strong></span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && (
        <CourseForm onClose={() => setParams({})} onSaved={(c) => { toast(`${c.code} created`); navigate(`/faculty/courses/${c.id}`) }} />
      )}
    </>
  )
}
