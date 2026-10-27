import { useState } from 'react'
import { api, errorText } from '../api'
import { useAuth } from '../auth.jsx'
import { useApi, ErrorBox, Notice, Empty } from '../components/ui.jsx'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED']

export default function Profile() {
  const { user, refresh } = useAuth()
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)

  const run = async (fn, msg) => {
    setError(null)
    setSaved(null)
    try {
      await fn()
      await refresh()
      if (msg) setSaved(msg)
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My profile</h1>
          <p>{user.account_type === 'FACULTY' ? 'How students and colleagues see you.' : 'Your skills, availability and preferences drive your match scores.'}</p>
        </div>
      </div>
      <ErrorBox>{error}</ErrorBox>
      <Notice kind="success">{saved}</Notice>
      {user.account_type === 'FACULTY' ? (
        <div className="grid two">
          <ProfileForm user={user} onSave={(body) => run(() => api.put('/api/users/me', body), 'Profile saved.')} />
          <FacultyDetails user={user} onSave={(body) => run(() => api.put('/api/users/me', body), 'Faculty details saved.')} />
        </div>
      ) : (
        <>
          <div className="grid two">
            <ProfileForm user={user} onSave={(body) => run(() => api.put('/api/users/me', body), 'Profile saved.')} />
            <Availability user={user} run={run} />
          </div>
          <div className="grid two" style={{ marginTop: 16 }}>
            <SkillList user={user} type="OFFERED" title="Skills I can teach" run={run} />
            <SkillList user={user} type="NEEDED" title="Skills I want to learn" run={run} />
          </div>
        </>
      )}
    </>
  )
}

function ProfileForm({ user, onSave }) {
  const [form, setForm] = useState({ name: user.name, bio: user.bio || '', role: user.role, location: user.location || '', preferred_mode: user.preferred_mode })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); onSave({ ...form, location: form.location || null, bio: form.bio || null }) }}>
      <h2>About me</h2>
      <div className="field"><label htmlFor="p-name">Name</label><input id="p-name" required minLength={2} value={form.name} onChange={set('name')} /></div>
      <div className="field"><label htmlFor="p-bio">Short bio</label><textarea id="p-bio" maxLength={1000} value={form.bio} onChange={set('bio')} placeholder="What do you do, what are you working towards?" /></div>
      <div className="form-grid">
        {user.account_type !== 'FACULTY' && <div className="field">
          <label htmlFor="p-role">Role</label>
          <select id="p-role" value={form.role} onChange={set('role')}>
            <option value="BOTH">Learner and mentor</option><option value="LEARNER">Learner</option><option value="MENTOR">Mentor</option>
          </select>
        </div>}
        <div className="field">
          <label htmlFor="p-mode">Preferred mode</label>
          <select id="p-mode" value={form.preferred_mode} onChange={set('preferred_mode')}>
            <option value="EITHER">Either</option><option value="ONLINE">Online</option><option value="OFFLINE">Offline</option>
          </select>
        </div>
      </div>
      <div className="field"><label htmlFor="p-loc">City / locality</label><input id="p-loc" value={form.location} onChange={set('location')} /></div>
      <button className="btn">Save profile</button>
    </form>
  )
}

function FacultyDetails({ user, onSave }) {
  const fp = user.faculty_profile || {}
  const [form, setForm] = useState({ department: fp.department || '', designation: fp.designation || '' })
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); onSave(form) }}>
      <div className="row between"><h2 style={{ margin: 0 }}>Faculty details</h2>
        {fp.verified ? <span className="badge status-completed">verified</span> : <span className="badge status-pending">awaiting verification</span>}
      </div>
      <div className="field" style={{ marginTop: 12 }}><label htmlFor="f-dept">Department</label><input id="f-dept" required value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
      <div className="field"><label htmlFor="f-desig">Designation</label><input id="f-desig" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></div>
      {fp.employee_id && <p className="muted small">Employee ID: {fp.employee_id}</p>}
      <button className="btn">Save details</button>
    </form>
  )
}

function Availability({ user, run }) {
  const [slot, setSlot] = useState({ day_of_week: 'Monday', start_time: '18:00', end_time: '20:00' })
  const sorted = [...user.availability].sort((a, b) => DAYS.indexOf(a.day_of_week) - DAYS.indexOf(b.day_of_week) || a.start_time.localeCompare(b.start_time))
  return (
    <div className="card">
      <h2>Weekly availability</h2>
      <p className="muted small">Sessions can only be booked inside times that both people have marked as available.</p>
      {sorted.length === 0 ? <Empty title="No availability set" /> : (
        <div className="chips" style={{ marginBottom: 14 }}>
          {sorted.map((a) => (
            <span key={a.id} className="chip">
              {a.day_of_week.slice(0, 3)} {a.start_time}–{a.end_time}
              <button aria-label="Remove slot" onClick={() => run(() => api.delete(`/api/users/me/availability/${a.id}`))}>×</button>
            </span>
          ))}
        </div>
      )}
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); run(() => api.post('/api/users/me/availability', slot), 'Availability added.') }}>
        <div className="field">
          <label htmlFor="a-day">Day</label>
          <select id="a-day" value={slot.day_of_week} onChange={(e) => setSlot({ ...slot, day_of_week: e.target.value })}>
            {DAYS.map((d) => <option key={d}>{d}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="a-from">From</label><input id="a-from" type="time" value={slot.start_time} onChange={(e) => setSlot({ ...slot, start_time: e.target.value })} required /></div>
        <div className="field"><label htmlFor="a-to">To</label><input id="a-to" type="time" value={slot.end_time} onChange={(e) => setSlot({ ...slot, end_time: e.target.value })} required /></div>
        <button className="btn">Add</button>
      </form>
    </div>
  )
}

function SkillList({ user, type, title, run }) {
  const { data: catalog, reload: reloadCatalog } = useApi('/api/skills')
  const entries = user.skills.filter((s) => s.skill_type === type)
  const [form, setForm] = useState({ skill_id: '', level: type === 'OFFERED' ? 'INTERMEDIATE' : 'BEGINNER', goal: '', newName: '', newCategory: '' })
  const [editing, setEditing] = useState(null)

  // Default to the first catalogue skill until the user picks one.
  const skillValue = form.skill_id || (catalog?.length ? String(catalog[0].id) : '')

  const add = (e) => {
    e.preventDefault()
    run(async () => {
      let skillId = Number(skillValue)
      if (skillValue === 'new') {
        const { data } = await api.post('/api/skills', { name: form.newName, category: form.newCategory || 'General' })
        skillId = data.id
        reloadCatalog()
      }
      await api.post('/api/users/me/skills', { skill_id: skillId, skill_type: type, level: form.level, goal: type === 'NEEDED' ? form.goal || null : null })
      setForm((f) => ({ ...f, goal: '', newName: '', newCategory: '' }))
    }, 'Skill added. Your matches have been updated.')
  }

  return (
    <div className="card">
      <h2>{title}</h2>
      {entries.length === 0 ? <Empty title="None yet" /> : (
        <ul className="list" style={{ marginBottom: 12 }}>
          {entries.map((s) => (
            <li key={s.id}>
              {editing?.id === s.id ? (
                <form className="inline-form" onSubmit={(e) => { e.preventDefault(); run(() => api.put(`/api/users/me/skills/${s.id}`, { level: editing.level, goal: editing.goal || null }), 'Skill updated.').then((ok) => ok && setEditing(null)) }}>
                  <strong style={{ alignSelf: 'center' }}>{s.skill_name}</strong>
                  <div className="field">
                    <label>Level</label>
                    <select value={editing.level} onChange={(e) => setEditing({ ...editing, level: e.target.value })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
                  </div>
                  {type === 'NEEDED' && <div className="field"><label>Goal</label><input value={editing.goal} onChange={(e) => setEditing({ ...editing, goal: e.target.value })} /></div>}
                  <button className="btn small">Save</button>
                  <button type="button" className="btn small ghost" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <div className="row between">
                  <div>
                    <strong>{s.skill_name}</strong> <span className={`badge`}>{s.level.toLowerCase()}</span>
                    <div className="muted small">{s.category}{s.goal ? ` · Goal: ${s.goal}` : ''}</div>
                  </div>
                  <div className="row">
                    <button className="btn small ghost" onClick={() => setEditing({ id: s.id, level: s.level, goal: s.goal || '' })}>Edit</button>
                    <button className="btn small ghost" onClick={() => run(() => api.delete(`/api/users/me/skills/${s.id}`), 'Skill removed.')}>Remove</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add}>
        <div className="form-grid">
          <div className="field">
            <label>Skill</label>
            <select value={skillValue} onChange={(e) => setForm({ ...form, skill_id: e.target.value })} required>
              {(catalog || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="new">+ Add a new skill…</option>
            </select>
          </div>
          <div className="field">
            <label>{type === 'OFFERED' ? 'My proficiency' : 'Target level'}</label>
            <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
          </div>
        </div>
        {skillValue === 'new' && (
          <div className="form-grid">
            <div className="field"><label>New skill name</label><input required value={form.newName} onChange={(e) => setForm({ ...form, newName: e.target.value })} /></div>
            <div className="field"><label>Category</label><input value={form.newCategory} onChange={(e) => setForm({ ...form, newCategory: e.target.value })} placeholder="General" /></div>
          </div>
        )}
        {type === 'NEEDED' && (
          <div className="field"><label>Learning goal</label><input value={form.goal} maxLength={500} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="What do you want to be able to do?" /></div>
        )}
        <button className="btn">Add skill</button>
      </form>
    </div>
  )
}
