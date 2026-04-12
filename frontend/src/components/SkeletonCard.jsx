/**
 * SkeletonCard — loading placeholder with shimmer animation.
 * Supports dark mode.
 */
export default function SkeletonCard({ lines = 3, className = '', dark }) {
  return (
    <div className={`${dark ? 'card-dark' : 'card'} ${className}`}>
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-4 rounded-lg animate-shimmer"
            style={{
              width: `${Math.max(40, 90 - i * 15)}%`,
              background: dark
                ? 'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 20%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0.04) 100%)'
                : 'linear-gradient(90deg, rgba(26,125,185,0.06) 0%, rgba(26,125,185,0.12) 20%, rgba(26,125,185,0.06) 40%, rgba(26,125,185,0.06) 100%)',
              backgroundSize: '200% 100%',
            }}
          />
        ))}
      </div>
    </div>
  );
}
