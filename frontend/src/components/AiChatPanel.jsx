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
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const runChatRef = useRef(null)
  const messagesEndRef = useRef(null)

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

  const send = () => {
    const text = input.trim()
    if (!text || !projId || loading) return
    setInput('')
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    void runChat(next)
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

      <aside className={`ai-drawer ${open ? 'open' : ''}`} aria-label="AI assistant">
        <div className="ai-drawer-header">
          <h2>Schedule assistant</h2>
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: '10px', padding: '2px 8px', marginLeft: 'auto', marginRight: '8px' }}
            onClick={() => {
              setSessionId(generateSessionId())
              setMessages([])
              setLastPreview(null)
              setLastError(null)
              setApplyResult(null)
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
