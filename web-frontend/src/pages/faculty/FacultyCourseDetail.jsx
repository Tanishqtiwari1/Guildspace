import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, errorText } from '../../api'
import { useApi, Loading, ErrorBox, Empty, Avatar } from '../../components/ui.jsx'
import { useConfirm, useToast } from '../../components/feedback.jsx'
import { CourseForm } from './FacultyCourses.jsx'

export default function FacultyCourseDetail() {
  const { id } = useParams()
  const { data: c, loading, error, reload } = useApi(`/api/faculty/courses/${id}`)
  const [editing, setEditing] = useState(false)
  const [add, setAdd] = useState({ email: '', section: '' })
  const [sectionFilter, setSectionFilter] = useState('')
  const toast = useToast()
  const confirm = useConfirm()

  if (loading && !c) return <Loading />
  if (error) return <ErrorBox onRetry={reload}>{error}</ErrorBox>

  const call = async (fn, msg) => {
    try { await fn(); if (msg) toast(msg); reload() } catch (e) { toast(errorText(e), 'error') }
  }
  const addStudent = (e) => {
    e.preventDefault()
    call(async () => {
      await api.post(`/api/faculty/courses/${c.id}/students`, { email: add.email, section: add.section || null })
      setAdd({ email: '', section: '' })
    }, 'Student enrolled and notified')
  }
  const remove = async (s) => {
    if (await confirm({ title: `Remove ${s.student.name}?`, body: `They will lose access to ${c.code} classes and announcements. Published marks stay on their record.`, confirmLabel: 'Remove', danger: true })) {
      call(() => api.delete(`/api/faculty/courses/${c.id}/students/${s.student.id}`), `${s.student.name} removed`)
    }
  }
  const regenerate = async () => {
    if (await confirm({ title: 'Generate a new join code?', body: 'The old code will stop working. Students already enrolled are not affected.', confirmLabel: 'Generate' })) {
      call(() => api.post(`/api/faculty/courses/${c.id}/join-code`), 'New join code generated')
    }
  }
  const students = c.students.filter((s) => !sectionFilter || s.section === sectionFilter)

  return (
    <>
      <div className="page-head">
        <div>
          <div className="muted small"><Link to="/faculty/courses">My courses</Link> /</div>
          <h1>{c.code} · {c.name}</h1>
          <p>Semester {c.semester} · Section {c.section} · {c.academic_year} {!c.is_active && '· archived'}</p>
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => setEditing(true)}>Edit course</button>
          <Link className="btn ghost" to={`/faculty/marks?course=${c.id}`}>Marks</Link>
          <Link className="btn" to={`/faculty/classes?new=1&course=${c.id}`}>Schedule extra class</Link>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Join code</h2>
          <div className="join-code">{c.join_code}</div>
          <p className="muted small">Students enter this code under Academics → Courses to enrol in section {c.section}.</p>
          <div className="row">
            <button className="btn small ghost" onClick={() => navigator.clipboard?.writeText(c.join_code).then(() => toast('Join code copied'))}>Copy</button>
            <button className="btn small ghost" onClick={regenerate}>Generate new code</button>
          </div>
        </div>
        <form className="card" onSubmit={addStudent}>
          <h2>Add a student</h2>
          <p className="muted small">The student must already have a student account.</p>
          <div className="inline-form">
            <div className="field" style={{ flex: 3 }}><label htmlFor="s-email">Student email</label><input id="s-email" type="email" required value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="s-sec">Section</label><input id="s-sec" placeholder={c.section} maxLength={10} value={add.section} onChange={(e) => setAdd({ ...add, section: e.target.value })} /></div>
            <button className="btn">Add</button>
          </div>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>Enrolled students ({c.students.length})</h2>
          {c.sections.length > 1 && (
            <select style={{ width: 'auto' }} value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} aria-label="Filter by section">
              <option value="">All sections</option>
              {c.sections.map((s) => <option key={s} value={s}>Section {s}</option>)}
            </select>
          )}
        </div>
        {students.length === 0 ? <Empty title="No students enrolled yet">Share the join code {c.join_code} with your class.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Student</th><th>Email</th><th>Section</th><th>Enrolled</th><th /></tr></thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.student.id}>
                    <td><span className="row"><Avatar name={s.student.name} size={28} />{s.student.name}</span></td>
                    <td className="muted">{s.student.email}</td>
                    <td><span className="badge">{s.section}</span></td>
                    <td className="muted">{new Date(s.enrolled_at).toLocaleDateString()}</td>
                    <td className="row" style={{ justifyContent: 'flex-end' }}>
                      <Link className="btn small ghost" to={`/messages/${s.student.id}`}>Message</Link>
                      <button className="btn small ghost" onClick={() => remove(s)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h2>Assessments</h2><Link className="small" to={`/faculty/marks?course=${c.id}`}>Manage marks</Link></div>
        {c.assessments.length === 0 ? <Empty title="No assessments yet" /> : (
          <div className="chips">
            {c.assessments.map((a) => (
              <Link key={a.id} className="chip" to={`/faculty/marks?course=${c.id}&assessment=${a.id}`}>
                {a.name} · {a.marks_published}/{a.student_count} published
              </Link>
            ))}
          </div>
        )}
      </div>
      {editing && <CourseForm course={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast('Course updated'); reload() }} />}
    </>
  )
}
