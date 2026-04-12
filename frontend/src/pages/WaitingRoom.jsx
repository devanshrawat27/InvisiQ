import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import { getUserPosition } from '../utils/api';
import { requestNotificationPermission, sendPushNotification } from '../hooks/usePushNotification';
import { getDocumentsForIntent } from '../data/queueData';

export default function WaitingRoom() {
  const { id: queueId } = useParams();
  const navigate = useNavigate();

  const [myData, setMyData] = useState({
    name: '', token: '', position: null, wait_minutes: null, lower_bound: null,
    upper_bound: null, confidence: null, intent_category: '', counter_id: '',
    status: 'waiting', userId: '', counter_label: '',
  });
  const [flashAlert, setFlashAlert] = useState(null);
  const [isTurn, setIsTurn] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const flashTimer = useRef(null);

  // Init from session
  useEffect(() => {
    const stored = sessionStorage.getItem('myQueueData');
    if (!stored) { navigate(`/?q=${queueId}`); return; }
    try {
      const d = JSON.parse(stored);
      setMyData({
        name: d.name || '', token: d.token || '', position: d.position ?? null,
        wait_minutes: d.wait_minutes ?? null, lower_bound: d.lower_bound ?? null,
        upper_bound: d.upper_bound ?? null, confidence: d.confidence ?? null,
        intent_category: d.intent_category || '', counter_id: d.counter_id || '',
        counter_label: d.counter_label || '', status: 'waiting', userId: d.userId || '',
      });
    } catch { navigate(`/?q=${queueId}`); }
  }, [queueId, navigate]);

  useEffect(() => { if (myData.userId) requestNotificationPermission(); }, [myData.userId]);

  // Fetch position
  const fetchPos = useCallback(async () => {
    if (!queueId || !myData.userId) return;
    try {
      const d = await getUserPosition(queueId, myData.userId);
      setMyData(prev => ({
        ...prev,
        position: d.position ?? prev.position,
        status: d.status,
        wait_minutes: d.wait_predicted ?? prev.wait_minutes,
        lower_bound: d.wait_predicted != null ? Math.max(0, Math.round(d.wait_predicted * 0.8)) : prev.lower_bound,
        upper_bound: d.wait_predicted != null ? Math.round(d.wait_predicted * 1.3) : prev.upper_bound,
        confidence: d.wait_confidence ?? prev.confidence,
        counter_id: d.counter_id || prev.counter_id,
        intent_category: d.intent_category || prev.intent_category,
      }));
    } catch (err) {
      if (err.status === 404) setMyData(p => ({ ...p, status: 'removed' }));
    }
  }, [queueId, myData.userId]);

  useEffect(() => {
    if (!myData.userId || !queueId) return;
    const iv = setInterval(fetchPos, 15000);
    return () => clearInterval(iv);
  }, [fetchPos, myData.userId, queueId]);

  // Socket
  const handleFlash = useCallback((data) => {
    if (data.target_user && data.target_user !== 'all' && data.target_user !== myData.userId) return;
    setFlashAlert({ message: data.message, type: data.type || 'info' });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashAlert(null), data.duration || 5000);
    if (data.type === 'urgent') sendPushNotification('⚡ Alert', data.message);
  }, [myData.userId]);

  const handleTurn = useCallback((data) => {
    if (data.userId === myData.userId || data.token === myData.token) {
      setIsTurn(true);
      setMyData(p => ({ ...p, status: 'called', counter_id: data.counter || p.counter_id, counter_label: data.counter_label || p.counter_label }));
      sendPushNotification('🔔 YOUR TURN!', `Token ${data.token} — proceed now`);
    }
  }, [myData.userId, myData.token]);

  const socketHandlers = useMemo(() => ({
    queue_update: () => fetchPos(),
    flash_message: handleFlash,
    turn_called: handleTurn,
    surge_alert: () => setFlashAlert({ message: 'Queue is surging — wait may increase', type: 'warning' }),
    turn_approaching: (d) => {
      if (d.userId === myData.userId) {
        setFlashAlert({ message: "You're almost next — head to the office!", type: 'warning' });
        sendPushNotification('📢 Almost your turn!', "Head to the office now!");
      }
    },
  }), [fetchPos, handleFlash, handleTurn, myData.userId]);

  useSocket(queueId, myData.userId, socketHandlers);

  // Document list
  const docs = useMemo(() => getDocumentsForIntent(myData.intent_category), [myData.intent_category]);

  // Progress ring
  const maxPos = 20;
  const progress = myData.position ? Math.max(0, 1 - (myData.position - 1) / maxPos) : 0;
  const circumference = 2 * Math.PI * 90;

  // Confidence color
  const confColor = myData.confidence >= 80 ? '#00c896' : myData.confidence >= 60 ? '#f59e0b' : '#e53935';

  // YOUR TURN overlay
  if (isTurn) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)' }}>
      {/* Pulsing rings */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="w-80 h-80 rounded-full border-2 animate-ripple" style={{ borderColor: 'rgba(0,200,150,0.15)' }} />
        <div className="w-80 h-80 rounded-full border-2 animate-ripple absolute inset-0" style={{ animationDelay: '0.5s', borderColor: 'rgba(0,200,150,0.15)' }} />
        <div className="w-80 h-80 rounded-full border-2 animate-ripple absolute inset-0" style={{ animationDelay: '1s', borderColor: 'rgba(0,200,150,0.15)' }} />
      </div>

      <div className="relative w-full max-w-sm rounded-3xl p-8 text-center animate-scale-in"
        style={{
          background: '#ffffff',
          boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
          border: '1px solid #e8ecf2',
        }}>
        <div className="relative inline-block mb-5">
          <div className="absolute inset-0 rounded-full blur-xl animate-breathe" style={{ background: 'rgba(0,200,150,0.15)' }} />
          <div className="text-6xl relative animate-bounce">🔔</div>
        </div>

        <h1 className="text-3xl font-extrabold mb-4" style={{ color: '#00c896' }}>YOUR TURN!</h1>

        <div className="rounded-2xl py-4 px-5 mb-3" style={{ background: '#f4f6fa', border: '1px solid #e8ecf2' }}>
          <p className="text-[10px] uppercase tracking-widest mb-1.5 font-semibold" style={{ color: '#94a3b8' }}>Token</p>
          <p className="font-mono text-3xl font-bold" style={{ color: '#1a1a2e' }}>{myData.token}</p>
        </div>

        <div className="rounded-2xl py-4 px-5 mb-6" style={{ background: '#f4f6fa', border: '1px solid #e8ecf2' }}>
          <p className="text-[10px] uppercase tracking-widest mb-1.5 font-semibold" style={{ color: '#94a3b8' }}>Proceed to</p>
          <p className="text-xl font-bold" style={{ color: '#1a3c8f' }}>
            {myData.counter_label || myData.counter_id?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Counter'}
          </p>
        </div>

        <button onClick={() => setIsTurn(false)} className="btn-accent w-full text-lg py-4 group">
          <span>✓ OK, heading there now</span>
          <span className="ml-2 inline-block transition-transform duration-300 group-hover:translate-x-1">→</span>
        </button>
      </div>
    </div>
  );

  // Removed state
  if (myData.status === 'removed') return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-surface">
      <div className="card text-center animate-fade-in-scale max-w-sm w-full">
        <span className="text-6xl block mb-4">👋</span>
        <h2 className="text-2xl font-bold text-on-surface mb-2">You've been removed from the queue</h2>
        <p className="text-on-surface-variant mb-8">This may be because you were called and didn't respond.</p>
        <button onClick={() => navigate(`/queue/${queueId}/join`)} className="btn-accent w-full">Rejoin Queue</button>
      </div>
    </div>
  );

  const waitDisplay = myData.wait_minutes;
  const isNext = waitDisplay === 0;

  return (
    <div className="min-h-screen flex flex-col items-center justify-start p-6 pt-10 relative overflow-hidden bg-surface" id="waiting-room">
      {/* Ambient blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[5%] left-[10%] w-72 h-72 rounded-full bg-primary/5 blur-3xl animate-breathe" />
        <div className="absolute bottom-[10%] right-[5%] w-96 h-96 rounded-full bg-accent/5 blur-3xl animate-breathe" style={{ animationDelay: '2s' }} />
      </div>

      {/* Connection indicator */}
      {disconnected && (
        <div className="fixed top-4 right-4 bg-danger text-white text-xs px-3 py-1.5 rounded-full font-medium animate-flash-in z-40">
          Reconnecting...
        </div>
      )}

      {/* Flash Message */}
      {flashAlert && (
        <div className={`fixed bottom-6 left-4 right-4 max-w-md mx-auto z-50 p-4 rounded-2xl shadow-lg animate-notification-in ${
          flashAlert.type === 'urgent' ? 'bg-danger text-white' : flashAlert.type === 'warning' ? 'bg-warning text-white' : 'bg-white text-on-surface'
        }`} style={{ border: flashAlert.type === 'info' ? '1px solid #e8ecf2' : 'none' }}>
          <p className="text-sm font-medium">{flashAlert.message}</p>
        </div>
      )}

      <div className="w-full max-w-sm relative z-10 space-y-6">
        {/* Queue name + greeting */}
        <div className="text-center animate-fade-in-up">
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#94a3b8' }}>{queueId.replace(/_/g, ' ').toUpperCase()}</p>
          <p className="text-sm" style={{ color: '#64748b' }}>Hello, <span className="font-semibold" style={{ color: '#1a1a2e' }}>{myData.name}</span> 👋</p>
        </div>

        {/* Token Display Card */}
        <div className="card text-center animate-fade-in-up stagger-1 overflow-hidden relative" style={{ padding: '2rem 1.5rem' }}>
          {/* Subtle gradient overlay */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: 'radial-gradient(circle at 50% 30%, rgba(26,60,143,0.03) 0%, transparent 70%)'
          }} />

          <div className="relative flex justify-center mb-5">
            <div className="relative w-48 h-48">
              {/* Ring SVG */}
              <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
                <circle cx="100" cy="100" r="90" fill="none" stroke="#e8ecf2" strokeWidth="4" />
                <circle cx="100" cy="100" r="90" fill="none" stroke="url(#waitGradient)" strokeWidth="4" strokeLinecap="round"
                  strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)}
                  className="transition-all duration-1000 ease-out" />
                <defs>
                  <linearGradient id="waitGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#1a3c8f" />
                    <stop offset="100%" stopColor="#00c896" />
                  </linearGradient>
                </defs>
              </svg>
              {/* Token center */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="font-mono text-4xl font-extrabold" style={{ color: '#1a3c8f' }}>
                  {myData.token || '—'}
                </p>
                <p className="text-[10px] uppercase tracking-widest font-semibold mt-1" style={{ color: '#94a3b8' }}>Your Token</p>
              </div>
            </div>
          </div>

          {/* Position */}
          <p className="text-base" style={{ color: '#64748b' }}>
            You are <span className="text-3xl font-extrabold" style={{ color: '#1a1a2e' }}>#{myData.position ?? '—'}</span> in queue
          </p>
        </div>

        {/* Wait Time Card */}
        <div className="animate-fade-in-up stagger-2">
          {isNext ? (
            <div className="card text-center" style={{ background: 'linear-gradient(135deg, #ecfdf5, #d1fae5)', border: '1px solid rgba(0,200,150,0.15)' }}>
              <p className="text-2xl font-bold" style={{ color: '#00c896' }}>You're next! 🎉</p>
              <p className="text-sm mt-1" style={{ color: '#64748b' }}>Get ready to be called</p>
            </div>
          ) : waitDisplay != null ? (
            <div className="card text-center">
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: '#94a3b8' }}>Estimated Wait</p>
              <div className="flex items-center justify-center gap-3">
                {/* Mini confidence ring */}
                {myData.confidence > 0 && (
                  <div className="relative w-12 h-12 flex-shrink-0">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="14" fill="none" stroke="#e8ecf2" strokeWidth="2.5" />
                      <circle cx="18" cy="18" r="14" fill="none" stroke={confColor} strokeWidth="2.5" strokeLinecap="round"
                        strokeDasharray={`${myData.confidence * 0.88} 88`}
                        className="transition-all duration-1000 ease-out" />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold" style={{ color: confColor }}>
                      {myData.confidence}%
                    </span>
                  </div>
                )}
                <div>
                  <p className="text-3xl font-extrabold" style={{ color: '#1a1a2e' }}>
                    {myData.lower_bound ?? waitDisplay}–{myData.upper_bound ?? (waitDisplay + 5)}
                    <span className="text-sm font-medium ml-1" style={{ color: '#94a3b8' }}>min</span>
                  </p>
                  {myData.confidence > 0 && (
                    <p className="text-[10px] font-semibold mt-1" style={{ color: confColor }}>
                      AI Confidence: {myData.confidence >= 80 ? 'High' : myData.confidence >= 60 ? 'Medium' : 'Low'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="card"><div className="skeleton h-16 w-48 mx-auto" /></div>
          )}
        </div>

        {/* Counter assignment */}
        {myData.counter_id && (
          <div className="card text-center animate-fade-in-up stagger-3">
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: '#94a3b8' }}>When called, go to</p>
            <p className="text-xl font-bold" style={{ color: '#1a3c8f' }}>{myData.counter_label || myData.counter_id?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
          </div>
        )}

        {/* Document Requirements */}
        {docs && docs.length > 0 && (
          <div className="card animate-fade-in-up stagger-4">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(245, 158, 11, 0.1)' }}>
                <span className="text-sm">📄</span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-on-surface">Please keep these documents ready</h3>
                <p className="text-[10px] text-on-surface-variant">Based on your visit reason</p>
              </div>
            </div>
            <div className="space-y-2">
              {docs.map((doc, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: '#f4f6fa' }}>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(26,60,143,0.06)' }}>
                    <svg className="w-3.5 h-3.5" style={{ color: 'rgba(26,60,143,0.4)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium" style={{ color: '#1a1a2e' }}>{doc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center pb-6 animate-fade-in-up stagger-5">
          <p className="text-[10px] uppercase tracking-widest font-medium" style={{ color: '#c4cbd8' }}>AI is monitoring your wait · Stay relaxed</p>
        </div>
      </div>
    </div>
  );
}
