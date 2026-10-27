import { useState } from 'react'
import { useApi, ErrorBox, fmtTime } from './ui.jsx'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const ymd = (d) => d.toLocaleDateString('en-CA')

/** Month calendar fed by /api/academics/calendar (extra classes, plus mentorship sessions for students). */
export default function Calendar({ onSelect, reloadKey = 0 }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
  const { data: events, error, reload } = useApi(`/api/academics/calendar?month=${month}`, [reloadKey])

  const first = new Date(cursor)
  const offset = (first.getDay() + 6) % 7 // Monday-first grid
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  const cells = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1))]
  while (cells.length % 7) cells.push(null)
  const today = ymd(new Date())
  const byDay = {}
  for (const e of events || []) (byDay[e.start_at.slice(0, 10)] ||= []).push(e)
  const shift = (n) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1))

  return (
    <div className="card calendar">
      <div className="row between" style={{ marginBottom: 10 }}>
        <button className="btn small ghost" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <strong>{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
        <button className="btn small ghost" onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      <div className="cal-grid">
        {WEEKDAYS.map((d) => <div key={d} className="cal-head">{d}</div>)}
        {cells.map((d, i) => (
          <div key={i} className={`cal-cell ${d && ymd(d) === today ? 'today' : ''} ${d ? '' : 'blank'}`}>
            {d && <span className="cal-date">{d.getDate()}</span>}
            {d && (byDay[ymd(d)] || []).map((e) => (
              <button key={`${e.type}-${e.id}`} type="button"
                className={`cal-event ${e.type === 'SESSION' ? 'session' : ''} ${e.status === 'CANCELLED' ? 'cancelled' : ''} ${e.in_my_schedule ? 'mine' : ''}`}
                title={`${e.title} · ${fmtTime(e.start_at)}–${fmtTime(e.end_at)} · ${e.location}${e.status === 'CANCELLED' ? ' (cancelled)' : ''}`}
                onClick={() => onSelect?.(e)}>
                <span className="cal-time">{fmtTime(e.start_at)}</span> {e.title}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="row small muted" style={{ marginTop: 10, gap: 16 }}>
        <span><span className="legend extra" /> Extra class</span>
        <span><span className="legend session" /> Mentorship session</span>
        <span><span className="legend cancelled" /> Cancelled</span>
      </div>
    </div>
  )
}
