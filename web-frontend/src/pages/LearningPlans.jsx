import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorText } from '../api'
import { useAuth } from '../auth.jsx'
import { useApi, Loading, ErrorBox, Empty, SourceBadge, Notice } from '../components/ui.jsx'

export default function LearningPlans() {
  const { user } = useAuth()
  const needed = user.skills.filter((s) => s.skill_type === 'NEEDED')
  const { data: plans, loading, error, reload } = useApi('/api/ai/learning-plans')
  const { data: status } = useApi('/api/ai/status')
  const [form, setForm] = useState(() => ({ skill_id: needed[0] ? String(needed[0].skill_id) : '', goal: needed[0]?.goal || '' }))
  const [busy, setBusy] = useState(false)
  const [genError, setGenError] = useState(null)

  const generate = async (e) => {
    e.preventDefault()
    setBusy(true)
    setGenError(null)
    try {
      await api.post('/api/ai/learning-plans', { skill_id: Number(form.skill_id), goal: form.goal })
      reload()
    } catch (err) {
      setGenError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Learning plans</h1>
          <p>Week-by-week plans built from your goal, target level, availability and mentor.</p>
        </div>
      </div>
      {status && !status.ai_enabled && (
        <Notice kind="warn">AI is not configured on the server (no ANTHROPIC_API_KEY), so plans are built by rules from your saved data and labelled that way.</Notice>
      )}
      {needed.length === 0 ? (
        <div className="card"><Empty title="Add a skill you want to learn first"><Link to="/profile">Go to profile</Link></Empty></div>
      ) : (
        <form className="card inline-form" onSubmit={generate}>
          <div className="field">
            <label htmlFor="lp-skill">Skill</label>
            <select id="lp-skill" value={form.skill_id} onChange={(e) => {
              const n = needed.find((s) => String(s.skill_id) === e.target.value)
              setForm({ skill_id: e.target.value, goal: n?.goal || '' })
            }}>
              {needed.map((s) => <option key={s.skill_id} value={s.skill_id}>{s.skill_name} (target {s.level.toLowerCase()})</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 3 }}>
            <label htmlFor="lp-goal">Goal</label>
            <input id="lp-goal" required minLength={3} maxLength={500} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="e.g. Build a dashboard of my expenses" />
          </div>
          <button className="btn" disabled={busy}>{busy ? 'Generating…' : '✦ Generate plan'}</button>
        </form>
      )}
      <div style={{ marginTop: 16 }}>
        <ErrorBox>{genError}</ErrorBox>
        <ErrorBox onRetry={reload}>{error}</ErrorBox>
        {busy && <Notice>Generating your plan. AI generation can take up to a minute.</Notice>}
        {loading && !plans ? <Loading /> : plans?.length === 0 ? <div className="card"><Empty title="No plans yet" /></div> : (
          <div className="stack">{plans?.map((p) => <PlanCard key={p.id} plan={p} reload={reload} />)}</div>
        )}
      </div>
    </>
  )
}

function PlanCard({ plan, reload }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(plan.content)
  const [error, setError] = useState(null)
  const c = plan.content

  const save = async () => {
    try {
      await api.put(`/api/ai/learning-plans/${plan.id}`, { content: draft })
      setEditing(false)
      reload()
    } catch (e) {
      setError(errorText(e))
    }
  }
  const remove = async () => {
    if (!window.confirm('Delete this plan?')) return
    try { await api.delete(`/api/ai/learning-plans/${plan.id}`); reload() } catch (e) { setError(errorText(e)) }
  }
  const setWeek = (i, patch) => setDraft({ ...draft, weeks: draft.weeks.map((w, j) => (j === i ? { ...w, ...patch } : w)) })

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{c.title}</h2>
          <div className="muted small">{plan.skill.name} · created {new Date(plan.created_at).toLocaleDateString()}</div>
        </div>
        <SourceBadge source={plan.source} />
      </div>
      <ErrorBox>{error}</ErrorBox>
      <p>{c.overview}</p>
      <p className="muted small">Generated guidance is a suggestion, not a guaranteed outcome. Edit it to fit you.</p>
      {(editing ? draft : c).weeks.map((w, i) => (
        <div key={i} className="week">
          {editing ? (
            <>
              <input value={w.focus} onChange={(e) => setWeek(i, { focus: e.target.value })} aria-label={`Week ${w.week} focus`} style={{ fontWeight: 600, marginBottom: 6 }} />
              <textarea value={w.activities.join('\n')} onChange={(e) => setWeek(i, { activities: e.target.value.split('\n') })} aria-label={`Week ${w.week} activities`} />
              <input value={w.milestone} onChange={(e) => setWeek(i, { milestone: e.target.value })} aria-label={`Week ${w.week} milestone`} style={{ marginTop: 6 }} />
            </>
          ) : (
            <>
              <strong>Week {w.week}: {w.focus}</strong>
              <ul className="small">{w.activities.filter(Boolean).map((a, j) => <li key={j}>{a}</li>)}</ul>
              <div className="small muted">Milestone: {w.milestone}</div>
            </>
          )}
        </div>
      ))}
      <div className="row">
        {editing ? (
          <>
            <button className="btn small" onClick={save}>Save changes</button>
            <button className="btn small ghost" onClick={() => { setDraft(c); setEditing(false) }}>Cancel</button>
          </>
        ) : (
          <>
            <button className="btn small ghost" onClick={() => { setDraft(c); setEditing(true) }}>Edit plan</button>
            <button className="btn small ghost" onClick={remove}>Delete</button>
          </>
        )}
      </div>
    </div>
  )
}
