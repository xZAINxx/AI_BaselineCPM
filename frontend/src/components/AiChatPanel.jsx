/**
 * Collapsible AI assistant drawer: chat with Claude, optional auto-apply, action preview.
 * Cross-component prompts: window.dispatchEvent(new CustomEvent('ai-chat-prompt', { detail: { prompt: '...' } }))
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const QUICK_ACTIONS = [
  { label: 'Summarize schedule', prompt: 'Briefly summarize this schedule: activity count, critical share, and main risks from the context.' },
  { label: 'Explain critical path', prompt: 'Explain the critical path conceptually based on the activities and relationships in context. Do not invent task IDs.' },
  { label: 'Reduce open starts', prompt: 'Suggest minimal JSON actions to reduce open-start activities (add a start milestone or predecessors where logical).' },
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
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoApply, setAutoApply] = useState(false)
  const [lastPreview, setLastPreview] = useState(null)
  const [lastError, setLastError] = useState(null)
  const [needsKey, setNeedsKey] = useState(false)
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
    }
  }, [projId])

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
          }),
        })
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
    [apiBase, projId, autoApply, onScheduleChanged]
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
                  <div className="ai-msg-body">{m.content}</div>
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
              <details className="ai-preview" open>
                <summary>Action preview ({lastPreview.length})</summary>
                <pre>{JSON.stringify(lastPreview, null, 2)}</pre>
              </details>
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
