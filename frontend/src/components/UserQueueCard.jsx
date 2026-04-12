import { useState, useEffect, useMemo } from 'react';
import IntentBadge from './IntentBadge';

/**
 * UserQueueCard — admin queue list item with dark mode support.
 * Shows position, name, token, intent, priority, ghost, sentiment, wait time.
 * Action buttons: Call (for waiting), Attended/Done/Remove (for called/in_service).
 */
export default function UserQueueCard({
  user,
  ghostFlags = {},
  dark,
  onCallUser,
  onAttended,
  onRemoved,
  onDone,
  actionLoading,
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!user.join_time) return;
    const update = () => setElapsed(Math.round((Date.now() - user.join_time) / 60000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [user.join_time]);

  const isGhost = ghostFlags[user.userId];
  const isRedGhost = user.bail_probability > 85;

  // Sentiment emoji
  const sentimentEmoji = useMemo(() => {
    const level = user.sentiment_level || 0;
    if (level >= 5) return '🚨';
    if (level >= 4) return '😤';
    if (level >= 3) return '😐';
    if (level >= 2) return '😊';
    return null;
  }, [user.sentiment_level]);

  const isFirst = user.position === 1;
  const isWaiting = user.status === 'waiting';
  const isCalled = user.status === 'called';
  const isInService = user.status === 'in_service';

  return (
    <div
      className={`transition-all duration-300 rounded-2xl p-5 ${
        dark
          ? `${isCalled || isInService ? 'ring-1 ring-primary/30' : ''}`
          : `card ${isCalled || isInService ? 'ring-2 ring-primary/30' : ''}`
      }`}
      style={dark ? {
        background: isCalled || isInService
          ? 'rgba(26, 125, 185, 0.08)'
          : 'rgba(255, 255, 255, 0.03)',
        border: `1px solid ${isCalled || isInService ? 'rgba(26, 125, 185, 0.15)' : 'rgba(255, 255, 255, 0.06)'}`,
      } : {}}
      id={`queue-card-${user.userId}`}
    >
      <div className="flex items-center gap-4">
        {/* Position badge */}
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center font-display font-bold text-sm flex-shrink-0 transition-all duration-300 ${
          isFirst
            ? 'text-white shadow-lg'
            : dark ? 'text-on-surface-dark-variant' : 'text-on-surface'
        }`} style={{
          background: isFirst
            ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
            : dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
          border: isFirst ? 'none' : `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}`,
        }}>
          #{user.position}
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-semibold truncate ${dark ? 'text-white' : 'text-on-surface'}`}>{user.name}</span>
            {user.priority && user.priority !== 'normal' && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                user.priority === 'emergency'
                  ? 'bg-danger/10 text-red-400 border border-danger/20'
                  : 'bg-warning/10 text-amber-400 border border-warning/20'
              }`}>
                {user.priority.toUpperCase()}
              </span>
            )}
            {/* Status badge for called/in_service */}
            {isCalled && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                📢 CALLED
              </span>
            )}
            {isInService && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                🔧 IN SERVICE
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`text-xs font-mono ${dark ? 'text-on-surface-dark-variant' : 'text-on-surface-variant'}`}>{user.token}</span>
            <IntentBadge category={user.intent_category} dark={dark} />
          </div>
        </div>

        {/* Badges column */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {/* Ghost icon */}
          {(isGhost || isRedGhost) && (
            <span className={`text-lg ${isRedGhost ? 'text-red-400' : 'text-gray-500'}`} title={`Bail: ${user.bail_probability}%`}>
              👻
            </span>
          )}

          {/* Sentiment */}
          {sentimentEmoji && user.sentiment_level >= 3 && (
            <span className="text-lg" title={`Sentiment: ${user.sentiment_level}/5`}>
              {sentimentEmoji}
            </span>
          )}

          {/* Wait time */}
          <span className={`text-xs font-mono px-2.5 py-1 rounded-lg font-semibold ${
            user.wait_predicted && elapsed > user.wait_predicted
              ? 'bg-danger/10 text-red-400 border border-danger/20'
              : dark
                ? 'text-on-surface-dark-variant'
                : 'bg-surface-container-high text-on-surface-variant'
          }`} style={!(user.wait_predicted && elapsed > user.wait_predicted) && dark ? {
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)'
          } : {}}>
            {elapsed}m
          </span>
        </div>
      </div>

      {/* ─── Action Buttons ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {/* Waiting → show Call + Remove */}
        {isWaiting && (
          <>
            <button
              onClick={() => onCallUser?.(user.userId)}
              disabled={actionLoading}
              className="flex-1 text-xs font-semibold py-2.5 rounded-xl transition-all duration-300 hover:scale-[1.02] active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #1a7db9, #6366f1)',
                color: 'white',
                opacity: actionLoading ? 0.5 : 1,
              }}
            >
              📢 Call to Counter
            </button>
            <button
              onClick={() => onRemoved?.(user.userId)}
              disabled={actionLoading}
              className="text-xs font-semibold py-2.5 px-4 rounded-xl transition-all duration-300 hover:bg-red-500/20"
              style={{
                background: 'rgba(239, 68, 68, 0.08)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.15)',
                opacity: actionLoading ? 0.5 : 1,
              }}
            >
              ✕ Remove
            </button>
          </>
        )}

        {/* Called → show Attended + Remove */}
        {isCalled && (
          <>
            <button
              onClick={() => onAttended?.(user.userId)}
              disabled={actionLoading}
              className="flex-1 text-xs font-semibold py-2.5 rounded-xl transition-all duration-300 hover:scale-[1.02] active:scale-95"
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#34d399',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                opacity: actionLoading ? 0.5 : 1,
              }}
            >
              ✓ Attended (Present)
            </button>
            <button
              onClick={() => onRemoved?.(user.userId)}
              disabled={actionLoading}
              className="text-xs font-semibold py-2.5 px-4 rounded-xl transition-all duration-300 hover:bg-red-500/20"
              style={{
                background: 'rgba(239, 68, 68, 0.08)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.15)',
                opacity: actionLoading ? 0.5 : 1,
              }}
            >
              ✕ No Show
            </button>
          </>
        )}

        {/* In Service → show Done */}
        {isInService && (
          <button
            onClick={() => onDone?.(user.userId)}
            disabled={actionLoading}
            className="flex-1 text-xs font-semibold py-2.5 rounded-xl transition-all duration-300 hover:scale-[1.02] active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #10b981, #059669)',
              color: 'white',
              opacity: actionLoading ? 0.5 : 1,
            }}
          >
            ✅ Done — Service Complete
          </button>
        )}
      </div>
    </div>
  );
}
