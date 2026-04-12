import { useMemo } from 'react';

/**
 * NotificationTray — shows last 5 system events with dark mode.
 */
export default function NotificationTray({ notifications = [], dark }) {
  const items = useMemo(() => notifications.slice(0, 5), [notifications]);

  const cardClass = dark ? 'card-dark' : 'card';
  const headingClass = dark ? 'text-on-surface-dark-variant' : 'text-on-surface-variant';

  if (items.length === 0) {
    return (
      <div className={cardClass} id="notification-tray">
        <h3 className={`font-display text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2 ${headingClass}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-warning" />
          Notifications
        </h3>
        <p className={`text-xs text-center py-6 ${headingClass}`}>No alerts yet</p>
      </div>
    );
  }

  const typeStyles = {
    fraud_alert:       { icon: '🛡️', color: '#ef4444' },
    surge_alert:       { icon: '⚡', color: '#f59e0b' },
    ghost_removal:     { icon: '👻', color: '#6b7280' },
    user_called:       { icon: '📢', color: '#1a7db9' },
    service_completed: { icon: '✅', color: '#10b981' },
  };

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Math.round((Date.now() - ts) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m ago`;
    return `${Math.round(diff / 60)}h ago`;
  }

  return (
    <div className={cardClass} id="notification-tray">
      <h3 className={`font-display text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2 ${headingClass}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-warning" />
        Notifications
        <span className="ml-auto text-[10px] font-normal"
          style={{ color: dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)' }}>
          {items.length} events
        </span>
      </h3>
      <div className="space-y-2">
        {items.map((note, i) => {
          const style = typeStyles[note.type] || typeStyles.user_called;
          return (
            <div key={i} className={dark ? 'notif-item-dark' : 'flex items-start gap-2 p-3 rounded-xl transition-all duration-200 hover:bg-surface-container-low/50'}
              style={!dark ? { background: `${style.color}08`, border: `1px solid ${style.color}15` } : {}}>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: `${style.color}15` }}>
                <span className="text-xs">{style.icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium truncate ${dark ? 'text-on-surface-dark' : 'text-on-surface'}`}
                  style={{ color: dark ? 'rgba(255,255,255,0.85)' : undefined }}>
                  {note.message}
                </p>
                <p className={`text-[10px] mt-0.5 ${dark ? 'text-on-surface-dark-variant' : 'text-on-surface-variant'}`}>
                  {timeAgo(note.timestamp)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
