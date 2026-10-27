import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, errorText } from '../api'
import { useAuth } from '../auth.jsx'
import { useApi, Loading, ErrorBox, Empty, Avatar, Stars, SourceBadge, Modal } from '../components/ui.jsx'
import { Icon } from '../components/brand.jsx'
import { useToast } from '../components/feedback.jsx'

export default function FindMentors() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'mentors'
  const setTab = (t) => setParams(t === 'mentors' ? {} : { tab: t })
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow"><span className="live-dot" /> Peer match engine active</div>
          <h1>Find Mentors & Reciprocal Swaps</h1>
          <p>Ranked live from everyone's skills, availability, interaction preferences and ratings.</p>
        </div>
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'mentors' ? 'active' : ''}`} onClick={() => setTab('mentors')}>Recommended mentors</button>
        <button className={`tab ${tab === 'learners' ? 'active' : ''}`} onClick={() => setTab('learners')}>Learners I can help</button>
        <button className={`tab ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>Search</button>
      </div>
      {tab === 'mentors' && <MentorMatches initialSkill={params.get('skill') || ''} />}
      {tab === 'learners' && <LearnerMatches />}
      {tab === 'search' && <Search key={params.get('q') || ''} initialQ={params.get('q') || ''} />}
    </>
  )
}

function MentorMatches({ initialSkill }) {
  const { user } = useAuth()
  const toast = useToast()
  const needed = user.skills.filter((s) => s.skill_type === 'NEEDED')
  const [skillId, setSkillId] = useState(initialSkill)
  const [sort, setSort] = useState('score')
  const [twoWayOnly, setTwoWayOnly] = useState(false)
  const { data: matches, loading, error, reload } = useApi(`/api/matches${skillId ? `?skill_id=${skillId}` : ''}`)
  const [selectedKey, setSelectedKey] = useState(null)
  const [requesting, setRequesting] = useState(null)

  const list = useMemo(() => {
    let l = [...(matches || [])]
    if (twoWayOnly) l = l.filter((m) => m.mutual_skills.length)
    if (sort === 'rating') l.sort((a, b) => (b.avg_rating ?? -1) - (a.avg_rating ?? -1))
    if (sort === 'overlap') l.sort((a, b) => b.overlap_minutes - a.overlap_minutes)
    return l
  }, [matches, sort, twoWayOnly])

  if (needed.length === 0) {
    return <div className="card"><Empty title="Tell us what you want to learn">Add a skill you need on your <Link to="/profile">profile</Link> to get mentor recommendations.</Empty></div>
  }
  const keyOf = (m) => `${m.mentor_id}-${m.skill_id}`
  const selected = list.find((m) => keyOf(m) === selectedKey) || list[0]
  const twoWay = (matches || []).filter((m) => m.mutual_skills.length).length

  return (
    <>
      <div className="hero-match" style={{ padding: '22px 26px' }}>
        <div className="row" style={{ gap: 16, flex: 1 }}>
          <span className="ico" style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(255,255,255,.12)', display: 'grid', placeItems: 'center' }}><Icon name="auto_awesome" size={28} /></span>
          <div>
            <div className="row"><span className="chip-dark green">MATCHES FOR YOU</span><span className="mono" style={{ color: '#C7D2FE', fontSize: 12 }}>Based on your profile: {needed.map((s) => s.skill_name).join(' / ')}</span></div>
            <h2 style={{ fontSize: 21, marginTop: 8 }}>
              {loading && !matches ? 'Finding peers…' : `We found ${matches?.length || 0} mentor match${matches?.length === 1 ? '' : 'es'} for your learning goals${twoWay ? `, ${twoWay} of them two-way swaps` : ''}.`}
            </h2>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="row between">
          <div className="row">
            <span className="upper">Skill:</span>
            <button className={`chip filter ${!skillId ? 'active' : ''}`} onClick={() => setSkillId('')}>All my goals</button>
            {needed.map((s) => (
              <button key={s.skill_id} className={`chip filter ${String(s.skill_id) === String(skillId) ? 'active' : ''}`} onClick={() => setSkillId(String(s.skill_id))}>{s.skill_name}</button>
            ))}
          </div>
          <div className="row">
            <select style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              <option value="score">Highest compatibility</option><option value="rating">Highest rating</option><option value="overlap">Most shared time</option>
            </select>
            <label className="row" style={{ margin: 0, gap: 8, border: '1px solid var(--success-border)', background: 'var(--success-soft)', borderRadius: 10, padding: '8px 12px', color: 'var(--success-text)' }}>
              <input type="checkbox" checked={twoWayOnly} onChange={(e) => setTwoWayOnly(e.target.checked)} /> Two-way swaps only
            </label>
          </div>
        </div>
      </div>

      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {loading && !matches ? <Loading /> : list.length === 0 ? (
        <div className="card"><Empty title={twoWayOnly ? 'No two-way swaps for these skills yet' : 'No mentors offer this skill yet'}>Try another skill, or the Search tab.</Empty></div>
      ) : (
        <div className="layout-rail">
          <div>
            <div className="row between" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Available Peer Mentors <span className="badge mono-tag">{list.length} found</span></h2>
              <span className="small muted">Sorted by {sort === 'score' ? 'compatibility' : sort === 'rating' ? 'rating' : 'shared time'}</span>
            </div>
            <div className="stack">
              {list.map((m) => (
                <MatchCard key={keyOf(m)} m={m} selected={selected && keyOf(selected) === keyOf(m)}
                  onSelect={() => setSelectedKey(keyOf(m))} onRequest={() => setRequesting(m)} />
              ))}
            </div>
          </div>
          {selected && <Breakdown m={selected} onRequest={() => setRequesting(selected)} />}
        </div>
      )}
      {requesting && (
        <RequestModal match={requesting} onClose={() => setRequesting(null)}
          onSent={() => { toast(`Request sent to ${requesting.mentor_name}. You'll be notified when they respond.`); setRequesting(null); reload() }} />
      )}
    </>
  )
}

function MatchCard({ m, selected, onSelect, onRequest }) {
  const [narrative, setNarrative] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const explain = async (e) => {
    e.stopPropagation()
    setBusy(true)
    try {
      const { data } = await api.get(`/api/matches/${m.mentor_id}/explain`, { params: { skill_id: m.skill_id } })
      setNarrative(data)
    } catch (err) { toast(errorText(err), 'error') } finally { setBusy(false) }
  }
  const slot = m.shared_slots[0]

  return (
    <div className={`card interactive`} onClick={onSelect} style={{ cursor: 'pointer', ...(selected ? { borderColor: '#6366F1', boxShadow: 'var(--shadow-hover)' } : {}) }}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 12 }}>
          <Avatar name={m.mentor_name} size={48} />
          <div>
            <div className="row" style={{ gap: 6 }}>
              <Link to={`/users/${m.mentor_id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--text)', fontSize: 16, fontWeight: 700 }}>{m.mentor_name}</Link>
              {m.rating_count > 0 && <Icon name="verified" fill size={18} style={{ color: 'var(--primary)' }} />}
            </div>
            <div className="small muted">{m.mentor_level?.toLowerCase()} in {m.skill_name} · {m.location || 'no location'} · <Stars value={m.avg_rating} /> {m.rating_count > 0 && <span>({m.rating_count} reviews)</span>}{m.reliability != null && <> · <span style={{ color: m.reliability >= 90 ? 'var(--success)' : 'var(--warn)', fontWeight: 600 }}>{m.reliability}% reliable</span></>}</div>
          </div>
        </div>
        <span className="badge match" style={{ fontSize: 13, padding: '4px 12px' }}><Icon name="verified_user" size={16} />{m.compatibility_score}% Match</span>
      </div>

      <div className="why-box">
        <div className="tag-label"><Icon name="psychology" size={16} /> Why this {m.mutual_skills.length ? 'reciprocal ' : ''}match?</div>
        {narrative ? (
          <><div style={{ marginBottom: 6 }}><SourceBadge source={narrative.narrative_source} /></div>{narrative.narrative}</>
        ) : (
          <>{m.match_explanation.join(' ')}{slot && <> Shared free time: <strong>{slot.day} {slot.start}–{slot.end}</strong>.</>}</>
        )}
      </div>

      <div className="grid two" style={{ gap: 16, marginTop: 14 }}>
        <div>
          <div className="tag-label teach"><Icon name="school" size={16} /> Teaches</div>
          <div className="chips">{m.mentor_teaches.map((s) => <span key={s.skill_id} className="chip teach">{s.name}</span>)}</div>
        </div>
        <div>
          <div className="tag-label want"><Icon name="lightbulb" size={16} /> Wants to learn</div>
          <div className="chips">{m.mentor_wants.length ? m.mentor_wants.map((s) => <span key={s.skill_id} className="chip want">{s.name}</span>) : <span className="small muted">Nothing listed</span>}</div>
        </div>
      </div>

      <hr className="divider" />
      <div className="row between">
        <span className="small muted row" style={{ gap: 6 }}><Icon name="headphones" size={16} />{m.mode.toLowerCase()} · <Icon name="location_on" size={16} />{m.location || '—'}</span>
        <div className="row">
          <button className="btn small ghost" onClick={explain} disabled={busy}>{busy ? 'Explaining…' : 'Explain match'}</button>
          <button className="btn small" onClick={(e) => { e.stopPropagation(); onRequest() }}>Request Mentorship <Icon name="arrow_forward" /></button>
        </div>
      </div>
    </div>
  )
}

function Breakdown({ m, onRequest }) {
  const color = (f) => (f.points < 0 ? 'var(--danger)' : f.points === f.max ? 'var(--success)' : f.points > 0 ? 'var(--primary)' : 'var(--faint)')
  return (
    <div className="card" style={{ position: 'sticky', top: 84, borderTop: '4px solid var(--success-strong)' }}>
      <div className="card-head"><h2 className="section-title"><Icon name="tune" />Match Breakdown</h2><span className="badge match">{m.compatibility_score}% Fit</span></div>
      <div className="inner-box row" style={{ gap: 12, marginBottom: 16 }}>
        <Avatar name={m.mentor_name} size={44} />
        <div><strong>{m.mentor_name}</strong><div className="small muted">{m.skill_name} · {m.mentor_level?.toLowerCase()}</div></div>
      </div>
      {m.factors.map((f) => (
        <div key={f.factor} style={{ marginBottom: 12 }}>
          <div className="row between small"><span className="row" style={{ gap: 6, fontWeight: 600 }}><Icon name={f.positive ? 'check_circle' : 'radio_button_unchecked'} size={16} style={{ color: color(f) }} />{f.factor[0].toUpperCase() + f.factor.slice(1)}</span>
            <span className="mono" style={{ color: color(f), fontWeight: 700 }}>{f.penalty ? (f.points ? f.points : '±0') : `${f.points}/${f.max}`}</span></div>
          {f.max > 0 && <div className="bar" style={{ margin: '4px 0' }}><span style={{ width: `${(f.points / f.max) * 100}%`, background: color(f) }} /></div>}
          <div className="small muted">{f.text}</div>
        </div>
      ))}
      <div className="upper" style={{ margin: '16px 0 8px' }}>Shared weekly slots</div>
      {m.shared_slots.length === 0 ? <p className="small muted">No overlap yet. Add availability on your profile.</p> : (
        <div className="grid two" style={{ gap: 8, gridTemplateColumns: '1fr 1fr' }}>
          {m.shared_slots.slice(0, 4).map((s, i) => (
            <div key={i} className="inner-box" style={{ textAlign: 'center' }}><strong className="small">{s.day.slice(0, 3)}</strong><div className="mono small">{s.start}–{s.end}</div></div>
          ))}
        </div>
      )}
      <button className="btn" style={{ width: '100%', marginTop: 16, height: 44 }} onClick={onRequest}>Confirm Mentorship Request <Icon name="send" /></button>
    </div>
  )
}

export function RequestModal({ match, onClose, onSent }) {
  const [message, setMessage] = useState(`Hi ${match.mentor_name.split(' ')[0]}, I'd like help learning ${match.skill_name}.`)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const send = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.post('/api/requests', { mentor_id: match.mentor_id, skill_id: match.skill_id, message })
      onSent()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <Modal title={`Request mentorship from ${match.mentor_name}`} onClose={onClose}>
      <form onSubmit={send}>
        <div className="inner-box row between" style={{ marginBottom: 14 }}>
          <span className="small">Skill: <strong>{match.skill_name}</strong></span>
          <span className="badge match">{match.compatibility_score}% Match</span>
        </div>
        <ErrorBox>{error}</ErrorBox>
        <div className="field">
          <label htmlFor="req-msg">Message</label>
          <textarea id="req-msg" maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}><Icon name="send" /> {busy ? 'Sending…' : 'Send request'}</button>
        </div>
      </form>
    </Modal>
  )
}

function LearnerMatches() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useApi('/api/matches/learners')
  if (!user.skills.some((s) => s.skill_type === 'OFFERED')) {
    return <div className="card"><Empty title="Add a skill you can teach">Learners who need your skills will appear here. <Link to="/profile">Update profile</Link></Empty></div>
  }
  if (loading && !data) return <Loading />
  return (
    <>
      <ErrorBox onRetry={reload}>{error}</ErrorBox>
      {data?.length === 0 ? <div className="card"><Empty title="No learners need your skills right now" /></div> : (
        <div className="grid three">
          {data?.map((m) => (
            <div key={`${m.learner_id}-${m.skill_id}`} className="card interactive">
              <div className="row between"><div className="row"><Avatar name={m.learner_name} size={40} />
                <div><Link to={`/users/${m.learner_id}`} style={{ color: 'var(--text)', fontWeight: 700 }}>{m.learner_name}</Link><div className="small muted">{m.location || '—'} · {m.mode.toLowerCase()}</div></div></div>
                <span className="badge match">{m.compatibility_score}%</span></div>
              <div className="inner-box" style={{ marginTop: 12 }}>
                <div className="tag-label want" style={{ margin: 0 }}>Wants from you</div>
                <div className="small"><strong>{m.skill_name}</strong> · target {m.target_level.toLowerCase()}</div>
                {m.goal && <div className="small muted">Goal: {m.goal}</div>}
              </div>
              <div className="chips" style={{ marginTop: 10 }}>{m.match_explanation.slice(0, 3).map((t) => <span key={t} className="chip" style={{ fontSize: 12 }}>{t}</span>)}</div>
              <Link className="btn small ghost" style={{ marginTop: 12, width: '100%' }} to={`/users/${m.learner_id}`}>View profile</Link>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Search({ initialQ }) {
  const [form, setForm] = useState({ q: initialQ, type: 'any', mode: '', location: '' })
  const [query, setQuery] = useState(initialQ ? { q: initialQ, type: 'any' } : null)
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString() : null
  const { data, loading, error } = useApi(qs !== null ? `/api/search?${qs}` : null)
  return (
    <>
      <form className="card inline-form" onSubmit={(e) => { e.preventDefault(); setQuery({ ...form }) }}>
        <div className="field" style={{ flex: 3, position: 'relative' }}>
          <label htmlFor="s-q">Name, bio or skill</label>
          <input id="s-q" value={form.q} onChange={(e) => setForm({ ...form, q: e.target.value })} placeholder="Search by skill, topic or name (e.g. Python, Figma)…" />
        </div>
        <div className="field">
          <label htmlFor="s-type">Looking for</label>
          <select id="s-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="any">Anyone</option><option value="mentor">Mentors</option><option value="learner">Learners</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-mode">Mode</label>
          <select id="s-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
            <option value="">Any interaction</option><option value="ONLINE">Online</option><option value="OFFLINE">Offline</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="s-loc">Location</label>
          <input id="s-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </div>
        <button className="btn"><Icon name="search" /> Search</button>
      </form>
      <div style={{ marginTop: 20 }}>
        <ErrorBox>{error}</ErrorBox>
        {query === null ? null : loading ? <Loading /> : data?.length === 0 ? <div className="card"><Empty title="No one matches those filters" /></div> : (
          <div className="grid three">
            {data?.map((u) => (
              <Link key={u.id} to={`/users/${u.id}`} className="card" style={{ color: 'inherit', textDecoration: 'none', fontWeight: 400 }}>
                <div className="row"><Avatar name={u.name} size={40} /><div><strong>{u.name}</strong><div className="muted small">{u.location || '—'} · {u.preferred_mode.toLowerCase()}</div></div></div>
                {u.skills.some((s) => s.skill_type === 'OFFERED') && <>
                  <div className="tag-label teach" style={{ marginTop: 12 }}>Teaches</div>
                  <div className="chips">{u.skills.filter((s) => s.skill_type === 'OFFERED').map((s) => <span key={s.id} className="chip teach">{s.skill_name}</span>)}</div>
                </>}
                {u.skills.some((s) => s.skill_type === 'NEEDED') && <>
                  <div className="tag-label want" style={{ marginTop: 10 }}>Wants to learn</div>
                  <div className="chips">{u.skills.filter((s) => s.skill_type === 'NEEDED').map((s) => <span key={s.id} className="chip want">{s.skill_name}</span>)}</div>
                </>}
                <div className="small" style={{ marginTop: 10 }}><Stars value={u.avg_rating} /></div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
