import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorText } from '../api'
import { useApi, Loading, ErrorBox, Empty, ScoreRing, Avatar, StatusBadge, SourceBadge, fmtDateTime, timeAgo } from '../components/ui.jsx'
import { Icon } from '../components/brand.jsx'
import { useToast } from '../components/feedback.jsx'
import { RequestModal } from './FindMentors.jsx'

/** "in 2h 15m" style countdown from now to an ISO time. */
export function startsIn(iso) {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000)
  if (mins <= 0) return 'now'
  if (mins < 60) return `in ${mins}m`
  if (mins < 24 * 60) return `in ${Math.floor(mins / 60)}h ${mins % 60}m`
  return `in ${Math.floor(mins / 1440)}d`
}
const firstName = (n) => n.split(' ')[0]

export default function Dashboard() {
  const { data, loading, error, reload } = useApi('/api/dashboard')
  const { data: academics } = useApi('/api/academics/overview')
  const [requesting, setRequesting] = useState(null)
  const toast = useToast()

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox onRetry={reload}>{error}</ErrorBox>
  const { user, stats, profile_completion: pc } = data
  const top = data.top_mentor_matches[0]
  const next = data.upcoming_sessions[0]
  const facultyUpdates = academics ? academics.announcements.length + academics.upcoming_classes.length : 0

  const respond = async (id, action) => {
    try {
      await api.patch(`/api/requests/${id}`, { action })
      toast(action === 'ACCEPT' ? 'Request accepted. You can now schedule a session.' : 'Request declined')
      reload()
    } catch (e) { toast(errorText(e), 'error') }
  }

  return (
    <>
      {/* Welcome */}
      <div className="card welcome">
        <div>
          <h1>Welcome back, <span className="shimmer">{firstName(user.name)}!</span> 👋 <span className="live-pill"><span className="live-dot" />Live on Guildspace</span></h1>
          <div className="meta">
            <Icon name="school" size={18} style={{ color: 'var(--primary)' }} />
            {user.location || 'Location not set'} · {user.role === 'BOTH' ? 'Learner & mentor' : user.role.toLowerCase()} ·
            <span><strong style={{ color: 'var(--text)' }}>{stats.pending_incoming} incoming request{stats.pending_incoming === 1 ? '' : 's'}</strong></span>
            {facultyUpdates > 0 && <span>& <Link to="/academics" className="hl">{facultyUpdates} faculty update{facultyUpdates === 1 ? '' : 's'}</Link></span>}
          </div>
        </div>
        <div className="mini-stats">
          <Link to="/credits" style={{ color: 'inherit', textDecoration: 'none' }}><MiniStat label="Credits" value={stats.credits} unit="available" /></Link>
          <MiniStat label="Hours" value={stats.hours_learning + stats.hours_mentoring} unit="hrs" />
          <Link to={`/record/${user.id}`} style={{ color: 'inherit', textDecoration: 'none' }}><MiniStat label="Reliability" value={stats.reliability.score != null ? `${stats.reliability.score}%` : '—'} unit={stats.reliability.events ? `${stats.reliability.kept}/${stats.reliability.events} kept` : 'new'} /></Link>
          <MiniStat label="Mentorships" value={stats.active_mentorships} unit="active" />
          <MiniStat label="Rating" value={stats.avg_rating != null ? stats.avg_rating : '—'} unit={stats.avg_rating != null ? `★ (${stats.rating_count})` : 'no ratings'} />
          <Link to="/profile" className="mini-stat ring-stat" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div><div className="label">Profile</div><div className="value" style={{ fontSize: 15 }}>{pc.percent}% <small>ready</small></div></div>
            <ScoreRing score={pc.percent} size={40} />
          </Link>
        </div>
      </div>

      {stats.awaiting_my_confirmation > 0 && (
        <div className="alert warn">
          <span><Icon name="pending_actions" size={18} /> {stats.awaiting_my_confirmation} session{stats.awaiting_my_confirmation === 1 ? '' : 's'} need your confirmation. Credits move only after you both confirm.</span>
          <Link to="/sessions" className="btn small">Confirm now</Link>
        </div>
      )}

      {pc.missing.length > 0 && (
        <div className="alert info">
          <span><Icon name="tips_and_updates" size={18} /> Complete your profile for better matches: {pc.missing.join(' · ')}</span>
          <Link to="/profile" className="btn small ghost">Update profile</Link>
        </div>
      )}

      {/* Top match hero */}
      <div className="hero-match">
        {top ? (
          <>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row">
                <span className="chip-dark"><Icon name="auto_awesome" size={16} /> TOP MATCH FOR YOU</span>
                {top.shared_slots.length > 0 && <span className="chip-dark green">● Shared free time</span>}
              </div>
              <div className="sub">Compatibility engine · {top.compatibility_score}% fit across {top.factors.length} factors</div>
              <div className="row" style={{ gap: 16 }}>
                <Avatar name={top.mentor_name} size={64} />
                <div style={{ minWidth: 0 }}>
                  <div className="row"><h2>{top.mentor_name}</h2><span className="tagbox">{top.mentor_level?.toLowerCase()} · {top.skill_name}</span>
                    {top.avg_rating != null && <span style={{ color: '#FCD34D', fontWeight: 700 }}>★ {top.avg_rating.toFixed(1)} ({top.rating_count} reviews)</span>}</div>
                  <div className="pillbar">
                    <span className="teach"><Icon name="school" size={18} /> Teaches: {top.mentor_teaches.map((s) => s.name).join(', ')}</span>
                    {top.mentor_wants.length > 0 && <><span style={{ opacity: .5 }}>⇋</span><span className="want"><Icon name="person_check" size={18} /> Wants: {top.mentor_wants.map((s) => s.name).join(', ')}</span></>}
                  </div>
                  <div className="free"><Icon name="schedule" size={18} /> {top.shared_slots[0]
                    ? <><strong>Both free:</strong> {top.shared_slots[0].day} {top.shared_slots[0].start}–{top.shared_slots[0].end} · {top.location || 'location not set'} · {top.mode.toLowerCase()}</>
                    : 'No overlapping availability yet. Add time slots on your profile.'}</div>
                </div>
              </div>
            </div>
            <div className="hero-side">
              <div className="hero-ring">
                <ScoreRing score={top.compatibility_score} size={76} />
                <div>
                  <strong style={{ fontSize: 17 }}>{top.compatibility_score >= 80 ? 'High compatibility' : top.compatibility_score >= 55 ? 'Good compatibility' : 'Partial match'}</strong>
                  <div style={{ color: '#C7D2FE', fontSize: 13 }}>{top.mutual_skills.length ? `Two-way swap: ${top.mutual_skills.join(', ')}` : `${Math.round(top.overlap_minutes / 60 * 10) / 10} h/week overlap`}</div>
                </div>
              </div>
              <div className="row">
                <button className="btn white" onClick={() => setRequesting(top)}><Icon name="send" /> Request Mentorship</button>
                <Link className="btn glass" to={`/find?skill=${top.skill_id}`}>Breakdown <Icon name="arrow_forward" /></Link>
              </div>
            </div>
          </>
        ) : (
          <div className="hero-empty">
            <span className="chip-dark"><Icon name="auto_awesome" size={16} /> MATCH ENGINE</span>
            <h2 style={{ marginTop: 12 }}>Tell us what you want to learn</h2>
            <p>Add a skill you need and your availability; the best mentor match will appear here.</p>
            <Link className="btn white" to="/profile">Add skills</Link>
          </div>
        )}
      </div>

      {next && (
        <div className="next-up">
          <div className="row" style={{ gap: 14 }}>
            <span className="ico"><Icon name="videocam" /></span>
            <div>
              <div><span className="k">NEXT UP</span><span style={{ color: '#E0E7FF', fontSize: 13 }}>Starts {startsIn(next.start_at)}</span></div>
              <strong>{next.skill.name} · {next.mentor.id === user.id ? `mentoring ${next.learner.name}` : `with ${next.mentor.name}`}</strong>
              <div style={{ color: '#E0E7FF', fontSize: 13 }}>{fmtDateTime(next.start_at)} · {next.mode.toLowerCase()}{next.location_or_link ? ` · ${next.location_or_link}` : ''}</div>
            </div>
          </div>
          <Link className="btn white" to="/sessions"><Icon name="event" /> Open session</Link>
        </div>
      )}

      <div className="layout-rail">
        <div className="stack" style={{ gap: 24 }}>
          <SkillInventory user={user} matches={data.top_mentor_matches} />

          {data.incoming_requests.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div><h2 className="section-title"><Icon name="notifications_active" />Priority Requests</h2><div className="sub">Incoming mentorship requests awaiting your answer</div></div>
                <span className="badge status-pending">{data.incoming_requests.length} Pending</span>
              </div>
              <div className="grid two" style={{ gap: 16 }}>
                {data.incoming_requests.map((r) => (
                  <div key={r.id} className="request-card">
                    <div className="row between">
                      <div className="row"><Avatar name={r.learner.name} />
                        <div><Link to={`/users/${r.learner.id}`}><strong>{r.learner.name}</strong></Link><div className="muted small">{r.learner.location || '—'} · {timeAgo(r.created_at)}</div></div>
                      </div>
                      {r.compatibility_score != null && <span className="badge match">{r.compatibility_score}% Match</span>}
                    </div>
                    <div className="inner-box" style={{ marginTop: 10 }}><span className="tag-label want" style={{ margin: 0 }}><Icon name="person_check" size={16} /> Wants to learn: {r.skill.name}</span></div>
                    {r.message && <p className="quote">“{r.message}”</p>}
                    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
                      <button className="btn small ghost" onClick={() => respond(r.id, 'REJECT')}>Decline</button>
                      <button className="btn small" onClick={() => respond(r.id, 'ACCEPT')}>Accept</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.top_learner_matches.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div><h2 className="section-title"><Icon name="hub" />Learners You Could Help</h2><div className="sub">Students who need a skill you teach</div></div>
                <Link to="/find?tab=learners" className="small">See all →</Link>
              </div>
              <div className="grid three" style={{ gap: 16 }}>
                {data.top_learner_matches.map((m) => (
                  <div key={`${m.learner_id}-${m.skill_id}`} className="request-card">
                    <div className="row between"><div className="row"><Avatar name={m.learner_name} size={32} /><strong>{m.learner_name}</strong></div><span className="badge match">{m.compatibility_score}%</span></div>
                    <div className="inner-box" style={{ marginTop: 10 }}>
                      <div className="tag-label want" style={{ margin: 0 }}>Wants from you</div>
                      <div className="small">{m.skill_name} · target {m.target_level.toLowerCase()}</div>
                    </div>
                    <div className="row between" style={{ marginTop: 10 }}>
                      <span className="mono small muted">{m.location || '—'}</span>
                      <Link className="btn small ghost" to={`/users/${m.learner_id}`}>View</Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head"><h2 className="section-title"><Icon name="receipt_long" />Recent Activity</h2><Link to="/notifications" className="small">{stats.unread_notifications} unread →</Link></div>
            {data.recent_activity.length === 0 ? <Empty title="No activity yet" /> : (
              <ul className="list">
                {data.recent_activity.map((n) => (
                  <li key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`}>
                    <span className={`dot ${n.is_read ? 'read' : ''}`} />
                    <div style={{ flex: 1 }}>
                      {n.link ? <Link to={n.link} style={{ color: 'inherit', fontWeight: 'inherit' }}>{n.text}</Link> : n.text}
                      <div className="muted small mono" style={{ fontWeight: 400 }}>{n.kind.toLowerCase()} · {timeAgo(n.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="stack" style={{ gap: 24 }}>
          <RescueCard />
          <AcademicRail a={academics} />

          <div className="card">
            <div className="card-head"><h2 className="section-title"><Icon name="video_camera_front" />Upcoming Sessions</h2><Link to="/sessions" className="small">All →</Link></div>
            {data.upcoming_sessions.length === 0 ? <Empty title="Nothing scheduled">Schedule from an accepted request.</Empty> : (
              <ul className="list">
                {data.upcoming_sessions.map((s) => {
                  const other = s.mentor.id === user.id ? s.learner : s.mentor
                  return (
                    <li key={s.id} className="row">
                      <Avatar name={other.name} size={32} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong>{s.skill.name}</strong> <span className="muted">with {other.name}</span>
                        <div className="muted small mono">{fmtDateTime(s.start_at)}</div>
                      </div>
                      <StatusBadge status={s.status} />
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="card-head"><h2 className="section-title"><Icon name="auto_awesome" />Learning Plan</h2><Link to="/plans" className="small">Plans →</Link></div>
            {data.latest_plan ? (
              <>
                <div className="row between"><strong>{data.latest_plan.content.title}</strong><SourceBadge source={data.latest_plan.source} /></div>
                <p className="muted small" style={{ marginTop: 6 }}>{data.latest_plan.content.overview}</p>
                <div className="inner-box small"><span className="upper">Week 1</span> · {data.latest_plan.content.weeks[0]?.focus}</div>
              </>
            ) : <Empty title="No plan yet"><Link to="/plans">Generate one</Link> for a skill you're learning.</Empty>}
          </div>
        </div>
      </div>

      {requesting && (
        <RequestModal match={requesting} onClose={() => setRequesting(null)}
          onSent={() => { toast(`Request sent to ${requesting.mentor_name}`); setRequesting(null); reload() }} />
      )}
    </>
  )
}

/** Shows only when one of the student's OWN published marks is below the rescue threshold. */
function RescueCard() {
  const { data } = useApi('/api/academics/rescue')
  if (!data || data.courses.length === 0) return null
  const helpers = data.courses.reduce((n, c) => n + c.helpers.length, 0)
  return (
    <div className="card" style={{ borderTop: '4px solid var(--warn-strong)' }}>
      <div className="eyebrow" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}><Icon name="support" size={14} /> Academic Rescue · private</div>
      <h2 style={{ margin: '4px 0' }}>Need a hand with {data.courses.map((c) => c.course.code).join(', ')}?</h2>
      <p className="small muted">{helpers} student{helpers === 1 ? '' : 's'} who took {data.courses.length === 1 ? 'this course' : 'these courses'} offer help. Nobody sees your marks.</p>
      <Link className="btn" style={{ width: '100%' }} to="/academics?tab=rescue"><Icon name="front_hand" /> Find a course helper</Link>
    </div>
  )
}

const MiniStat = ({ label, value, unit }) => (
  <div className="mini-stat">
    <div className="label">{label}</div>
    <div className="value">{value} <small>{unit}</small></div>
  </div>
)

function SkillInventory({ user, matches }) {
  const learning = user.skills.filter((s) => s.skill_type === 'NEEDED')
  const teaching = user.skills.filter((s) => s.skill_type === 'OFFERED')
  const mentorsFor = (sid) => matches.filter((m) => m.skill_id === sid)
  return (
    <div className="card">
      <div className="card-head">
        <div><h2 className="section-title"><Icon name="swap_horizontal_circle" />Dual Pillar Skill Inventory</h2><div className="sub">Skills you're acquiring vs. skills you share</div></div>
        <Link className="btn small ghost" to="/profile"><Icon name="edit" /> Manage</Link>
      </div>
      <div className="grid" style={{ gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))' }}>
        <div>
          <div className="pillar-head learn"><span className="row" style={{ gap: 8 }}><Icon name="auto_stories" style={{ color: 'var(--primary)' }} />Skills I'm Learning <span className="n">{learning.length} active</span></span><Link to="/profile" className="small">+ Add</Link></div>
          {learning.length === 0 ? <Empty title="Nothing yet" /> : learning.map((s) => {
            const best = mentorsFor(s.skill_id)[0]
            return (
              <div key={s.id} className="skill-card">
                <div className="row between"><span className="cat-tag learn">{s.category}</span><span className="badge">target {s.level.toLowerCase()}</span></div>
                <h3 style={{ margin: '10px 0 6px' }}>{s.skill_name}</h3>
                {s.goal && <p className="small muted" style={{ marginBottom: 10 }}>{s.goal}</p>}
                <div className="inner-box row between">
                  {best ? <span className="row small" style={{ gap: 8 }}><Avatar name={best.mentor_name} size={24} />Best mentor: <strong>{best.mentor_name}</strong></span> : <span className="small muted">No mentor offers this yet</span>}
                  {best && <span className="badge match">{best.compatibility_score}%</span>}
                </div>
                <div className="row between" style={{ marginTop: 10 }}>
                  <span className="small muted mono">{mentorsFor(s.skill_id).length} in your top matches</span>
                  <Link to={`/find?skill=${s.skill_id}`} className="small">Find mentors →</Link>
                </div>
              </div>
            )
          })}
        </div>
        <div>
          <div className="pillar-head teach"><span className="row" style={{ gap: 8 }}><Icon name="co_present" style={{ color: 'var(--success)' }} />Skills I Can Teach <span className="n">{teaching.length} active</span></span><Link to="/profile" className="small" style={{ color: 'var(--success)' }}>+ Offer</Link></div>
          {teaching.length === 0 ? <Empty title="Nothing yet" /> : teaching.map((s) => (
            <div key={s.id} className="skill-card">
              <div className="row between"><span className="cat-tag teach">{s.category}</span><span className="badge status-completed">{s.level.toLowerCase()}</span></div>
              <h3 style={{ margin: '10px 0 8px' }}>{s.skill_name}</h3>
              <div className="row between"><span className="small" style={{ color: 'var(--success)' }}>● Open to requests</span><Link to="/find?tab=learners" className="small">Learners →</Link></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Faculty feed for students: next extra class, private marks (locked until clicked), announcements. */
function AcademicRail({ a }) {
  const [revealed, setRevealed] = useState(new Set())
  if (!a) return <div className="card"><Loading /></div>
  const next = a.upcoming_classes[0]
  return (
    <div className="card rail-card">
      <div className="rail-head">
        <span className="ico"><Icon name="account_balance" /></span>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>Academic Updates & Faculty Ledger</h2>
          <div className="muted small">Official feed from your course faculty</div>
        </div>
        <span className="term-tag">{a.course_count} course{a.course_count === 1 ? '' : 's'}</span>
      </div>
      {a.course_count === 0 ? (
        <Empty title="No courses yet"><Link to="/academics?tab=courses">Join with a code</Link> from your faculty.</Empty>
      ) : (
        <>
          {next ? (
            <div className="extra-card">
              <div className="row between"><span className="k">UPCOMING EXTRA CLASS</span><span className="soon">{startsIn(next.start_at)}</span></div>
              <h3>{next.course.code}: {next.course.name}</h3>
              <div className="small" style={{ color: 'var(--text-2)' }}>{next.topic}</div>
              <div className="row small muted" style={{ margin: '10px 0 12px' }}><Icon name="person" size={16} />{next.faculty?.name} · <Icon name="location_on" size={16} />{next.location}</div>
              <div className="row">
                <Link className="btn small" style={{ flex: 1 }} to="/academics"><Icon name="event" /> View & add to schedule</Link>
                {next.meeting_link && <a className="icon-btn bordered" href={next.meeting_link} target="_blank" rel="noreferrer" title="Join link"><Icon name="videocam" /></a>}
              </div>
            </div>
          ) : <p className="muted small">No extra classes scheduled.</p>}

          <div className="row between" style={{ margin: '6px 0 10px' }}><span className="upper"><Icon name="verified" size={14} /> Recently published marks</span><Link to="/academics?tab=marks" className="small">All →</Link></div>
          {a.recent_marks.length === 0 ? <p className="muted small">No marks published yet.</p> : a.recent_marks.slice(0, 3).map((m) => {
            const open = revealed.has(m.id)
            return (
              <div key={m.id} className={`locked ${open ? '' : 'is-locked'}`} onClick={() => setRevealed((s) => { const n = new Set(s); if (open) n.delete(m.id); else n.add(m.id); return n })}
                role="button" tabIndex={0} aria-label={open ? 'Hide mark' : `Reveal ${m.assessment.name} result`}>
                <div className="content-in">
                  <div className="small muted">{m.course.code} · {m.course.name}</div>
                  <strong>{m.assessment.name}</strong>
                  <div className="row between"><span className="score-big">{m.marks_obtained}<span className="muted" style={{ fontSize: 16 }}> / {m.assessment.max_marks}</span></span><span className="badge match">{m.percentage}%</span></div>
                </div>
                <div className="lock-cover"><div><span className="ico"><Icon name="visibility_off" /></span><strong>Confidential grade locked</strong><div className="muted small">Click to reveal your {m.assessment.name} result</div></div></div>
              </div>
            )
          })}

          {a.announcements.length > 0 && (
            <>
              <div className="upper" style={{ margin: '14px 0 8px' }}><Icon name="campaign" size={14} /> Announcements</div>
              {a.announcements.slice(0, 3).map((n) => (
                <Link key={n.id} to="/academics?tab=announcements" className="mini-item">
                  <strong>{n.is_important ? '❗ ' : ''}{n.title}</strong>
                  <span className="muted small">{n.course.code} · {n.author.name} · {timeAgo(n.created_at)}</span>
                </Link>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}

