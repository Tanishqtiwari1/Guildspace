import { Link, useParams } from 'react-router-dom'
import { useApi, Loading, ErrorBox, Empty, Stars, timeAgo } from '../components/ui.jsx'
import { Icon, Logo } from '../components/brand.jsx'
import { useAuth } from '../auth.jsx'

/** Verified learning record: only sessions both people confirmed, plus mentor endorsements. Printable to PDF. */
export default function LearningRecord() {
  const { id } = useParams()
  const { user } = useAuth()
  const { data: r, loading, error } = useApi(`/api/users/${id}/record`)
  if (loading && !r) return <Loading />
  if (error) return <ErrorBox>{error}</ErrorBox>
  const rel = r.reliability
  const mine = Number(id) === user.id

  return (
    <div className="record">
      <div className="page-head no-print">
        <div>
          <div className="eyebrow"><Icon name="verified" size={14} /> Verified learning record</div>
          <h1>{mine ? 'Your learning record' : `${r.user.name}'s learning record`}</h1>
          <p>Built only from sessions both participants confirmed. Academic marks are never included.</p>
        </div>
        <div className="row">
          {!mine && <Link className="btn ghost" to={`/users/${id}`}>Profile</Link>}
          <button className="btn" onClick={() => window.print()}><Icon name="download" /> Save as PDF</button>
        </div>
      </div>

      <div className="card record-sheet">
        <div className="row between" style={{ marginBottom: 18 }}>
          <div className="row" style={{ gap: 12 }}>
            <Logo size={44} />
            <div>
              <h2 style={{ margin: 0, fontSize: 22 }}>{r.user.name}</h2>
              <div className="muted small">{r.user.location || '—'} · Guildspace member since {new Date(r.user.member_since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
            </div>
          </div>
          <span className="badge match"><Icon name="verified_user" size={16} /> Peer-verified</span>
        </div>

        <div className="stats" style={{ marginBottom: 20 }}>
          <Stat label="Hours taught" value={r.hours_taught} />
          <Stat label="Hours learned" value={r.hours_learned} />
          <Stat label="Sessions completed" value={r.sessions_completed} />
          <Stat label="Reliability" value={rel.score != null ? `${rel.score}%` : '—'} sub={rel.events ? `${rel.kept} of ${rel.events} kept` : 'no history yet'} />
          <div className="stat"><div className="label">Rating</div><div className="value" style={{ fontSize: 18 }}><Stars value={r.rating.avg} /></div><div className="small muted">{r.rating.count} review(s)</div></div>
        </div>

        <h3 className="upper" style={{ marginBottom: 10 }}>Skills, by confirmed hours</h3>
        {r.skills.length === 0 ? <Empty title="No confirmed sessions yet" /> : (
          <div className="table-wrap" style={{ marginBottom: 20 }}>
            <table>
              <thead><tr><th>Skill</th><th>Role</th><th>Sessions</th><th>Hours</th><th>With</th></tr></thead>
              <tbody>
                {r.skills.map((s) => (
                  <tr key={`${s.skill}-${s.role}`}>
                    <td><strong>{s.skill}</strong></td>
                    <td><span className={`chip ${s.role === 'taught' ? 'teach' : 'want'}`}>{s.role}</span></td>
                    <td className="mono">{s.sessions}</td>
                    <td className="mono">{s.hours}</td>
                    <td className="small muted">{s.partners.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="upper" style={{ marginBottom: 10 }}>Mentor endorsements</h3>
        {r.endorsements.length === 0 ? <Empty title="No endorsements yet">Mentors can endorse a learner's level after a confirmed session.</Empty> : (
          <div className="grid two" style={{ gap: 12 }}>
            {r.endorsements.map((e) => (
              <div key={e.id} className="inner-box">
                <div className="row between"><strong>{e.skill}</strong><span className="badge status-completed"><Icon name="workspace_premium" size={14} /> {e.level.toLowerCase()}</span></div>
                {e.note && <p className="small" style={{ margin: '6px 0' }}>“{e.note}”</p>}
                <div className="small muted">Endorsed by {e.endorser.name} · {timeAgo(e.created_at)}</div>
              </div>
            ))}
          </div>
        )}
        <p className="small muted" style={{ marginTop: 20, marginBottom: 0 }}><Icon name="lock" size={14} /> {r.verification} Generated {new Date().toLocaleDateString()}.</p>
      </div>
    </div>
  )
}

const Stat = ({ label, value, sub }) => (
  <div className="stat">
    <div className="label">{label}</div>
    <div className="value">{value}</div>
    {sub && <div className="small muted">{sub}</div>}
  </div>
)
