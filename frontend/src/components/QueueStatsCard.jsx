/**
 * QueueStatsCard — premium stat tiles with dark mode.
 * Congestion level shown with colour indicator.
 */
export default function QueueStatsCard({ count, avgWait, congestion, countersOpen, dark }) {
  const congestionStyles = {
    normal: { bg: dark ? 'rgba(16,185,129,0.1)' : undefined, cls: 'bg-success/10 text-success', label: 'Normal', icon: '●' },
    high:   { bg: dark ? 'rgba(245,158,11,0.1)' : undefined, cls: 'bg-warning/10 text-warning', label: 'High', icon: '●' },
    surge:  { bg: dark ? 'rgba(239,68,68,0.1)' : undefined, cls: 'bg-danger/10 text-danger',  label: 'Surge', icon: '●' },
  };

  const cong = congestionStyles[congestion] || congestionStyles.normal;

  const stats = [
    { label: 'In Queue', value: count ?? 0, color: '#1a7db9' },
    { label: 'Avg Wait', value: `${avgWait ?? 0}m`, color: '#6366f1' },
    { label: 'Counters', value: countersOpen ?? 1, color: '#10b981' },
  ];

  return (
    <div className={dark ? 'card-dark' : 'card'} id="queue-stats-card">
      <div className="flex items-center justify-between mb-5">
        <h3 className={`font-display text-sm font-bold uppercase tracking-wider flex items-center gap-2 ${
          dark ? 'text-on-surface-dark-variant' : 'text-on-surface-variant'
        }`}>
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          Queue Status
        </h3>
        <span className={`pill text-xs ${cong.cls} ${congestion === 'surge' ? 'animate-pulse' : ''}`}
          style={dark ? { background: cong.bg, border: '1px solid rgba(255,255,255,0.06)' } : {}}>
          {cong.icon} {cong.label}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {stats.map((stat, i) => (
          <div key={stat.label} className={`text-center py-4 rounded-xl transition-all duration-300 ${
            dark ? 'stat-tile-dark' : 'bg-gradient-to-b from-surface-container-low to-transparent hover:from-surface-container-high'
          }`}>
            <p className={`font-display text-2xl font-bold ${dark ? 'text-white' : 'text-on-surface'}`}
              style={dark ? { color: stat.color } : {}}>
              {stat.value}
            </p>
            <p className={`text-[10px] uppercase tracking-wider mt-1.5 font-medium ${
              dark ? 'text-on-surface-dark-variant' : 'text-on-surface-variant'
            }`}>{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
