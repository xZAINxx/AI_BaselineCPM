/**
 * Collapsible AI assistant drawer: chat with Claude, optional auto-apply, action preview.
 * Cross-component prompts: window.dispatchEvent(new CustomEvent('ai-chat-prompt', { detail: { prompt: '...' } }))
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'

function generateSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function MarkdownContent({ content }) {
  const html = useMemo(() => {
    try {
      return marked.parse(content || '', { breaks: true, gfm: true })
    } catch {
      return content || ''
    }
  }, [content])
  return <div className="ai-msg-body ai-markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

const QUICK_ACTIONS = [
  { label: 'Summarize', prompt: 'Briefly summarize this schedule: activity count, critical share, DCMA score, and main risks.' },
  { label: 'Critical path', prompt: 'Explain the critical path: list the top 10 longest-duration critical activities and identify whether high critical % is from SS relationships, constraints, or other causes.' },
  { label: 'DCMA review', prompt: 'Review this schedule against all DCMA 14-Point Assessment criteria. For each check, state pass/fail with the value and threshold. For failures, give specific corrective actions.' },
  { label: 'Fix open ends', prompt: 'Identify activities with no predecessors or no successors. For each, suggest a specific relationship. Output JSON actions.' },
  { label: 'Float analysis', prompt: 'Analyze float distribution: negative, zero, 1-5d, 5-20d, 20+d. Identify near-critical paths and which activities could become critical.' },
  { label: 'Network analysis', prompt: 'Analyze the schedule network: critical path drivers, float consumption risks, logic gaps, relationship density, and overall health score 0-100.' },
]

export default function AiChatPanel({
  open,
  onOpenChange,
  projId,
  apiBase = '/api',
  onScheduleChanged,
  pendingPrompt,
  onPendingPromptConsumed,
}) {
  const [messages, setMessages] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoApply, setAutoApply] = useState(false)
  const [lastPreview, setLastPreview] = useState(null)
  const [lastError, setLastError] = useState(null)
  const [needsKey, setNeedsKey] = useState(false)
  const [selectedActions, setSelectedActions] = useState({})
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState(null)
  const [rejectionMode, setRejectionMode] = useState(false)
  const [rejectionText, setRejectionText] = useState('')
  const [rejectionLoading, setRejectionLoading] = useState(false)
  const [drawerWidth, setDrawerWidth] = useState(420)
  const [chatHistory, setChatHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const runChatRef = useRef(null)
  const messagesEndRef = useRef(null)
  const dragDrawerRef = useRef({ active: false })

  useEffect(() => {
    if (!projId) {
      setMessages([])
      setLastPreview(null)
      setLastError(null)
      setNeedsKey(false)
      setSessionId(null)
    } else {
      setSessionId(generateSessionId())
    }
  }, [projId])

  useEffect(() => {
    if (!open || !projId) return
    let cancelled = false
    fetch(`${apiBase}/ai/chat/sessions?proj_id=${encodeURIComponent(projId)}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (!cancelled) setChatHistory(Array.isArray(data) ? data : []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, projId, apiBase, sessionId])

  useEffect(() => {
    if (lastPreview?.length) {
      const sel = {}
      lastPreview.forEach((_, i) => { sel[i] = true })
      setSelectedActions(sel)
    } else {
      setSelectedActions({})
    }
    setApplyResult(null)
  }, [lastPreview])

  const applySelected = async () => {
    if (!projId || !lastPreview?.length || applying) return
    const toApply = lastPreview.filter((_, i) => selectedActions[i])
    if (toApply.length === 0) return
    setApplying(true)
    setApplyResult(null)
    try {
      const res = await fetch(`${apiBase}/ai/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proj_id: projId, actions: toApply }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setApplyResult({ ok: true, applied: data.applied || [], cpm_error: data.cpm_error })
      if (data.applied?.length) {
        onScheduleChanged?.()
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Applied ${data.applied.length} action(s): ${data.applied.join(', ')}${data.cpm_error ? `\nCPM warning: ${data.cpm_error}` : '\nCPM recalculated successfully.'}`
        }])
      }
      setLastPreview(null)
    } catch (e) {
      setApplyResult({ ok: false, error: e.message })
    } finally {
      setApplying(false)
    }
  }

  const analyzeRejection = async () => {
    if (!projId || !rejectionText.trim() || rejectionLoading) return
    setRejectionLoading(true)
    setLastError(null)

    const userMsg = `[Rejection Comments Analysis]\n${rejectionText.trim()}`
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])

    try {
      const res = await fetch(`${apiBase}/ai/analyze-rejection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proj_id: projId,
          comments: rejectionText.trim(),
          session_id: sessionId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const d = data.detail
        const msg = typeof d === 'string' ? d : JSON.stringify(data)
        throw new Error(msg || `HTTP ${res.status}`)
      }
      if (data.error) setLastError(data.error)
      if (data.needs_api_key) setNeedsKey(true)

      const reply = data.reply || '(no reply)'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
      setLastPreview(data.actions_preview || null)
      setRejectionText('')
      setRejectionMode(false)
    } catch (e) {
      setLastError(e.message || 'Request failed')
    } finally {
      setRejectionLoading(false)
    }
  }

  const runChat = useCallback(
    async (messageList) => {
      if (!projId || !messageList.length) return
      setLoading(true)
      setLastError(null)
      setNeedsKey(false)
      try {
        const res = await fetch(`${apiBase}/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proj_id: projId,
            messages: messageList,
            auto_apply: autoApply,
            session_id: sessionId,
          }),
        })
        if (res.status === 404 || res.status === 501) {
          setNeedsKey(false)
          setLastError('AI assistant requires backend setup. See README.')
          setLoading(false)
          return
        }
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const d = data.detail
          const msg =
            typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join(', ') : JSON.stringify(data)
          throw new Error(msg || `HTTP ${res.status}`)
        }
        if (data.error) setLastError(data.error)
        if (data.needs_api_key) setNeedsKey(true)
        const reply = data.reply || '(no reply)'
        setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
        setLastPreview(data.actions_preview || null)
        if (data.cpm_error)
          setLastError((prev) =>
            prev ? `${prev}; CPM: ${data.cpm_error}` : `CPM: ${data.cpm_error}`
          )
        if (data.actions_applied?.length && onScheduleChanged) onScheduleChanged()
      } catch (e) {
        setLastError(e.message || 'Request failed')
      } finally {
        setLoading(false)
      }
    },
    [apiBase, projId, autoApply, sessionId, onScheduleChanged]
  )

  runChatRef.current = runChat

  useEffect(() => {
    if (!pendingPrompt || !projId || !open) return
    const p = pendingPrompt
    onPendingPromptConsumed?.()
    const next = [...messagesRef.current, { role: 'user', content: p }]
    setMessages(next)
    void runChatRef.current?.(next)
  }, [pendingPrompt, projId, open, onPendingPromptConsumed])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  useEffect(() => {
    const onMove = (e) => {
      if (!dragDrawerRef.current.active) return
      const newWidth = window.innerWidth - e.clientX
      const maxWidth = window.innerWidth * 0.8
      setDrawerWidth(Math.min(maxWidth, Math.max(320, newWidth)))
    }
    const onUp = () => {
      dragDrawerRef.current.active = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const onDrawerResizeDown = (e) => {
    e.preventDefault()
    dragDrawerRef.current = { active: true }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const send = () => {
    const text = input.trim()
    if (!text || !projId || loading) return
    setInput('')
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    void runChat(next)
  }

  const loadSession = async (sid) => {
    if (historyLoading) return
    setHistoryLoading(true)
    try {
      const res = await fetch(`${apiBase}/ai/chat/sessions/${encodeURIComponent(sid)}`)
      if (!res.ok) throw new Error('Failed to load session')
      const data = await res.json()
      const restored = (data.messages || []).map(m => ({
        role: m.role,
        content: m.content,
      }))
      setMessages(restored)
      setSessionId(sid)
      const lastAssistant = [...(data.messages || [])].reverse().find(m => m.role === 'assistant' && m.actions?.length > 0)
      if (lastAssistant) {
        setLastPreview(lastAssistant.actions)
      } else {
        setLastPreview(null)
      }
      setShowHistory(false)
      setLastError(null)
      setNeedsKey(false)
    } catch (e) {
      setLastError(e.message)
    } finally {
      setHistoryLoading(false)
    }
  }

  const deleteSession = async (sid) => {
    if (!window.confirm('Delete this conversation?')) return
    try {
      await fetch(`${apiBase}/ai/chat/sessions/${encodeURIComponent(sid)}`, { method: 'DELETE' })
      setChatHistory(prev => prev.filter(s => s.id !== sid))
      if (sid === sessionId) {
        setSessionId(generateSessionId())
        setMessages([])
        setLastPreview(null)
      }
    } catch {}
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <>
      <button
        type="button"
        className="ai-fab"
        title="AI schedule assistant"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        disabled={!projId}
      >
        AI
      </button>

      <div className={`ai-drawer-backdrop ${open ? 'open' : ''}`} aria-hidden={!open} onClick={() => onOpenChange(false)} />

      <aside
        className={`ai-drawer ${open ? 'open' : ''}`}
        aria-label="AI assistant"
        style={{ width: drawerWidth }}
      >
        <div
          className="ai-drawer-resize"
          onMouseDown={onDrawerResizeDown}
          role="separator"
          aria-orientation="vertical"
        />
        <div className="ai-drawer-header">
          <h2>Schedule assistant</h2>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: '10px', padding: '2px 8px', marginLeft: 'auto' }}
            onClick={() => setShowHistory(!showHistory)}
            title="View past conversations"
          >
            {showHistory ? 'Back to chat' : `History (${chatHistory.length})`}
          </button>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: '10px', padding: '2px 8px', marginRight: '8px' }}
            onClick={() => {
              const newSid = generateSessionId()
              setSessionId(newSid)
              setMessages([])
              setLastPreview(null)
              setLastError(null)
              setApplyResult(null)
              setShowHistory(false)
              fetch(`${apiBase}/ai/chat/sessions?proj_id=${encodeURIComponent(projId)}`)
                .then(r => r.ok ? r.json() : [])
                .then(data => setChatHistory(Array.isArray(data) ? data : []))
                .catch(() => {})
            }}
            title="Start fresh conversation (resets cached context)"
          >
            New chat
          </button>
          <button type="button" className="ai-drawer-close" onClick={() => onOpenChange(false)} aria-label="Close">
            ×
          </button>
        </div>

        {!projId ? (
          <p className="ai-drawer-hint">Import or select a project to use the assistant.</p>
        ) : (
          <>
            <div className="ai-quick-actions">
              {QUICK_ACTIONS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  className="btn-secondary ai-quick-btn"
                  disabled={loading}
                  onClick={() => {
                    const next = [...messagesRef.current, { role: 'user', content: q.prompt }]
                    setMessages(next)
                    void runChat(next)
                  }}
                >
                  {q.label}
                </button>
              ))}
            </div>

            <label className="ai-auto-apply">
              <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
              Auto-apply model actions (runs CPM after)
            </label>

            {sessionId && messages.length > 0 ? (
              <div style={{ padding: '0 16px 4px', fontSize: '9px', color: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}>
                Session: {sessionId.slice(5, 17)} · {messages.length} msg{messages.length !== 1 ? 's' : ''} · Context cached after 1st msg
              </div>
            ) : null}

            {needsKey ? (
              <div className="ai-banner danger" role="alert">
                Set <code>ANTHROPIC_API_KEY</code> in <code>backend/.env</code> and restart the API.
              </div>
            ) : null}
            {lastError ? (
              <div className="ai-banner danger" role="alert">
                {lastError}
              </div>
            ) : null}

            {showHistory ? (
              <div className="ai-messages" style={{ gap: '4px' }}>
                {chatHistory.length === 0 ? (
                  <p style={{ color: 'var(--text-3)', fontSize: '12px', textAlign: 'center', padding: '24px' }}>
                    No past conversations for this project.
                  </p>
                ) : null}
                {chatHistory.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="ai-history-item"
                    onClick={() => loadSession(s.id)}
                    disabled={historyLoading}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      padding: '10px 12px',
                      borderRadius: 'var(--r-lg)',
                      border: s.id === sessionId ? '1px solid var(--indigo)' : '1px solid var(--border-1)',
                      background: s.id === sessionId ? 'var(--indigo-dim)' : 'var(--glass)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'border-color 150ms',
                    }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-1)', lineHeight: '1.3' }}>
                      {s.title || 'Untitled'}
                    </span>
                    <span style={{ fontSize: '9px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                      {s.message_count} msg · {s.updated_at?.slice(0, 16)?.replace('T', ' ') || ''}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteSession(s.id)
                      }}
                      style={{
                        alignSelf: 'flex-end',
                        fontSize: '9px',
                        color: 'var(--text-3)',
                        background: 'none',
                        border: 'none',
                        padding: '2px 4px',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  </button>
                ))}
              </div>
            ) : (
              <div className="ai-messages">
                {messages.map((m, i) => (
                  <div key={`${m.role}-${i}`} className={`ai-msg ai-msg-${m.role}`}>
                    <span className="ai-msg-role">{m.role === 'user' ? 'You' : 'Assistant'}</span>
                    {m.role === 'assistant' ? (
                      <MarkdownContent content={m.content} />
                    ) : (
                      <div className="ai-msg-body">{m.content}</div>
                    )}
                  </div>
                ))}
                {loading ? (
                  <div className="ai-loading" aria-busy="true">
                    <span className="ai-dot" />
                    <span className="ai-dot" />
                    <span className="ai-dot" />
                  </div>
                ) : null}
                <div ref={messagesEndRef} className="ai-messages-end" aria-hidden />
              </div>
            )}

            {lastPreview?.length ? (
              <div className="ai-preview" style={{ margin: '0 16px 8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '11px', color: 'var(--text-1)' }}>
                    Actions ({Object.values(selectedActions).filter(Boolean).length}/{lastPreview.length} selected)
                  </strong>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: '10px', padding: '2px 8px' }}
                      onClick={() => {
                        const all = {}
                        lastPreview.forEach((_, i) => { all[i] = true })
                        setSelectedActions(all)
                      }}
                    >All</button>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: '10px', padding: '2px 8px' }}
                      onClick={() => setSelectedActions({})}
                    >None</button>
                  </div>
                </div>
                <div style={{ maxHeight: '160px', overflow: 'auto' }}>
                  {lastPreview.map((action, i) => (
                    <label key={i} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '10px', color: 'var(--text-2)', padding: '3px 0', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={!!selectedActions[i]}
                        onChange={(e) => setSelectedActions(prev => ({ ...prev, [i]: e.target.checked }))}
                        style={{ marginTop: '2px', accentColor: 'var(--indigo)' }}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)', lineHeight: '1.3' }}>
                        <strong style={{ color: 'var(--text-1)' }}>{action.op}</strong>
                        {action.op === 'add_relationship' ? ` ${action.pred_id} → ${action.succ_id} (${action.rel_type || 'FS'})` : ''}
                        {action.op === 'add_activity' ? ` ${action.task_id}: ${action.name || ''}` : ''}
                        {action.op === 'modify_activity' ? ` ${action.task_id}` : ''}
                        {action.op === 'delete_activity' ? ` ${action.task_id}` : ''}
                        {action.op === 'delete_relationship' ? ` id=${action.id}` : ''}
                        {action._reason ? <span style={{ color: 'var(--text-3)', display: 'block', marginLeft: '0' }}>{action._reason}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
                {lastPreview?.some(a => a.op?.startsWith('delete')) ? (
                  <div style={{ fontSize: '10px', color: 'var(--red)', marginBottom: '4px' }}>
                    ⚠ This includes delete operations that cannot be undone.
                  </div>
                ) : null}
                <div style={{ marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ fontSize: '11px', padding: '5px 12px' }}
                    onClick={applySelected}
                    disabled={applying || Object.values(selectedActions).filter(Boolean).length === 0}
                  >
                    {applying ? 'Applying…' : `Apply ${Object.values(selectedActions).filter(Boolean).length} action(s)`}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: '10px', padding: '4px 8px' }}
                    onClick={() => setLastPreview(null)}
                  >Dismiss</button>
                </div>
                {applyResult?.ok ? (
                  <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--emerald)' }}>
                    ✓ Applied {applyResult.applied?.length || 0} action(s). CPM recalculated.
                    {applyResult.cpm_error ? <span style={{ color: 'var(--amber)' }}> Warning: {applyResult.cpm_error}</span> : null}
                  </div>
                ) : null}
                {applyResult && !applyResult.ok ? (
                  <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--red)' }}>
                    ✗ {applyResult.error}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Rejection Comments Section */}
            <div style={{ padding: '0 16px 8px' }}>
              <button
                type="button"
                className="btn-secondary"
                style={{
                  fontSize: '11px',
                  padding: '5px 12px',
                  width: '100%',
                  background: rejectionMode ? 'var(--amber-dim)' : undefined,
                  borderColor: rejectionMode ? 'var(--amber)' : undefined,
                  color: rejectionMode ? 'var(--amber)' : undefined,
                }}
                onClick={() => setRejectionMode(!rejectionMode)}
                disabled={loading || rejectionLoading}
              >
                {rejectionMode ? '▾ Hide Rejection Comments' : '▸ Paste Rejection Comments'}
              </button>

              {rejectionMode ? (
                <div style={{
                  marginTop: '8px',
                  padding: '10px',
                  border: '1px solid var(--amber)',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--amber-dim)',
                }}>
                  <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: '6px' }}>
                    Paste reviewer/SCA rejection comments below. The AI will analyze them against your schedule and suggest corrective actions.
                  </label>
                  <textarea
                    value={rejectionText}
                    onChange={(e) => setRejectionText(e.target.value)}
                    placeholder={'Paste rejection comments here...\n\nExample:\n- Activity A2410 has excessive float (120 days). Add FS to punch list.\n- Submittal activities need approval gates before field work.'}
                    rows={6}
                    disabled={rejectionLoading}
                    style={{
                      width: '100%',
                      resize: 'vertical',
                      minHeight: '80px',
                      padding: '8px 10px',
                      borderRadius: 'var(--r-md)',
                      border: '1px solid var(--border-1)',
                      background: 'var(--surface-2)',
                      color: 'var(--text-1)',
                      fontFamily: 'var(--font-sans)',
                      fontSize: '11px',
                    }}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ fontSize: '11px', padding: '5px 12px', marginTop: '8px' }}
                    onClick={analyzeRejection}
                    disabled={rejectionLoading || !rejectionText.trim()}
                  >
                    {rejectionLoading ? 'Analyzing…' : 'Analyze & Suggest Fixes'}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="ai-compose">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask about the schedule…"
                rows={3}
                disabled={loading}
              />
              <button type="button" className="btn-primary ai-send" onClick={send} disabled={loading || !input.trim()}>
                Send
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  )
}
