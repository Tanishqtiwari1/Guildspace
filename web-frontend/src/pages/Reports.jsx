import { useState } from 'react'
import { useApi, Loading, ErrorBox, Empty, StatusBadge, timeAgo, Notice } from '../components/ui.jsx'
import { ReportModal } from './UserProfile.jsx'

export default function Reports() {
  const { data, loading, error, reload } = useApi('/api/reports/mine')
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState(null)
  return (
    <>
      <div className="page-head">
        <div>
          <h1>My reports</h1>
          <p>Report a user from their profile, or a general platform issue here.</p>
        </div>
        <button className="btn ghost" onClick={() => setOpen(true)}>Report a problem</button>
      </div>
      <Notice kind="success">{notice}</Notice>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {loading && !data ? <Loading /> : (
        <div className="card">
          {data?.length === 0 ? <Empty title="You haven't submitted any reports" /> : (
            <ul className="list">
              {data?.map((r) => (
                <li key={r.id}>
                  <div className="row between">
                    <strong>{r.reported_user ? `About ${r.reported_user.name}` : 'Platform issue'}</strong>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="small" style={{ margin: '4px 0' }}>{r.reason}</p>
                  <div className="muted small">{timeAgo(r.created_at)}{r.admin_note && ` · Admin: ${r.admin_note}`}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {open && <ReportModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); setNotice('Report submitted.'); reload() }} />}
    </>
  )
}
