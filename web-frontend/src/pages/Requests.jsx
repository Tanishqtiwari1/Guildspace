import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, errorText } from '../api'
import { useAuth } from '../auth.jsx'
import { useApi, Loading, ErrorBox, Empty, Avatar, StatusBadge, timeAgo, Notice } from '../components/ui.jsx'
import { ScheduleModal } from './Sessions.jsx'

export default function Requests() {
  const { user } = useAuth()
  const [box, setBox] = useState('incoming')
  const { data, loading, error, reload } = useApi(`/api/requests?box=${box}`)
  const [actionError, setActionError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [scheduling, setScheduling] = useState(null)

  const act = async (r, action) => {
    if (action === 'CANCEL' && !window.confirm('Cancel this mentorship? Any scheduled sessions will be cancelled too.')) return
    setActionError(null)
    try {
      await api.patch(`/api/requests/${r.id}`, { action })
      reload()
    } catch (e) {
      setActionError(errorText(e))
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mentorship requests</h1>
          <p>Requests you've received as a mentor and sent as a learner.</p>
        </div>
      </div>
      <div className="tabs">
        <button className={`tab ${box === 'incoming' ? 'active' : ''}`} onClick={() => setBox('incoming')}>Received</button>
        <button className={`tab ${box === 'outgoing' ? 'active' : ''}`} onClick={() => setBox('outgoing')}>Sent</button>
      </div>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      <ErrorBox>{actionError}</ErrorBox>
      <Notice kind="success">{notice}</Notice>
      {loading && !data ? <Loading /> : data?.length === 0 ? (
        <div className="card">
          <Empty title={box === 'incoming' ? 'No requests received yet' : "You haven't sent any requests"}>
            {box === 'outgoing' && <Link to="/find">Find a mentor</Link>}
          </Empty>
        </div>
      ) : (
        <div className="stack">
          {data?.map((r) => {
            const isMentor = r.mentor.id === user.id
            const other = isMentor ? r.learner : r.mentor
            return (
              <div key={r.id} className="card">
                <div className="row between">
                  <div className="row">
                    <Avatar name={other.name} />
                    <div>
                      <Link to={`/users/${other.id}`}><strong>{other.name}</strong></Link>
                      <span className="muted"> · {isMentor ? 'wants to learn' : 'mentoring you in'} </span>
                      <strong>{r.skill.name}</strong>
                      <div className="muted small">
                        Sent {timeAgo(r.created_at)}
                        {r.compatibility_score != null && ` · compatibility ${r.compatibility_score}/100`}
                        {r.session_count > 0 && ` · ${r.session_count} session(s)`}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                {r.message && <p className="small" style={{ margin: '10px 0 0' }}>"{r.message}"</p>}
                <div className="row" style={{ marginTop: 12 }}>
                  {isMentor && r.status === 'PENDING' && (
                    <>
                      <button className="btn small success" onClick={() => act(r, 'ACCEPT')}>Accept</button>
                      <button className="btn small ghost" onClick={() => act(r, 'REJECT')}>Decline</button>
                    </>
                  )}
                  {r.status === 'ACCEPTED' && (
                    <>
                      <button className="btn small" onClick={() => setScheduling(r)}>Schedule session</button>
                      <Link className="btn small ghost" to={`/messages/${other.id}`}>Message</Link>
                      <button className="btn small ghost" onClick={() => act(r, 'COMPLETE')}>Mark mentorship complete</button>
                    </>
                  )}
                  {['PENDING', 'ACCEPTED'].includes(r.status) && (
                    <button className="btn small ghost" onClick={() => act(r, 'CANCEL')}>{r.status === 'PENDING' && !isMentor ? 'Withdraw' : 'Cancel'}</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {scheduling && (
        <ScheduleModal
          request={scheduling}
          onClose={() => setScheduling(null)}
          onDone={() => { setScheduling(null); setNotice('Session scheduled. It now appears under Sessions.'); reload() }}
        />
      )}
    </>
  )
}
