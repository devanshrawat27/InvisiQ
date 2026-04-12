import { useEffect, useState } from 'react';

/**
 * PositionCard — giant position number with orbital ring animation.
 * Animates decrement when position changes.
 */
export default function PositionCard({ position, previous }) {
  const [displayPos, setDisplayPos] = useState(position);
  const [animating, setAnimating] = useState(false);
  const [movedUp, setMovedUp] = useState(false);

  useEffect(() => {
    if (previous != null && position != null && position !== previous && position < previous) {
      setAnimating(true);
      setMovedUp(true);
      setTimeout(() => {
        setDisplayPos(position);
        setAnimating(false);
      }, 250);
      setTimeout(() => setMovedUp(false), 2000);
    } else {
      setDisplayPos(position);
    }
  }, [position, previous]);

  // Calculate orbital ring progress (closer to 1 = almost turn)
  const maxPos = 20;
  const progress = position ? Math.max(0, 1 - (position - 1) / maxPos) : 0;

  return (
    <div className="card-elevated text-center py-10 relative overflow-hidden" id="position-card">
      {/* Animated orbital ring */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-44">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          {/* Track ring */}
          <circle
            cx="50" cy="50" r="44"
            fill="none"
            stroke="rgba(26, 125, 185, 0.08)"
            strokeWidth="2"
          />
          {/* Progress ring */}
          <circle
            cx="50" cy="50" r="44"
            fill="none"
            stroke="url(#posGradient)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${progress * 276.5} 276.5`}
            className="transition-all duration-1000 ease-out"
          />
          <defs>
            <linearGradient id="posGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#1a7db9" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
        </svg>
        {/* Orbital dot */}
        <div className="absolute inset-0 orbit-ring" style={{ animationDuration: '8s' }}>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1">
            <div className="w-2 h-2 rounded-full bg-primary shadow-lg shadow-primary/30" />
          </div>
        </div>
      </div>

      {/* Ambient glow */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rounded-full animate-breathe"
        style={{ background: 'radial-gradient(circle, rgba(26, 125, 185, 0.08) 0%, transparent 70%)' }}
      />

      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-on-surface-variant mb-3 relative">
        Your Position
      </p>

      <div className="relative h-24 flex items-center justify-center overflow-hidden">
        <span
          className={`font-display text-7xl font-extrabold transition-all duration-500 ease-out ${
            animating ? 'translate-y-full opacity-0 scale-90' : 'translate-y-0 opacity-100 scale-100'
          }`}
          style={{ lineHeight: 1 }}
        >
          <span className="gradient-text">#{displayPos ?? '—'}</span>
        </span>
      </div>

      <p className="text-sm text-on-surface-variant mt-3 relative font-medium">in queue</p>

      {/* "You moved up!" flash */}
      {movedUp && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 animate-flash-in">
          <span className="pill bg-success/10 text-success-dark border border-success/20 flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
            You moved up!
          </span>
        </div>
      )}
    </div>
  );
}
