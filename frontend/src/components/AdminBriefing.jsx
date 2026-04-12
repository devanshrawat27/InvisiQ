/**
 * AdminBriefing — structured AI morning briefing card with dark mode.
 * Shows expected_peak, staff_recommendation, top_intents, efficiency_score, actionable_tip.
 */
export default function AdminBriefing({ briefing, dark }) {
  const cardClass = dark ? 'card-dark' : 'card';
  const headingClass = dark ? 'text-on-surface-dark-variant' : 'text-on-surface-variant';
  const textClass = dark ? 'text-white' : 'text-on-surface';
  const subText = dark ? 'text-on-surface-dark-variant' : 'text-on-surface-variant';

  if (!briefing) {
    return (
      <div className={cardClass}>
        <h3 className={`font-display text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2 ${headingClass}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-info" />
          AI Morning Briefing
        </h3>
        <div className="space-y-3">
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-4 w-1/2" />
          <div className="skeleton h-4 w-2/3" />
          <div className="skeleton h-16 w-full" />
        </div>
        <p className={`text-xs mt-4 ${subText}`}>Briefing generating... available by 7am</p>
      </div>
    );
  }

  const effScore = briefing.efficiency_score || 0;
  const effColor = effScore > 80 ? '#10b981' : effScore >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <div className={cardClass} id="admin-briefing">
      <h3 className={`font-display text-sm font-bold uppercase tracking-wider mb-5 flex items-center gap-2 ${headingClass}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-info" />
        AI Morning Briefing
      </h3>

      <div className="space-y-5">
        {/* Expected Peak */}
        {briefing.expected_peak && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: dark ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.08)' }}>
              <span className="text-sm">🕐</span>
            </div>
            <div>
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${subText}`}>Peak Hours</p>
              <p className={`text-sm font-medium ${textClass}`}>{briefing.expected_peak}</p>
            </div>
          </div>
        )}

        {/* Staff Recommendation */}
        {briefing.staff_recommendation && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: dark ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.08)' }}>
              <span className="text-sm">👥</span>
            </div>
            <div className="rounded-xl px-3.5 py-2.5" style={{
              background: dark
                ? (briefing.staff_recommendation.toLowerCase().includes('urgent') ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)')
                : (briefing.staff_recommendation.toLowerCase().includes('urgent') ? 'rgba(245,158,11,0.1)' : 'rgba(0,0,0,0.02)'),
              border: `1px solid ${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'}`,
            }}>
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${subText}`}>Staff</p>
              <p className={`text-sm font-medium ${textClass}`}>{briefing.staff_recommendation}</p>
            </div>
          </div>
        )}

        {/* Top intents */}
        {briefing.top_intents && briefing.top_intents.length > 0 && (
          <div>
            <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2.5 ${subText}`}>Top Intents</p>
            <div className="flex flex-wrap gap-2">
              {briefing.top_intents.map((intent, i) => (
                <span key={i} className="text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{
                    background: dark ? 'rgba(26, 125, 185, 0.12)' : 'rgba(26, 125, 185, 0.08)',
                    color: dark ? '#60a5fa' : '#0f5f8a',
                    border: `1px solid ${dark ? 'rgba(26, 125, 185, 0.2)' : 'rgba(26, 125, 185, 0.12)'}`,
                  }}>
                  {typeof intent === 'string' ? intent.replace(/_/g, ' ') : `${intent.category}: ${intent.percentage}%`}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Efficiency Score */}
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16 flex-shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="14" fill="none"
                stroke={dark ? 'rgba(255,255,255,0.06)' : '#e8eaed'} strokeWidth="3" />
              <circle
                cx="18" cy="18" r="14" fill="none"
                stroke={effColor}
                strokeWidth="3"
                strokeDasharray={`${effScore * 0.88} 88`}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color: effColor }}>
              {effScore}
            </span>
          </div>
          <div>
            <p className={`text-[10px] font-semibold uppercase tracking-wider ${subText}`}>Efficiency</p>
            <p className={`text-sm font-medium ${textClass}`}>
              {effScore > 80 ? 'Excellent' : effScore >= 60 ? 'Good' : 'Needs improvement'}
            </p>
          </div>
        </div>

        {/* Actionable Tip */}
        {briefing.actionable_tip && (
          <div className="rounded-xl px-4 py-3.5 flex items-start gap-2.5"
            style={{
              background: dark ? 'rgba(245, 158, 11, 0.08)' : 'rgba(245, 158, 11, 0.06)',
              border: `1px solid ${dark ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.1)'}`,
            }}>
            <span className="text-lg flex-shrink-0">💡</span>
            <p className={`text-sm italic ${dark ? 'text-amber-200' : 'text-yellow-900'}`}>{briefing.actionable_tip}</p>
          </div>
        )}
      </div>
    </div>
  );
}
