import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { errorText } from '../api'
import { ErrorBox } from '../components/ui.jsx'
import { Icon, Logo } from '../components/brand.jsx'

export function AuthHero() {
  return (
    <div className="auth-hero">
      <div className="row" style={{ gap: 12 }}><Logo size={44} /><strong style={{ fontSize: 22, letterSpacing: '-.02em' }}>Guildspace</strong></div>
      <span className="eyebrow" style={{ alignSelf: 'flex-start' }}><Icon name="verified" size={14} /> Peer learning · Faculty connected</span>
      <h1>Learn Something.<br /><span className="shimmer">Teach Something.</span><br />Grow Together.</h1>
      <p style={{ fontSize: 16, color: 'var(--text-2)', maxWidth: 520 }}>
        The peer-to-peer exchange where students trade practical skills, find compatible mentors, and stay connected with their faculty, all in one place.
      </p>
      <div className="steps">
        {[
          ['01', 'tune', 'List your skills', 'Tag what you can teach and what you want to learn, with your weekly availability.'],
          ['02', 'conversion_path', 'Reciprocity matching', 'Mentors are ranked by skill fit, shared free time, interaction mode, location and ratings.'],
          ['03', 'school', 'Stay in sync with faculty', 'Extra classes, announcements and your private marks arrive in your Academics hub.'],
        ].map(([n, icon, title, body]) => (
          <div key={n} className="step">
            <span className="step-num">{n}</span>
            <div><strong className="row" style={{ gap: 6 }}><Icon name={icon} size={18} style={{ color: 'var(--primary)' }} />{title}</strong><div className="small muted">{body}</div></div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Login() {
  const { login } = useAuth()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(form.email, form.password)
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
          <h2 style={{ fontSize: 24 }}>Welcome back</h2>
          <p className="muted">Log in to your Guildspace account</p>
          <ErrorBox>{error}</ErrorBox>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" required autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <button className="btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
          <p className="muted small" style={{ marginTop: 14, textAlign: 'center' }}>
            New here? <Link to="/register">Create an account</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
