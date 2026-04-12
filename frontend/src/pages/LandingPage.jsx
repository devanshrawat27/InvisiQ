import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getQueueStatus } from '../utils/api';

export default function LandingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const queueId = searchParams.get('q') || 'fee_cell';

  useEffect(() => {
    getQueueStatus(queueId).then(d => setQueue(d)).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [queueId]);

  function useAnimatedCount(target, duration = 600) {
    const [count, setCount] = useState(0);
    const animRef = useRef(null);
    useEffect(() => {
      if (target == null) return;
      const startTime = performance.now();
      function step(now) {
        const p = Math.min((now - startTime) / duration, 1);
        setCount(Math.round((1 - Math.pow(1 - p, 3)) * target));
        if (p < 1) animRef.current = requestAnimationFrame(step);
      }
      animRef.current = requestAnimationFrame(step);
      return () => cancelAnimationFrame(animRef.current);
    }, [target, duration]);
    return count;
  }

  const animCount = useAnimatedCount(queue?.count);
  const animWait = useAnimatedCount(queue?.avg_wait);
  const isOpen = queue?.status === 'open';
  const isPaused = queue?.status === 'paused';

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-6">
      <div className="w-full max-w-sm space-y-4">
        <div className="skeleton h-16 rounded-card" />
        <div className="skeleton h-24 rounded-card" />
        <div className="skeleton h-14 rounded-card" />
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-6">
      <div className="card w-full max-w-sm text-center animate-fade-in-scale">
        <span className="text-4xl block mb-4">⚠️</span>
        <h2 className="text-lg font-bold text-on-surface mb-2">Connection Error</h2>
        <p className="text-sm text-on-surface-variant mb-6">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary w-full">Try Again</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-surface relative overflow-hidden" id="landing-page">
      {/* Soft ambient blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[10%] left-[10%] w-72 h-72 rounded-full bg-primary/5 blur-3xl animate-breathe" />
        <div className="absolute bottom-[15%] right-[5%] w-96 h-96 rounded-full bg-accent/5 blur-3xl animate-breathe" style={{ animationDelay: '2s' }} />
      </div>

      <div className="w-full max-w-sm space-y-6 relative z-10">
        {/* Header */}
        <div className="text-center space-y-4 animate-fade-in-up stagger-1">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-card bg-primary flex items-center justify-center shadow-btn">
              <span className="text-white text-xl">🏛</span>
            </div>
            <div className="text-left">
              <p className="font-bold text-on-surface tracking-wide text-sm leading-tight">Academic Curator</p>
              <p className="text-[10px] text-on-surface-variant tracking-widest uppercase">Smart Queue System</p>
            </div>
          </div>

          <h1 className="text-3xl font-extrabold text-primary">{queue?.queue_name || queueId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</h1>

          <div className="flex items-center justify-center gap-3">
            <span className="pill bg-primary/10 text-primary">{queue?.queue_type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'General'}</span>
            <span className={`pill flex items-center gap-1.5 ${isOpen ? 'bg-accent/10 text-accent' : isPaused ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger'}`}>
              {isOpen && <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-accent" /></span>}
              {isOpen ? 'Open' : isPaused ? 'Paused' : 'Closed'}
            </span>
          </div>
        </div>

        {/* Stats */}
        <div className="card animate-fade-in-up stagger-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center py-3 rounded-btn bg-surface">
              <p className="text-3xl font-bold text-primary">{animCount}</p>
              <p className="text-[10px] text-on-surface-variant uppercase tracking-wider mt-1 font-medium">In Queue</p>
            </div>
            <div className="text-center py-3 rounded-btn bg-surface">
              <p className="text-3xl font-bold text-on-surface">{animWait}<span className="text-sm text-on-surface-variant ml-0.5">m</span></p>
              <p className="text-[10px] text-on-surface-variant uppercase tracking-wider mt-1 font-medium">Avg Wait</p>
            </div>
            <div className="text-center py-3 rounded-btn bg-surface">
              <p className="text-3xl font-bold text-on-surface">{queue?.counters_open ?? 1}</p>
              <p className="text-[10px] text-on-surface-variant uppercase tracking-wider mt-1 font-medium">Counters</p>
            </div>
          </div>
        </div>

        {/* Surge */}
        {queue?.surge_active && (
          <div className="flex items-center gap-2 p-3.5 rounded-btn bg-warning/10 border border-warning/20 animate-fade-in-up">
            <span className="text-lg animate-pulse">⚡</span>
            <span className="text-sm font-medium text-warning-dark">High traffic — longer wait expected</span>
          </div>
        )}

        {/* CTA */}
        <div className="space-y-3 animate-fade-in-up stagger-3">
          <button onClick={() => navigate(`/queue/${queueId}/join`)} disabled={!isOpen} className="btn-accent w-full text-lg py-4 group" id="join-queue-btn">
            Join Queue <span className="ml-2 inline-block group-hover:translate-x-1 transition-transform">→</span>
          </button>
          {!isOpen && (
            <p className="text-center text-sm text-on-surface-variant">
              {isPaused ? 'Queue is temporarily paused.' : 'Queue is closed. Come back later.'}
            </p>
          )}
        </div>

        <p className="text-center text-[10px] text-on-surface-variant/40 mt-6 font-medium tracking-widest uppercase">
          Powered by AI · No more standing in line
        </p>
      </div>
    </div>
  );
}
