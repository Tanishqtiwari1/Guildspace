import { useState } from 'react'
import { api, errorText } from '../../api'
import { useAuth } from '../../auth.jsx'
import { useApi, Loading, ErrorBox, Empty, timeAgo } from '../../components/ui.jsx'
import { useConfirm, useToast } from '../../components/feedback.jsx'
import { AwaitingVerification, audience } from './FacultyDashboard.jsx'

const CATEGORIES = [['GENERAL', 'General'], ['EXTRA_CLASS', 'Extra class'], ['ASSIGNMENT', 'Assignment reminder'], ['EXAM', 'Exam information'], ['NOTICE', 'Important academic notice']]
export const categoryLabel = (c) => CATEGORIES.find(([k]) => k === c)?.[1] ?? c

export default function FacultyAnnouncements() {
  const { user } = useAuth()
  const verified = user.faculty_profile?.verified
  const { data: courses } = useApi(verified ? '/api/faculty/courses' : null)
  const { data: sent, loading, error, reload } = useApi(verified ? '/api/faculty/announcements' : null)
  const [form, setForm] = useState({ course_id: '', target_type: 'COURSE', target_section: '', target_student_id: '', category: 'GENERAL', title: '', body: '', is_important: false })
  const courseId = form.course_id || String(courses?.find((c) => c.is_active)?.id || '')
  const { data: detail } = useApi(courseId ? `/api/faculty/courses/${courseId}` : null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  if (!verified) return <AwaitingVerification />

  const recipients = !detail ? 0 : form.target_type === 'COURSE' ? detail.students.length
    : form.target_type === 'SECTION' ? detail.students.filter((s) => s.section === form.target_section).length : (form.target_student_id ? 1 : 0)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const body = {
        course_id: Number(courseId), target_type: form.target_type, category: form.category, title: form.title, body: form.body, is_important: form.is_important,
        target_section: form.target_type === 'SECTION' ? form.target_section : null,
        target_student_id: form.target_type === 'STUDENT' ? Number(form.target_student_id) : null,
      }
      const { data } = await api.post('/api/faculty/announcements', body)
      toast(`Announcement sent to ${data.recipient_count} student${data.recipient_count === 1 ? '' : 's'}`)
      setForm({ ...form, title: '', body: '', is_important: false })
      reload()
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a) => {
    if (!(await confirm({ title: 'Delete announcement?', body: `"${a.title}" will disappear for students. Notifications already sent are not recalled.`, confirmLabel: 'Delete', danger: true }))) return
    try { await api.delete(`/api/faculty/announcements/${a.id}`); toast('Announcement deleted'); reload() } catch (err) { toast(errorText(err), 'error') }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Announcements</h1>
          <p>Post to a whole course, one section, or a single student. Recipients are notified immediately.</p>
        </div>
      </div>
      {courses?.length === 0 ? <div className="card"><Empty title="Create a course first" /></div> : (
        <form className="card" onSubmit={submit}>
          <h2>New announcement</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="an-course">Course</label>
              <select id="an-course" value={courseId} onChange={(e) => setForm({ ...form, course_id: e.target.value, target_section: '', target_student_id: '' })}>
                {(courses || []).filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="an-target">Send to</label>
              <select id="an-target" value={form.target_type} onChange={set('target_type')}>
                <option value="COURSE">Entire course</option><option value="SECTION">One section</option><option value="STUDENT">Individual student</option>
              </select>
            </div>
            {form.target_type === 'SECTION' && (
              <div className="field">
                <label htmlFor="an-sec">Section</label>
                <select id="an-sec" required value={form.target_section} onChange={set('target_section')}>
                  <option value="">Choose…</option>
                  {(detail?.sections || []).map((s) => <option key={s} value={s}>Section {s} ({detail.students.filter((x) => x.section === s).length})</option>)}
                </select>
              </div>
            )}
            {form.target_type === 'STUDENT' && (
              <div className="field">
                <label htmlFor="an-stu">Student</label>
                <select id="an-stu" required value={form.target_student_id} onChange={set('target_student_id')}>
                  <option value="">Choose…</option>
                  {(detail?.students || []).map((s) => <option key={s.student.id} value={s.student.id}>{s.student.name} ({s.section})</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="an-cat">Type</label>
              <select id="an-cat" value={form.category} onChange={set('category')}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </div>
          </div>
          <div className="field"><label htmlFor="an-title">Title</label><input id="an-title" required minLength={3} maxLength={150} value={form.title} onChange={set('title')} placeholder="e.g. Assignment 2 due Friday" /></div>
          <div className="field"><label htmlFor="an-body">Message</label><textarea id="an-body" required minLength={3} maxLength={5000} value={form.body} onChange={set('body')} /></div>
          <div className="row between">
            <label className="row" style={{ fontWeight: 400, margin: 0 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.is_important} onChange={(e) => setForm({ ...form, is_important: e.target.checked })} /> Mark as important
            </label>
            <div className="row">
              <span className="muted small">{recipients} recipient{recipients === 1 ? '' : 's'}</span>
              <button className="btn" disabled={busy || !recipients}>{busy ? 'Sending…' : 'Publish announcement'}</button>
            </div>
          </div>
        </form>
      )}

      <h2 style={{ marginTop: 24 }}>Sent</h2>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {loading && !sent ? <Loading /> : sent?.length === 0 ? <div className="card"><Empty title="No announcements yet" /></div> : (
        <div className="stack">
          {sent?.map((a) => (
            <div key={a.id} className={`card announcement ${a.is_important ? 'important' : ''}`}>
              <div className="row between">
                <strong>{a.is_important && '❗ '}{a.title}</strong>
                <button className="btn small ghost" onClick={() => remove(a)}>Delete</button>
              </div>
              <div className="muted small">{a.course.code} · {categoryLabel(a.category)} · {audience(a)} · {timeAgo(a.created_at)}</div>
              <p className="small" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{a.body}</p>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
