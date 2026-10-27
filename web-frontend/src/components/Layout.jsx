import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { api } from '../api'
import { Avatar } from './ui.jsx'
import { Icon, Logo } from './brand.jsx'

// `badge` names a key in the unread counts computed below from the user's own notifications.
const STUDENT_NAV = [
  { to: '/', label: 'Dashboard', icon: 'grid_view' },
  { to: '/find', label: 'Find Mentors', icon: 'group_search' },
  { to: '/requests', label: 'Requests', icon: 'swap_calls', badge: 'requests' },
  { to: '/sessions', label: 'My Sessions', icon: 'video_camera_front', badge: 'sessions' },
  { to: '/academics', label: 'Academics', icon: 'school', badge: 'academics', hot: true },
  { to: '/messages', label: 'Messages', icon: 'chat_bubble', badge: 'messages' },
  { to: '/plans', label: 'Learning Plans', icon: 'auto_awesome' },
  { to: '/credits', label: 'Skill Credits', icon: 'toll' },
]
const FACULTY_NAV = [
  { to: '/', label: 'Dashboard', icon: 'grid_view' },
  { to: '/faculty/courses', label: 'My Courses', icon: 'menu_book' },
  { to: '/faculty/classes', label: 'Extra Classes', icon: 'event' },
  { to: '/faculty/announcements', label: 'Announcements', icon: 'campaign' },
  { to: '/faculty/marks', label: 'Marks', icon: 'grading' },
  { to: '/messages', label: 'Messages', icon: 'chat_bubble', badge: 'messages' },
]
const ACADEMIC_KINDS = ['EXTRA_CLASS', 'ANNOUNCEMENT', 'MARKS']

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const [counts, setCounts] = useState({})
  const [online, setOnline] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [q, setQ] = useState('')
  const searchRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()
  const isFaculty = user.account_type === 'FACULTY'
  const NAV = isFaculty ? FACULTY_NAV : STUDENT_NAV

  // Unread counts come from the backend; refresh on navigation and every 20s.
  useEffect(() => {
    let alive = true
    const load = () =>
      Promise.all([api.get('/api/notifications?unread_only=true'), api.get('/api/messages/conversations')])
        .then(([n, c]) => {
          if (!alive) return
          const by = (kinds) => n.data.filter((x) => kinds.includes(x.kind)).length
          setCounts({
            notifications: n.data.length,
            messages: c.data.reduce((s, x) => s + x.unread, 0),
            requests: by(['REQUEST']),
            sessions: by(['SESSION', 'FEEDBACK']),
            academics: by(ACADEMIC_KINDS),
          })
          setOnline(true)
        })
        .catch(() => alive && setOnline(false))
    load()
    const t = setInterval(load, 20000)
    return () => { alive = false; clearInterval(t) }
  }, [location.pathname])

  useEffect(() => setMenuOpen(false), [location.pathname])

  // ⌘K / Ctrl+K focuses the omnisearch.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const search = (e) => {
    e.preventDefault()
    if (!q.trim()) return
    navigate(`/find?tab=search&q=${encodeURIComponent(q.trim())}`)
    setQ('')
  }

  const badge = (n) => {
    const v = counts[n.badge]
    if (!v) return null
    return <span className={`count ${n.hot ? 'hot' : ''}`}>{n.hot ? `${v} New` : v}</span>
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <Link to="/" className="brand" style={{ color: 'inherit', textDecoration: 'none' }}>
          <Logo size={40} />
          <div>
            <strong>Guildspace</strong>
            <small>{isFaculty ? (user.faculty_profile?.department || 'Faculty workspace') : `${user.location ? `${user.location} · ` : ''}Student hub`}</small>
          </div>
        </Link>
        <div className="hub-pill">
          <span className="row" style={{ gap: 8 }}><span className="live-dot" style={online ? {} : { background: 'var(--faint)', boxShadow: 'none' }} />{isFaculty ? 'Faculty Active' : 'Hub Active'}</span>
          <span className="mono">{counts.notifications || 0} new</span>
        </div>
        <nav>
          <div className="nav-section">Workspace</div>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-link">
              <Icon name={n.icon} />
              {n.label}
              {badge(n)}
            </NavLink>
          ))}
          <div className="nav-section">System</div>
          <NavLink to="/notifications" className="nav-link"><Icon name="notifications" />Notifications{badge({ badge: 'notifications' })}</NavLink>
          {!isFaculty && <NavLink to="/reports" className="nav-link"><Icon name="flag" />My Reports</NavLink>}
          {user.is_admin && <NavLink to="/admin" className="nav-link"><Icon name="admin_panel_settings" />Admin</NavLink>}
          <NavLink to="/profile" className="nav-link"><Icon name="settings" />Profile & Settings</NavLink>
        </nav>
        <div className="sidebar-foot">
          <Avatar name={user.name} size={38} online />
          <div className="who">
            <strong>{user.name} {(isFaculty ? user.faculty_profile?.verified : true) && <Icon name="verified" fill size={16} style={{ color: 'var(--primary)', verticalAlign: '-3px' }} />}</strong>
            <small>{isFaculty ? (user.faculty_profile?.designation || 'Faculty') : user.email}</small>
          </div>
          <button className="icon-btn" onClick={logout} title="Log out" aria-label="Log out"><Icon name="logout" /></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu"><Icon name="menu" /></button>
          <span className="topbar-brand"><Logo size={28} />Guildspace</span>
          {!isFaculty && (
            <form className="omnisearch" onSubmit={search} role="search">
              <Icon name="search" />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills, mentors, or people (e.g. Python, React)…" aria-label="Search" />
              <span className="kbd">⌘K</span>
            </form>
          )}
          <div className="topbar-actions">
            <span className="status-pill"><span className="live-dot" style={online ? {} : { background: 'var(--danger)', boxShadow: 'none' }} />API: {online ? 'Connected' : 'Offline'}</span>
            <Link to="/notifications" className="bell" aria-label={`Notifications (${counts.notifications || 0} unread)`}>
              <Icon name="notifications" />
              {counts.notifications > 0 && <span className="ping" />}
            </Link>
            {isFaculty
              ? <Link className="btn" to="/faculty/classes?new=1"><Icon name="add" /><span className="label">Schedule Extra Class</span></Link>
              : <Link className="btn" to="/find"><Icon name="cached" /><span className="label">Instant Swap Match</span></Link>}
          </div>
        </header>
        {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
        <main className="content" key={location.pathname}>{children}</main>
        <footer className="app-footer">
          <span><span className="brandline">Guildspace</span> · Learn from peers · Connect with mentors · Stay connected with faculty</span>
          <span className="mono">Software Engineering Lab · {new Date().getFullYear()}</span>
        </footer>
      </div>
    </div>
  )
}
