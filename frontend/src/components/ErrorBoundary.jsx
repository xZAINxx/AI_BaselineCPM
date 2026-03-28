import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo })
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const stack = this.state.error?.stack || this.state.error?.message || 'Unknown error'

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '32px',
          height: '100%',
          minHeight: '200px',
          background: 'var(--surface-1)',
          color: 'var(--text-1)',
        }}
      >
        <div
          style={{
            padding: '20px 28px',
            borderRadius: 'var(--r-lg)',
            border: '1px solid var(--red)',
            background: 'var(--surface-2)',
            maxWidth: '520px',
            width: '100%',
          }}
        >
          <h2 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--red)' }}>Something went wrong</h2>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--text-2)' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <pre
            style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              background: 'var(--surface-3)',
              padding: '10px',
              borderRadius: 'var(--r-md)',
              overflow: 'auto',
              maxHeight: '150px',
              color: 'var(--text-3)',
              margin: '0 0 12px',
            }}
          >
            {stack}
          </pre>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => window.location.reload()}
              style={{ fontSize: '11px', padding: '6px 14px' }}
            >
              Reload
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                navigator.clipboard.writeText(stack).catch(() => {})
              }}
              style={{ fontSize: '11px', padding: '6px 14px' }}
            >
              Copy error
            </button>
          </div>
        </div>
      </div>
    )
  }
}
