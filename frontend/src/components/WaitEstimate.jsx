/**
 * WaitEstimate — displays the predicted wait range with animated confidence arc.
 * e.g. "11–16 min (87% confidence)"
 */
export default function WaitEstimate({ lower, upper, confidence, waitMinutes }) {
  const lo = lower ?? waitMinutes ?? '—';
  const hi = upper ?? (waitMinutes != null ? waitMinutes + 5 : '—');
  const conf = confidence ?? 0;
  const isNext = waitMinutes === 0;

  const confColor = conf >= 80
    ? { stroke: '#10b981', bg: 'bg-success/10', text: 'text-success-dark', border: 'border-success/20' }
    : conf >= 60
    ? { stroke: '#f59e0b', bg: 'bg-warning/10', text: 'text-warning-dark', border: 'border-warning/20' }
    : { stroke: '#ef4444', bg: 'bg-danger/10', text: 'text-danger-dark', border: 'border-danger/20' };

  return (
    <div className="card text-center py-6" id="wait-estimate">
      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-on-surface-variant mb-3">
        Estimated Wait
      </p>

      <div className="flex items-center justify-center gap-4">
        {/* Mini confidence ring */}
        {conf > 0 && (
          <div className="relative w-14 h-14 flex-shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(26,125,185,0.08)" strokeWidth="2.5" />
              <circle
                cx="18" cy="18" r="14" fill="none"
                stroke={confColor.stroke}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={`${conf * 0.88} 88`}
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold" style={{ color: confColor.stroke }}>
              {conf}%
            </span>
          </div>
        )}

        <div>
          <div className="flex items-baseline gap-1">
            {isNext ? (
              <span className="font-display text-3xl font-bold gradient-text">You're next! 🎉</span>
            ) : (
              <>
                <span className="font-display text-4xl font-bold gradient-text">{lo}–{hi}</span>
                <span className="text-sm text-on-surface-variant font-medium ml-1">min</span>
              </>
            )}
          </div>
          {conf > 0 && (
            <p className={`text-[10px] font-semibold mt-1.5 ${confColor.text}`}>
              AI Confidence: {conf >= 80 ? 'High' : conf >= 60 ? 'Medium' : 'Low'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
