import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, errorText } from '../api'
import { useApi, Loading, ErrorBox, Empty, StatusBadge, Modal, Avatar, Stars, fmtDateTime, fmtTime, timeAgo } from '../components/ui.jsx'
import { useConfirm, useToast } from '../components/feedback.jsx'
import Calendar from '../components/Calendar.jsx'
import { Icon } from '../components/brand.jsx'
import { categoryLabel } from './faculty/FacultyAnnouncements.jsx'

const TABS = [['upcoming', 'Upcoming classes'], ['calendar', 'Calendar'], ['announcements', 'Announcements'], ['marks', 'My marks'], ['rescue', 'Get help'], ['courses', 'My courses']]

export default function Academics() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'upcoming'
  return (
    <>
      <div className="page-head">
        <div>
          <h1>My academics</h1>
          <p>Extra classes, announcements and marks from your faculty.</p>
        </div>
      </div>
      <div className="tabs">
        {TABS.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setParams(k === 'upcoming' ? {} : { tab: k })}>{l}</button>)}
      </div>
      {tab === 'upcoming' && <UpcomingClasses />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'announcements' && <Announcements />}
      {tab === 'marks' && <MyMarks />}
      {tab === 'rescue' && <Rescue />}
      {tab === 'courses' && <Courses />}
    </>
  )
}

/** Download the class as an .ics file (authenticated request, so it can't be a plain link). */
async function downloadIcs(x, toast) {
  try {
    const res = await api.get(`/api/academics/extra-classes/${x.id}/ics`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    const a = Object.assign(document.createElement('a'), { href: url, download: `${x.course.code}-${x.topic}.ics`.replace(/\s+/g, '-') })
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) { toast(errorText(e), 'error') }
}

export function ExtraClassCard({ x, onChange }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    setBusy(true)
    try {
      const { data } = x.in_my_schedule
        ? await api.delete(`/api/academics/extra-classes/${x.id}/schedule`)
        : await api.post(`/api/academics/extra-classes/${x.id}/schedule`)
      toast(data.in_my_schedule ? 'Added to your schedule' : 'Removed from your schedule')
      onChange?.(data)
    } catch (e) { toast(errorText(e), 'error') } finally { setBusy(false) }
  }
  return (
    <div className={`card class-card ${x.status === 'CANCELLED' ? 'cancelled' : ''}`}>
      <div className="date-chip">
        <span>{new Date(x.start_at).toLocaleDateString(undefined, { month: 'short' })}</span>
        <strong>{new Date(x.start_at).getDate()}</strong>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row between">
          <div><span className="muted small">📚 Extra class · {x.course.code}</span><div><strong>{x.course.name} — {x.topic}</strong></div></div>
          {x.status === 'CANCELLED' ? <StatusBadge status="CANCELLED" /> : x.in_my_schedule && <span className="badge status-completed">in my schedule</span>}
        </div>
        <div className="muted small">{fmtDateTime(x.start_at)} – {fmtTime(x.end_at)} · 📍 {x.location} · {x.faculty?.name}</div>
        {x.description && <p className="small" style={{ margin: '6px 0 0' }}>{x.description}</p>}
        {x.status === 'CANCELLED' && x.cancel_reason && <p className="small muted" style={{ margin: '6px 0 0' }}>Cancelled: {x.cancel_reason}</p>}
        {x.status !== 'CANCELLED' && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className={`btn small ${x.in_my_schedule ? 'ghost' : ''}`} onClick={toggle} disabled={busy}>{x.in_my_schedule ? 'Remove from schedule' : '+ Add to schedule'}</button>
            <button className="btn small ghost" onClick={() => downloadIcs(x, toast)}>Download .ics</button>
            {x.meeting_link && <a className="btn small ghost" href={x.meeting_link} target="_blank" rel="noreferrer">Join link</a>}
          </div>
        )}
      </div>
    </div>
  )
}

function UpcomingClasses() {
  const { data, loading, error, reload, setData } = useApi('/api/academics/extra-classes?scope=upcoming')
  if (loading && !data) return <Loading />
  return (
    <>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {data?.length === 0 ? <div className="card"><Empty title="No upcoming extra classes">When your faculty schedule one, it appears here and you get a notification.</Empty></div> : (
        <div className="stack">{data?.map((x) => <ExtraClassCard key={x.id} x={x} onChange={(n) => setData(data.map((y) => (y.id === n.id ? n : y)))} />)}</div>
      )}
    </>
  )
}

function CalendarTab() {
  const [selected, setSelected] = useState(null)
  const [key, setKey] = useState(0)
  const open = async (e) => {
    if (e.type !== 'EXTRA_CLASS') return
    const { data } = await api.get('/api/academics/extra-classes?scope=all')
    setSelected(data.find((x) => x.id === e.id) || null)
  }
  return (
    <>
      <Calendar onSelect={open} reloadKey={key} />
      <p className="muted small">Classes you've added to your schedule are outlined. Click an extra class for details.</p>
      {selected && (
        <Modal title="Extra class" onClose={() => setSelected(null)}>
          <ExtraClassCard x={selected} onChange={(n) => { setSelected(n); setKey((k) => k + 1) }} />
        </Modal>
      )}
    </>
  )
}

function Announcements() {
  const { data, loading, error, reload } = useApi('/api/academics/announcements')
  if (loading && !data) return <Loading />
  return (
    <>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {data?.length === 0 ? <div className="card"><Empty title="No announcements" /></div> : (
        <div className="stack">
          {data?.map((a) => (
            <div key={a.id} className={`card announcement ${a.is_important ? 'important' : ''}`}>
              <div className="row between">
                <strong>{a.is_important && '❗ '}{a.title}</strong>
                <span className="badge">{categoryLabel(a.category)}</span>
              </div>
              <div className="muted small">{a.course.code} · {a.author.name} · {a.target_type === 'STUDENT' ? 'sent to you personally' : a.target_type === 'SECTION' ? `section ${a.target_section}` : 'whole course'} · {timeAgo(a.created_at)}</div>
              <p className="small" style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{a.body}</p>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export function MarkCard({ m }) {
  const [open, setOpen] = useState(false)
  const pct = m.percentage ?? 0
  const tone = pct >= 75 ? 'var(--success-strong)' : pct >= 40 ? 'var(--warn-strong)' : 'var(--danger)'
  return (
    <div className={`card mark-card locked ${open ? '' : 'is-locked'}`} style={{ padding: 0, margin: 0 }} onClick={() => setOpen((o) => !o)}
      role="button" tabIndex={0} aria-label={open ? 'Hide mark' : `Reveal ${m.assessment.name} result`}>
      <div className="content-in" style={{ padding: 20 }}>
        <div className="upper">📊 {m.course.code} · {m.course.name}</div>
        <h3 style={{ margin: '6px 0' }}>{m.assessment.name}</h3>
        <div className="mark-score">{m.marks_obtained} <span className="muted" style={{ fontSize: 18 }}>/ {m.assessment.max_marks}</span></div>
        <div className="progress" style={{ margin: '10px 0' }}><span style={{ width: `${Math.min(pct, 100)}%`, background: tone }} /></div>
        <div className="row between small muted"><span className="mono">{pct}%</span><span>Published {timeAgo(m.published_at)}</span></div>
        {m.remarks && <p className="small" style={{ margin: '8px 0 0' }}>“{m.remarks}”</p>}
      </div>
      <div className="lock-cover"><div><span className="ico"><span className="msi">visibility_off</span></span><strong>Confidential grade locked</strong><div className="muted small">Click to reveal your {m.assessment.name} result</div></div></div>
    </div>
  )
}

function MyMarks() {
  const { data, loading, error, reload } = useApi('/api/academics/marks')
  if (loading && !data) return <Loading />
  const byCourse = {}
  for (const m of data || []) (byCourse[`${m.course.code} · ${m.course.name}`] ||= []).push(m)
  return (
    <>
      <div className="alert info"><span>🔒 Only you can see your marks. They appear here once your faculty publishes them, and stay hidden on screen until you click a card.</span></div>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {data?.length === 0 ? <div className="card"><Empty title="No marks published yet" /></div> : Object.entries(byCourse).map(([course, marks]) => (
        <div key={course} style={{ marginBottom: 20 }}>
          <h2>{course}</h2>
          <div className="grid three">{marks.map((m) => <MarkCard key={m.id} m={m} />)}</div>
        </div>
      ))}
    </>
  )
}

function Courses() {
  const { data, loading, error, reload } = useApi('/api/academics/courses')
  const [code, setCode] = useState('')
  const toast = useToast()
  const confirm = useConfirm()
  const join = async (e) => {
    e.preventDefault()
    try {
      const { data: c } = await api.post('/api/academics/courses/join', { join_code: code })
      toast(`Enrolled in ${c.code} ${c.name}`)
      setCode('')
      reload()
    } catch (err) { toast(errorText(err), 'error') }
  }
  const leave = async (c) => {
    if (!(await confirm({ title: `Leave ${c.code}?`, body: 'You will stop receiving its extra classes and announcements. Your published marks stay visible to you.', confirmLabel: 'Leave course', danger: true }))) return
    try { await api.delete(`/api/academics/courses/${c.id}`); toast(`Left ${c.code}`); reload() } catch (err) { toast(errorText(err), 'error') }
  }
  return (
    <>
      <form className="card inline-form" onSubmit={join} style={{ marginBottom: 16 }}>
        <div className="field" style={{ flex: 3 }}>
          <label htmlFor="join">Join a course</label>
          <input id="join" required minLength={4} maxLength={12} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Enter the join code from your faculty" className="mono" />
        </div>
        <button className="btn">Join</button>
      </form>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {loading && !data ? <Loading /> : data?.length === 0 ? <div className="card"><Empty title="You're not enrolled in any courses yet" /></div> : (
        <div className="grid three">
          {data?.map((c) => (
            <div key={c.id} className="card course-card">
              <div className="row between"><span className="course-code">{c.code}</span><span className="badge">Section {c.my_section}</span></div>
              <h3 style={{ margin: '8px 0 4px' }}>{c.name}</h3>
              <div className="muted small">{c.faculty?.name}{c.faculty_department ? ` · ${c.faculty_department}` : ''}</div>
              <div className="muted small">Semester {c.semester} · {c.academic_year}</div>
              <button className="btn small ghost" style={{ marginTop: 12 }} onClick={() => leave(c)}>Leave course</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/** Academic Rescue: peer helpers for courses where the student's OWN published mark is low,
 *  plus the student's own offers to help with courses they've taken. */
function Rescue() {
  const { data, loading, error, reload } = useApi('/api/academics/rescue')
  const [asking, setAsking] = useState(null)
  const toast = useToast()
  if (loading && !data) return <Loading />
  return (
    <>
      <div className="alert info"><span><Icon name="lock" size={16} /> Private to you. Only <strong>your own</strong> marks are used here, and helpers never see them. Faculty see anonymous totals only.</span></div>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {data?.courses.length === 0 ? (
        <div className="card"><Empty title="You're on track 🎉">When one of your published marks is below {data.threshold}%, classmates and seniors who took that course will show up here to help.</Empty></div>
      ) : data?.courses.map((c) => (
        <div key={c.course.code} className="card" style={{ marginBottom: 20, borderTop: '4px solid var(--warn-strong)' }}>
          <div className="card-head">
            <div>
              <div className="eyebrow" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}><Icon name="support" size={14} /> Academic Rescue</div>
              <h2 style={{ margin: 0 }}>{c.course.code} · {c.course.name}</h2>
              <div className="sub">Below {data.threshold}% in {c.low_assessments.map((a) => `${a.assessment} (${a.percentage}%)`).join(', ')} · visible only to you</div>
            </div>
          </div>
          <div className="layout-rail" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
            <div>
              <div className="upper" style={{ marginBottom: 8 }}>Peers who took {c.course.code} and offer help</div>
              {c.helpers.length === 0 ? <Empty title="No volunteers yet">Try the extra class and notices, or ask your faculty in Messages.</Empty> : (
                <div className="stack" style={{ gap: 12 }}>
                  {c.helpers.map((h) => (
                    <div key={h.user.id} className="request-card">
                      <div className="row between">
                        <div className="row">
                          <Avatar name={h.user.name} />
                          <div>
                            <Link to={`/users/${h.user.id}`} style={{ color: 'var(--text)' }}><strong>{h.user.name}</strong></Link>
                            {h.grade_verified && <span className="badge match" style={{ marginLeft: 6 }}><Icon name="verified" size={14} /> Grade-verified</span>}
                            <div className="small muted">prefers {h.mode.toLowerCase()} sessions · <Stars value={h.avg_rating} /> · reliability {h.reliability != null ? `${h.reliability}%` : 'new'}</div>
                          </div>
                        </div>
                        {h.request_status ? <StatusBadge status={h.request_status} /> : (
                          <button className="btn small" onClick={() => setAsking({ helper: h, course: c.course })}><Icon name="front_hand" /> Ask for help</button>
                        )}
                      </div>
                      {h.note && <p className="quote">“{h.note}”</p>}
                      <div className="small muted" style={{ marginTop: 8 }}>
                        <Icon name="schedule" size={16} /> {h.shared_slots.length ? `Both free: ${h.shared_slots.map((x) => `${x.day.slice(0, 3)} ${x.start}–${x.end}`).join(', ')}` : 'No shared free time yet'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="stack" style={{ gap: 12 }}>
              {c.next_extra_class ? (
                <div className="extra-card" style={{ margin: 0 }}>
                  <span className="k">NEXT EXTRA CLASS</span>
                  <h3>{c.next_extra_class.topic}</h3>
                  <div className="small mono">{fmtDateTime(c.next_extra_class.start_at)} · {c.next_extra_class.location}</div>
                  <Link className="btn small" style={{ width: '100%', marginTop: 10 }} to="/academics">Add to schedule</Link>
                </div>
              ) : <div className="inner-box small muted">No extra class scheduled for {c.course.code} yet.</div>}
              {c.notices.map((n) => (
                <Link key={n.id} to="/academics?tab=announcements" className="mini-item">
                  <strong>{n.is_important ? '❗ ' : '📣 '}{n.title}</strong>
                  <span className="small muted">{n.author.name} · {timeAgo(n.created_at)}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ))}
      <OfferHelp />
      {asking && <AskHelpModal {...asking} onClose={() => setAsking(null)} onSent={() => { setAsking(null); toast(`Request sent to ${asking.helper.user.name}`); reload() }} />}
    </>
  )
}

function AskHelpModal({ helper, course, onClose, onSent }) {
  const [message, setMessage] = useState(`Hi ${helper.user.name.split(' ')[0]}, could you help me with ${course.code} ${course.name}? I want to improve before the next assessment.`)
  const [error, setError] = useState(null)
  const send = async (e) => {
    e.preventDefault()
    try { await api.post('/api/requests', { mentor_id: helper.user.id, skill_id: helper.skill_id, message }); onSent() } catch (err) { setError(errorText(err)) }
  }
  return (
    <Modal title={`Ask ${helper.user.name} for help with ${course.code}`} onClose={onClose}>
      <form onSubmit={send}>
        <p className="small muted">They won't see your marks. Sessions use your skill credits like any other mentorship.</p>
        <ErrorBox>{error}</ErrorBox>
        <div className="field"><label htmlFor="ask-msg">Message</label><textarea id="ask-msg" maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn"><Icon name="send" /> Send request</button>
        </div>
      </form>
    </Modal>
  )
}

function OfferHelp() {
  const { data: eligible, reload: reloadEligible } = useApi('/api/academics/help-offers/eligible')
  const { data: offers, reload } = useApi('/api/academics/help-offers')
  const [badge, setBadge] = useState({})
  const toast = useToast()
  const confirm = useConfirm()
  const offered = new Set((offers || []).map((o) => o.course_code))
  const offer = async (c) => {
    try {
      await api.post('/api/academics/help-offers', { course_code: c.course_code, share_grade_badge: !!badge[c.course_code] })
      toast(`You now offer help with ${c.course_code}. Struggling classmates can find you.`)
      reload(); reloadEligible()
    } catch (e) { toast(errorText(e), 'error') }
  }
  const withdraw = async (o) => {
    if (!(await confirm({ title: `Stop offering help with ${o.course_code}?`, body: 'Existing mentorships stay as they are.', confirmLabel: 'Withdraw' }))) return
    try { await api.delete(`/api/academics/help-offers/${o.id}`); toast('Offer withdrawn'); reload() } catch (e) { toast(errorText(e), 'error') }
  }
  return (
    <div className="card">
      <div className="card-head">
        <div><h2 className="section-title"><Icon name="volunteer_activism" />Offer help with a course you've taken</h2>
          <div className="sub">Helping earns you skill credits. You can only offer courses you were enrolled in.</div></div>
      </div>
      {(offers || []).length > 0 && (
        <div className="chips" style={{ marginBottom: 14 }}>
          {offers.map((o) => (
            <span key={o.id} className="chip teach">{o.course_code}{o.grade_verified && ' ✓ grade-verified'}<button onClick={() => withdraw(o)} aria-label={`Withdraw ${o.course_code}`}>×</button></span>
          ))}
        </div>
      )}
      {!eligible ? <Loading /> : eligible.filter((c) => !offered.has(c.course_code)).length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>{eligible.length ? 'You already offer help with all your courses.' : 'Nothing to offer yet. You can offer help with courses you have taken once your own results there are 50% or more.'}</p>
      ) : (
        <ul className="list">
          {eligible.filter((c) => !offered.has(c.course_code)).map((c) => (
            <li key={c.course_code} className="row between">
              <div><span className="course-code">{c.course_code}</span> <strong>{c.name}</strong> <span className="small muted">· {c.academic_year}</span></div>
              <div className="row">
                {c.can_show_badge && (
                  <label className="row small" style={{ margin: 0, gap: 6, fontWeight: 500 }} title="Shows a badge if your own marks in this course average 60% or more. Your score is never shown.">
                    <input type="checkbox" checked={!!badge[c.course_code]} onChange={(e) => setBadge({ ...badge, [c.course_code]: e.target.checked })} /> Show "grade-verified" badge
                  </label>
                )}
                <button className="btn small mint" onClick={() => offer(c)}><Icon name="add" /> Offer help</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
