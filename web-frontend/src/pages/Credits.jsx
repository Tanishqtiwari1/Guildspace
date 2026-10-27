import { Link } from 'react-router-dom'
import { useApi, Loading, ErrorBox, Empty, fmtDateTime, timeAgo } from '../components/ui.jsx'
import { Icon } from '../components/brand.jsx'

const KIND = {
  STARTER: ['Welcome credits', 'redeem', 'var(--primary)'],
  HOLD: ['Held for session', 'lock_clock', 'var(--warn)'],
  REFUND: ['Refunded', 'undo', 'var(--success)'],
  EARNED: ['Earned by teaching', 'school', 'var(--success)'],
  ADJUST: ['Admin adjustment', 'tune', 'var(--muted)'],
}

export default function Credits() {
  const { data, loading, error, reload } = useApi('/api/credits')
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox onRetry={reload}>{error}</ErrorBox>
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Icon name="toll" size={14} /> Time-credit ledger</div>
          <h1>Skill Credits</h1>
          <p>1 hour taught = 1 credit. Spend credits to learn from others; no money changes hands.</p>
        </div>
        <Link className="btn" to="/find"><Icon name="group_search" /> Find a mentor</Link>
      </div>

      <div className="stats">
        <Stat label="Available" value={data.balance} unit="credits" tone="primary" />
        <Stat label="On hold" value={data.held} unit="for upcoming sessions" />
        <Stat label="Earned teaching" value={data.earned_total} unit="credits" />
        <Stat label="Spent learning" value={data.spent_total} unit="credits" />
      </div>

      <div className="layout-rail">
        <div className="card">
          <div className="card-head"><h2 className="section-title"><Icon name="receipt_long" />Ledger</h2><span className="muted small">{data.transactions.length} entries</span></div>
          {data.transactions.length === 0 ? <Empty title="No activity yet" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Entry</th><th>Session</th><th style={{ textAlign: 'right' }}>Credits</th></tr></thead>
                <tbody>
                  {data.transactions.map((t) => {
                    const [label, icon, color] = KIND[t.kind] || [t.kind, 'circle', 'var(--muted)']
                    return (
                      <tr key={t.id}>
                        <td className="mono small muted">{timeAgo(t.created_at)}</td>
                        <td><span className="row" style={{ gap: 6 }}><Icon name={icon} size={18} style={{ color }} /><strong>{label}</strong></span>{t.note && <div className="small muted">{t.note}</div>}</td>
                        <td className="small">{t.session ? <>{t.session.skill} with {t.session.with}<div className="muted mono">{fmtDateTime(t.session.start_at)}</div></> : '—'}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: t.amount > 0 ? 'var(--success)' : 'var(--text)' }}>{t.amount > 0 ? '+' : ''}{t.amount}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card">
          <h2 className="section-title"><Icon name="info" />How credits work</h2>
          <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.7, margin: '8px 0 0' }}>
            <li>Every student starts with <strong>2 credits</strong>.</li>
            <li>Booking a session puts the learner's credits <strong>on hold</strong> (1 per hour).</li>
            <li>After the session, <strong>both people confirm</strong> it happened. Only then do the credits go to the mentor.</li>
            <li>If the session is cancelled, or the mentor doesn't show up, the held credits go <strong>back to the learner</strong>.</li>
            <li>If the learner doesn't show up, the mentor keeps the credits for the time they set aside.</li>
          </ol>
          <div className="inner-box small" style={{ marginTop: 14 }}>Running low? Add a skill you can teach on your <Link to="/profile">profile</Link>, or offer help with a course you've taken under <Link to="/academics?tab=rescue">Academics → Get help</Link>.</div>
        </div>
      </div>
    </>
  )
}

const Stat = ({ label, value, unit, tone }) => (
  <div className="stat">
    <div className="label">{label}</div>
    <div className="value" style={tone === 'primary' ? { color: 'var(--primary)' } : {}}>{value} <small>{unit}</small></div>
  </div>
)
