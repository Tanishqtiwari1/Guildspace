import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, errorText } from '../api'
import { useAuth } from '../auth.jsx'
import { useApi, Loading, ErrorBox, Empty, Avatar, StatusBadge, timeAgo, fmtDateTime, fmtTime } from '../components/ui.jsx'
import { Icon } from '../components/brand.jsx'

export default function Messages() {
  const { id } = useParams()
  const { user } = useAuth()
  const { data: convos, loading, error, reload: reloadConvos } = useApi('/api/messages/conversations')
  const isStudent = user.account_type === 'STUDENT'

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Icon name="forum" size={14} /> Mentorship workspace</div>
          <h1>Messages</h1>
          <p>Message your mentors and mentees{isStudent ? ', and the faculty of your courses' : ' and students in your courses'}.</p>
        </div>
      </div>
      <ErrorBox onRetry={reloadConvos}>{error}</ErrorBox>
      {loading && !convos ? <Loading /> : (
        <div className={`card chat ${id && isStudent ? 'with-rail' : ''}`}>
          <div className="chat-list">
            <div className="row between" style={{ padding: '4px 6px 10px' }}>
              <strong className="row" style={{ gap: 8 }}><Icon name="swap_horiz" style={{ color: 'var(--primary)' }} />{isStudent ? 'Peer Hub' : 'Conversations'}</strong>
              <span className="badge mono-tag">{convos?.length || 0}</span>
            </div>
            <div className="upper" style={{ padding: '0 6px 6px' }}>Active exchanges</div>
            {convos?.length === 0 ? <Empty title="No conversations">Accept or send a request to start chatting.</Empty> : convos?.map((c) => (
              <Link key={c.user.id} to={`/messages/${c.user.id}`} className={`chat-item ${String(c.user.id) === id ? 'active' : ''}`}>
                <Avatar name={c.user.name} size={40} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row between" style={{ flexWrap: 'nowrap' }}>
                    <strong style={{ fontSize: 14 }}>{c.user.name}</strong>
                    {c.unread > 0 ? <span className="count live">{c.unread}</span> : c.last_message && <span className="mono small muted">{timeAgo(c.last_message.sent_at)}</span>}
                  </div>
                  <div className="preview">{c.last_message ? c.last_message.text : 'No messages yet'}</div>
                </div>
              </Link>
            ))}
          </div>
          {id ? <Thread otherId={Number(id)} name={convos?.find((c) => c.user.id === Number(id))?.user.name} onChange={reloadConvos} /> : (
            <div className="chat-pane" style={{ justifyContent: 'center' }}><Empty title="Select a conversation">Pick someone on the left to open your shared workspace.</Empty></div>
          )}
          {id && isStudent && <ContextRail otherId={Number(id)} />}
        </div>
      )}
    </>
  )
}

function Thread({ otherId, name, onChange }) {
  const { user } = useAuth()
  const { data: msgs, error, reload, setData } = useApi(`/api/messages/${otherId}`)
  // A brand-new conversation (e.g. faculty opening a chat from the roster) isn't in the list yet.
  const { data: other } = useApi(`/api/users/${otherId}`)
  const [text, setText] = useState('')
  const [sendError, setSendError] = useState(null)
  const bottom = useRef(null)

  // Poll for new messages while the thread is open.
  useEffect(() => {
    const t = setInterval(reload, 8000)
    return () => clearInterval(t)
  }, [reload])
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [msgs?.length])
  useEffect(() => { if (msgs) onChange() }, [msgs?.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setSendError(null)
    try {
      const { data } = await api.post('/api/messages', { receiver_id: otherId, text })
      setData([...(msgs || []), data])
      setText('')
    } catch (err) {
      setSendError(errorText(err))
    }
  }

  const displayName = name || other?.name || 'Conversation'
  const role = other ? (other.account_type === 'FACULTY' ? `${other.designation || 'Faculty'} · ${other.department}` : `${other.location || '—'} · ${other.role.toLowerCase()}`) : ''
  if (error) return <div className="chat-pane" style={{ padding: 16 }}><ErrorBox>{error}</ErrorBox></div>
  return (
    <div className="chat-pane">
      <div className="chat-head">
        <Avatar name={displayName} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/users/${otherId}`} style={{ color: 'var(--text)', fontSize: 17, fontWeight: 700 }}>{displayName}</Link>
          {other?.account_type === 'FACULTY' && <span className="badge mono-tag" style={{ marginLeft: 8 }}>Faculty</span>}
          <div className="small muted">{role}</div>
        </div>
      </div>
      <div className="chat-msgs">
        {!msgs ? <Loading /> : msgs.length === 0 ? <Empty title="Say hello 👋">Messages are private between the two of you.</Empty> : msgs.map((m, i) => {
          const mine = m.sender_id === user.id
          const showDay = i === 0 || new Date(msgs[i - 1].sent_at).toDateString() !== new Date(m.sent_at).toDateString()
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showDay && <div style={{ alignSelf: 'center' }}><span className="chip small">{new Date(m.sent_at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>}
              <div className={`bubble ${mine ? 'me' : ''}`}>
                {m.text}
                <time>{mine ? 'You' : displayName.split(' ')[0]} · {fmtTime(m.sent_at)}</time>
              </div>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>
      {sendError && <div style={{ padding: '0 14px' }}><ErrorBox>{sendError}</ErrorBox></div>}
      <form className="chat-input" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Send a message…" maxLength={2000} aria-label="Message" />
        <button className="btn" disabled={!text.trim()}>Send <Icon name="send" /></button>
      </form>
    </div>
  )
}

/** Right rail: what this conversation is about, built from the shared requests and sessions. */
function ContextRail({ otherId }) {
  const { user } = useAuth()
  const { data: reqs } = useApi('/api/requests')
  const { data: sessions } = useApi('/api/sessions?scope=all')
  const shared = (reqs || []).filter((r) => r.mentor.id === otherId || r.learner.id === otherId)
  const sess = (sessions || []).filter((s) => s.mentor.id === otherId || s.learner.id === otherId)
  const upcoming = sess.filter((s) => ['SCHEDULED', 'RESCHEDULED'].includes(s.status)).sort((a, b) => a.start_at.localeCompare(b.start_at))
  const done = sess.filter((s) => s.status === 'COMPLETED').length
  return (
    <aside className="chat-rail">
      <div className="upper" style={{ color: 'var(--primary)' }}>Shared workspace</div>
      {!reqs || !sessions ? <Loading /> : shared.length === 0 ? <p className="small muted" style={{ marginTop: 8 }}>No mentorship with this person yet.</p> : (
        <>
          {shared.map((r) => (
            <div key={r.id} className="inner-box" style={{ marginTop: 10 }}>
              <div className="row between"><strong>{r.skill.name}</strong><StatusBadge status={r.status} /></div>
              <div className="small muted">{r.mentor.id === user.id ? 'You mentor' : 'Your mentor'} · requested {timeAgo(r.created_at)}</div>
            </div>
          ))}
          <div className="upper" style={{ margin: '18px 0 8px' }}>Sessions</div>
          <div className="metric-grid inner-box">
            <div><strong>{upcoming.length}</strong><span>upcoming</span></div>
            <div><strong>{done}</strong><span>done</span></div>
            <div><strong>{sess.length}</strong><span>total</span></div>
          </div>
          {upcoming[0] && (
            <div className="extra-card" style={{ marginTop: 14 }}>
              <span className="k">NEXT SESSION</span>
              <h3 style={{ fontSize: 15 }}>{upcoming[0].skill.name}</h3>
              <div className="small mono">{fmtDateTime(upcoming[0].start_at)}</div>
              <Link className="btn small" style={{ width: '100%', marginTop: 10 }} to="/sessions"><Icon name="event" /> Open sessions</Link>
            </div>
          )}
        </>
      )}
    </aside>
  )
}
