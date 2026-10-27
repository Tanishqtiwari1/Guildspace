import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { errorText } from '../api'
import { ErrorBox } from '../components/ui.jsx'
import { AuthHero } from './Login.jsx'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'BOTH', location: '', preferred_mode: 'EITHER',
    account_type: 'STUDENT', department: '', designation: '', employee_id: '' })
  const isFaculty = form.account_type === 'FACULTY'
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { department, designation, employee_id, ...base } = form
      await register({ ...base, location: form.location || null, ...(isFaculty ? { department, designation, employee_id, role: 'MENTOR' } : {}) })
      navigate(isFaculty ? '/' : '/profile')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <AuthHero />
      <div className="auth-form">
        <form className="card" onSubmit={submit}>
          <h2 style={{ fontSize: 24 }}>Join Guildspace</h2>
          <p className="muted">{isFaculty ? 'Faculty accounts are verified by an administrator.' : 'You can be a mentor, a learner, or both.'}</p>
          <ErrorBox>{error}</ErrorBox>
          <div className="segmented" role="radiogroup" aria-label="Account type">
            {[['STUDENT', 'Student'], ['FACULTY', 'Faculty']].map(([v, label]) => (
              <button type="button" key={v} role="radio" aria-checked={form.account_type === v}
                className={form.account_type === v ? 'active' : ''} onClick={() => setForm({ ...form, account_type: v })}>{label}</button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" required minLength={2} value={form.name} onChange={set('name')} />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
          </div>
          <div className="field">
            <label htmlFor="password">Password <span className="muted">(min 8 characters)</span></label>
            <input id="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={form.password} onChange={set('password')} />
          </div>
          {isFaculty ? (
            <>
              <div className="field">
                <label htmlFor="dept">Department</label>
                <input id="dept" required value={form.department} onChange={set('department')} placeholder="e.g. Computer Science" />
              </div>
              <div className="form-grid">
                <div className="field"><label htmlFor="desig">Designation</label><input id="desig" value={form.designation} onChange={set('designation')} placeholder="e.g. Assistant Professor" /></div>
                <div className="field"><label htmlFor="emp">Employee ID</label><input id="emp" value={form.employee_id} onChange={set('employee_id')} /></div>
              </div>
            </>
          ) : (
          <div className="form-grid">
            <div className="field">
              <label htmlFor="role">I want to</label>
              <select id="role" value={form.role} onChange={set('role')}>
                <option value="BOTH">Learn and teach</option>
                <option value="LEARNER">Learn</option>
                <option value="MENTOR">Teach</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="mode">Preferred mode</label>
              <select id="mode" value={form.preferred_mode} onChange={set('preferred_mode')}>
                <option value="EITHER">Online or offline</option>
                <option value="ONLINE">Online</option>
                <option value="OFFLINE">Offline (in person)</option>
              </select>
            </div>
          </div>
          )}
          <div className="field">
            <label htmlFor="location">City / locality</label>
            <input id="location" value={form.location} onChange={set('location')} placeholder="e.g. Jaipur" />
          </div>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          <p className="muted small" style={{ marginTop: 14, textAlign: 'center' }}>
            Already registered? <Link to="/login">Log in</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
