export function TableSkeleton({ rows = 12 }) {
  return (
    <div style={{ padding: '8px 16px' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          height: '28px',
          marginBottom: '4px',
          borderRadius: 'var(--r-md)',
          background: 'var(--glass)',
          animation: 'skeleton-pulse 1.5s ease-in-out infinite',
          animationDelay: `${i * 0.05}s`,
          opacity: 0.5 - (i * 0.03),
        }} />
      ))}
    </div>
  )
}

export function KpiSkeleton() {
  return (
    <div className="kpi" style={{ opacity: 0.5 }}>
      <label style={{ width: '60%', height: '10px', background: 'var(--glass)', borderRadius: '2px' }}>&nbsp;</label>
      <strong style={{ width: '40%', height: '20px', background: 'var(--glass)', borderRadius: '4px', display: 'block', marginTop: '6px' }}>&nbsp;</strong>
    </div>
  )
}
