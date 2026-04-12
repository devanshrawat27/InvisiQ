/**
 * FlashAlert — non-dismissible banner for system messages.
 * Auto-clears after 8 seconds. Glassmorphism with accent border.
 */

const typeConfig = {
  info:        { icon: 'ℹ️', color: '#6366f1', bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.2)' },
  warning:     { icon: '⚠️', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' },
  urgent:      { icon: '🚨', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)' },
  turn_called: { icon: '🔔', color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)' },
};

export default function FlashAlert({ message, type = 'info' }) {
  if (!message) return null;

  const config = typeConfig[type] || typeConfig.info;

  return (
    <div
      className="w-full p-4 rounded-xl text-sm font-medium animate-flash-in backdrop-blur-sm"
      style={{
        background: config.bg,
        borderLeft: `3px solid ${config.color}`,
        color: config.color,
      }}
      role="alert"
      id="flash-alert-banner"
    >
      <div className="flex items-center gap-2.5">
        <span className="text-base flex-shrink-0">{config.icon}</span>
        <span className="font-medium">{message}</span>
      </div>
    </div>
  );
}
