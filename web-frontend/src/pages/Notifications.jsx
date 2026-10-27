import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useApi, Loading, ErrorBox, Empty, timeAgo } from '../components/ui.jsx'

export default function Notifications() {
  const { data, loading, error, reload } = useApi('/api/notifications')
  const navigate = useNavigate()

  const open = async (n) => {
    if (!n.is_read) await api.post(`/api/notifications/${n.id}/read`).catch(() => {})
    if (n.link) navigate(n.link)
    else reload()
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Updates about your requests, sessions, messages and feedback.</p>
        </div>
        <button className="btn ghost" onClick={() => api.post('/api/notifications/read-all').then(reload)} disabled={!data?.some((n) => !n.is_read)}>Mark all read</button>
      </div>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {loading && !data ? <Loading /> : (
        <div className="card">
          {data?.length === 0 ? <Empty title="You're all caught up" /> : (
            <ul className="list">
              {data?.map((n) => (
                <li key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} style={{ cursor: 'pointer' }} onClick={() => open(n)}>
                  <span className={`dot ${n.is_read ? 'read' : ''}`} />
                  <div style={{ flex: 1 }}>
                    {n.text}
                    <div className="muted small" style={{ fontWeight: 400 }}>{n.kind.toLowerCase()} · {timeAgo(n.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}
