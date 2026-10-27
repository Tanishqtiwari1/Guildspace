import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, errorText } from '../../api'
import { useAuth } from '../../auth.jsx'
import { useApi, Loading, ErrorBox, Empty, Modal } from '../../components/ui.jsx'
import { useConfirm, useToast } from '../../components/feedback.jsx'
import { AwaitingVerification } from './FacultyDashboard.jsx'

const STATUS_LABEL = { DRAFT: 'Draft', PUBLISHED: 'Published', NOT_ENTERED: 'Not entered' }

export default function FacultyMarks() {
  const { user } = useAuth()
  const verified = user.faculty_profile?.verified
  const [params, setParams] = useSearchParams()
  const { data: courses } = useApi(verified ? '/api/faculty/courses' : null)
  const courseId = params.get('course') || String(courses?.[0]?.id || '')
  const { data: assessments, reload: reloadAssessments } = useApi(courseId ? `/api/faculty/courses/${courseId}/assessments` : null)
  const assessmentId = params.get('assessment') || String(assessments?.[assessments.length - 1]?.id || '')
  const [creating, setCreating] = useState(false)

  if (!verified) return <AwaitingVerification />
  const pick = (patch) => setParams(Object.fromEntries(Object.entries({ course: courseId, assessment: assessmentId, ...patch }).filter(([, v]) => v)))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Marks</h1>
          <p>Marks are private: each student sees only their own, and only after you publish.</p>
        </div>
      </div>
      {courses?.length === 0 ? <div className="card"><Empty title="Create a course first" /></div> : (
        <div className="card inline-form" style={{ marginBottom: 16 }}>
          <div className="field">
            <label htmlFor="m-course">Course</label>
            <select id="m-course" value={courseId} onChange={(e) => pick({ course: e.target.value, assessment: '' })}>
              {(courses || []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} (Sec {c.section})</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-asm">Assessment</label>
            <select id="m-asm" value={assessmentId} onChange={(e) => pick({ assessment: e.target.value })} disabled={!assessments?.length}>
              {!assessments?.length && <option>No assessments yet</option>}
              {(assessments || []).map((a) => <option key={a.id} value={a.id}>{a.name} (out of {a.max_marks}) · {a.marks_published}/{a.student_count} published</option>)}
            </select>
          </div>
          <button className="btn ghost" onClick={() => setCreating(true)} disabled={!courseId}>+ New assessment</button>
        </div>
      )}
      {assessmentId ? <MarksTable key={assessmentId} assessmentId={assessmentId} onChanged={reloadAssessments} /> : courses?.length ? (
        <div className="card"><Empty title="No assessment selected">Create an assessment such as MTE-1, Quiz 1 or Lab Record to start entering marks.</Empty></div>
      ) : null}
      {creating && (
        <NewAssessment courseId={courseId} onClose={() => setCreating(false)}
          onCreated={(a) => { setCreating(false); reloadAssessments(); pick({ assessment: String(a.id) }) }} />
      )}
    </>
  )
}

function NewAssessment({ courseId, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', max_marks: 25, assessment_date: '' })
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    try {
      const { data } = await api.post(`/api/faculty/courses/${courseId}/assessments`, { name: form.name, max_marks: Number(form.max_marks), assessment_date: form.assessment_date || null })
      onCreated(data)
    } catch (err) { setError(errorText(err)) }
  }
  return (
    <Modal title="New assessment" onClose={onClose}>
      <form onSubmit={submit}>
        <ErrorBox>{error}</ErrorBox>
        <div className="form-grid">
          <div className="field"><label htmlFor="na-name">Name</label><input id="na-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="MTE-1" /></div>
          <div className="field"><label htmlFor="na-max">Maximum marks</label><input id="na-max" type="number" min="1" step="0.5" required value={form.max_marks} onChange={(e) => setForm({ ...form, max_marks: e.target.value })} /></div>
          <div className="field"><label htmlFor="na-date">Date</label><input id="na-date" type="date" value={form.assessment_date} onChange={(e) => setForm({ ...form, assessment_date: e.target.value })} /></div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn">Create</button>
        </div>
      </form>
    </Modal>
  )
}

function MarksTable({ assessmentId, onChanged }) {
  const { data, loading, error, reload, setData } = useApi(`/api/faculty/assessments/${assessmentId}/marks`)
  const [edits, setEdits] = useState({})
  const [revising, setRevising] = useState(new Set())
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => { setEdits({}); setRevising(new Set()); setSelected(new Set()) }, [assessmentId])
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox onRetry={reload}>{error}</ErrorBox>
  const { assessment: a, rows } = data
  const max = a.max_marks

  const value = (r) => (r.student.id in edits ? edits[r.student.id].marks : r.marks_obtained ?? '')
  const remark = (r) => (r.student.id in edits ? edits[r.student.id].remarks : r.remarks ?? '')
  const editable = (r) => r.status !== 'PUBLISHED' || revising.has(r.student.id)
  const setEdit = (r, patch) => setEdits((e) => ({ ...e, [r.student.id]: { marks: value(r), remarks: remark(r), ...e[r.student.id], ...patch } }))
  const dirty = rows.filter((r) => r.student.id in edits && (String(edits[r.student.id].marks) !== String(r.marks_obtained ?? '') || (edits[r.student.id].remarks || '') !== (r.remarks || '')))
  const invalid = dirty.find((r) => { const v = edits[r.student.id].marks; return v !== '' && (isNaN(Number(v)) || Number(v) < 0 || Number(v) > max) })
  const drafts = rows.filter((r) => r.status === 'DRAFT' && r.marks_obtained != null)
  const published = rows.filter((r) => r.status === 'PUBLISHED')

  const done = (newData, msg) => {
    setData(newData)
    setEdits({}); setRevising(new Set()); setSelected(new Set())
    onChanged()
    if (msg) toast(msg)
  }

  const save = async () => {
    if (invalid) return toast(`${invalid.student.name}: marks must be between 0 and ${max}`, 'error')
    const revised = dirty.filter((r) => r.status === 'PUBLISHED')
    if (revised.length && !(await confirm({
      title: `Revise ${revised.length} published mark${revised.length === 1 ? '' : 's'}?`,
      body: <>These students can already see their marks. They will see the new value and get a "marks revised" notification. The change is recorded in the audit history.
        <ul className="small">{revised.map((r) => <li key={r.student.id}>{r.student.name}: {r.marks_obtained} → {edits[r.student.id].marks}</li>)}</ul></>,
      confirmLabel: 'Revise marks',
    }))) return
    setBusy(true)
    try {
      const entries = dirty.map((r) => ({ student_id: r.student.id, marks_obtained: edits[r.student.id].marks === '' ? null : Number(edits[r.student.id].marks), remarks: edits[r.student.id].remarks || null }))
      const res = await api.put(`/api/faculty/assessments/${assessmentId}/marks`, { entries, revise: revised.length > 0 })
      done(res.data, revised.length ? 'Marks revised' : `Saved ${entries.length} mark${entries.length === 1 ? '' : 's'} as draft`)
    } catch (err) { toast(errorText(err), 'error') } finally { setBusy(false) }
  }

  const publish = async () => {
    if (dirty.length) return toast('Save your changes before publishing', 'error')
    const ids = selected.size ? drafts.filter((r) => selected.has(r.student.id)).map((r) => r.student.id) : null
    const count = ids ? ids.length : drafts.length
    if (!count) return toast('No draft marks to publish', 'error')
    if (!(await confirm({
      title: `Publish ${a.name} marks for ${count} student${count === 1 ? '' : 's'}?`,
      body: 'Each student will be notified and will see only their own mark. You can unpublish later if a correction is needed.',
      confirmLabel: 'Publish marks',
    }))) return
    setBusy(true)
    try {
      const res = await api.post(`/api/faculty/assessments/${assessmentId}/publish`, { student_ids: ids })
      done(res.data, `Published ${res.data.published} mark${res.data.published === 1 ? '' : 's'}`)
    } catch (err) { toast(errorText(err), 'error') } finally { setBusy(false) }
  }

  const unpublish = async () => {
    const ids = selected.size ? published.filter((r) => selected.has(r.student.id)).map((r) => r.student.id) : null
    const count = ids ? ids.length : published.length
    if (!count) return toast('Nothing published to withdraw', 'error')
    if (!(await confirm({ title: `Unpublish ${count} mark${count === 1 ? '' : 's'}?`, body: 'Students will no longer see these marks and will be told they were withdrawn for revision.', confirmLabel: 'Unpublish', danger: true }))) return
    setBusy(true)
    try {
      const res = await api.post(`/api/faculty/assessments/${assessmentId}/unpublish`, { student_ids: ids })
      done(res.data, `Unpublished ${res.data.unpublished} mark${res.data.unpublished === 1 ? '' : 's'}`)
    } catch (err) { toast(errorText(err), 'error') } finally { setBusy(false) }
  }

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const entered = rows.filter((r) => r.marks_obtained != null)
  const avg = entered.length ? (entered.reduce((s, r) => s + r.marks_obtained, 0) / entered.length).toFixed(1) : '—'

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2 style={{ margin: 0 }}>{data.course.code} · {a.name}</h2>
          <div className="muted small">Out of {max} · {a.marks_entered}/{a.student_count} entered · {a.marks_published} published · class average {avg} (visible only to you)</div>
        </div>
        <div className="row">
          {selected.size > 0 && <span className="small muted">{selected.size} selected</span>}
          <button className="btn ghost" onClick={unpublish} disabled={busy || !published.length}>Unpublish{selected.size ? ' selected' : ''}</button>
          <button className="btn ghost" onClick={save} disabled={busy || !dirty.length}>{dirty.some((r) => r.status === 'PUBLISHED') ? 'Save revision' : `Save draft${dirty.length ? ` (${dirty.length})` : ''}`}</button>
          <button className="btn" onClick={publish} disabled={busy || !drafts.length || dirty.length > 0}>Publish{selected.size ? ' selected' : ` all (${drafts.length})`}</button>
        </div>
      </div>
      {rows.length === 0 ? <Empty title="No students enrolled in this course" /> : (
        <div className="table-wrap">
          <table className="marks-table">
            <thead><tr><th style={{ width: 28 }}><input type="checkbox" aria-label="Select all" style={{ width: 'auto' }} checked={selected.size === rows.length} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.student.id)) : new Set())} /></th><th>Student</th><th>Section</th><th style={{ width: 130 }}>Marks</th><th>Remarks</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const v = value(r)
                const bad = v !== '' && (isNaN(Number(v)) || Number(v) < 0 || Number(v) > max)
                return (
                  <tr key={r.student.id} className={r.student.id in edits ? 'dirty' : ''}>
                    <td><input type="checkbox" aria-label={`Select ${r.student.name}`} style={{ width: 'auto' }} checked={selected.has(r.student.id)} onChange={() => toggle(r.student.id)} /></td>
                    <td><strong>{r.student.name}</strong><div className="muted small">{r.student.email}</div></td>
                    <td><span className="badge">{r.section}</span></td>
                    <td>
                      {editable(r) ? (
                        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          <input className={`mark-input ${bad ? 'invalid' : ''}`} type="number" min="0" max={max} step="0.5" value={v}
                            onChange={(e) => setEdit(r, { marks: e.target.value })} aria-label={`Marks for ${r.student.name}`} />
                          <span className="muted">/ {max}</span>
                        </span>
                      ) : <strong>{r.marks_obtained} <span className="muted">/ {max}</span></strong>}
                    </td>
                    <td>{editable(r) ? <input value={remark(r)} maxLength={500} onChange={(e) => setEdit(r, { remarks: e.target.value })} aria-label={`Remarks for ${r.student.name}`} /> : <span className="small">{r.remarks || '—'}</span>}</td>
                    <td>
                      <span className={`badge mark-${r.status.toLowerCase()}`}>{STATUS_LABEL[r.status]}</span>
                      {r.revisions > 0 && <div className="muted small">revised ×{r.revisions}</div>}
                    </td>
                    <td>{r.status === 'PUBLISHED' && !revising.has(r.student.id) && (
                      <button className="btn small ghost" onClick={() => setRevising((s) => new Set(s).add(r.student.id))}>Revise</button>
                    )}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
