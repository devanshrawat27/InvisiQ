/**
 * SurgeAlert — glassmorphic pulsing banner for high-traffic periods.
 */
export default function SurgeAlert({ active }) {
  if (!active) return null;

  return (
    <div
      className="w-full py-3 px-4 rounded-xl text-sm font-semibold flex items-center gap-2.5 animate-flash-in backdrop-blur-sm"
      style={{
        background: 'rgba(245, 158, 11, 0.1)',
        border: '1px solid rgba(245, 158, 11, 0.2)',
        color: '#f59e0b',
      }}
      role="alert"
      id="surge-alert-banner"
    >
      <span className="text-lg animate-pulse">⚡</span>
      <span>High traffic detected — wait may be slightly longer than estimated.</span>
    </div>
  );
}
