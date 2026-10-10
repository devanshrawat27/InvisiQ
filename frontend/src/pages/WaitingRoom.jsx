import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueueState } from '../hooks/useQueueState';
import { requestNotificationPermission, sendPushNotification } from '../hooks/usePushNotification';
import { getDocumentsForIntent, getDocumentsForReason } from '../data/queueData';
import YourTurnOverlay from '../components/YourTurnOverlay';
import { speakApproaching, speakTurn } from '../utils/tts';
import {
  Sparkles, Clock, ShieldAlert, FileText, CheckCircle, AlertCircle, ArrowLeft,
  Volume2, UserCheck, Info, Radio,
} from 'lucide-react';

// One calm theme for every department (single consistent look).
const THEME = {
  gradient: 'from-indigo-600 to-teal-600',
  textColor: 'text-teal-700',
  btn: 'bg-teal-600 hover:bg-teal-700 text-white',
  soft: 'bg-teal-50 text-teal-700',
};
const themeFor = () => THEME;

export default function WaitingRoom() {
  const { id: queueId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [checkedDocs, setCheckedDocs] = useState({});
  const [turnDismissed, setTurnDismissed] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem('myQueueData');
    if (!stored) { navigate(`/?q=${queueId}`); return; }
    try {
      const d = JSON.parse(stored);
      if (d.queue_id && d.queue_id !== queueId) { navigate(`/?q=${queueId}`); return; }
      setSession(d);
    } catch { navigate(`/?q=${queueId}`); }
  }, [queueId, navigate]);

  const userId = session?.userId || null;
  const { status, me, phase, flash, connected, error, loading, refresh } = useQueueState(queueId, userId);

  useEffect(() => { if (userId) requestNotificationPermission(); }, [userId]);

  // Notifications + voice on key transitions
  useEffect(() => {
    if (phase === 'called' && !turnDismissed) {
      sendPushNotification('🔔 Your turn!', `Token ${me?.token || ''} — please proceed now`);
    }
    if (phase === 'almost') {
      sendPushNotification('📢 Almost your turn', 'Please head to the office now');
    }
  }, [phase, turnDismissed, me?.token]);

  const theme = themeFor(queueId);

  const docs = useMemo(() => {
    const fromServer = me?.required_documents || session?.required_documents;
    if (Array.isArray(fromServer) && fromServer.length) return fromServer;
    if (session?.visit_reason) {
      const m = getDocumentsForReason(session.visit_reason);
      if (m && m.documents.length) return m.documents;
    }
    return getDocumentsForIntent(me?.intent_category || session?.intent_category || 'general');
  }, [me, session]);

  const toggleDoc = (i) => setCheckedDocs((p) => ({ ...p, [i]: !p[i] }));
  const totalDocs = docs.length;
  const readyDocs = Object.values(checkedDocs).filter(Boolean).length;
  const allReady = totalDocs > 0 && readyDocs === totalDocs;

  if (!session || loading) {
    return <Centered><div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /><p className="mt-4 text-slate-500 text-sm">Loading your queue…</p></Centered>;
  }

  if (error && !me) {
    return <Centered>
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xl p-8 max-w-sm text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-800 mb-1">Couldn’t load your queue</h2>
        <p className="text-sm text-slate-500 mb-6">{error}</p>
        <button onClick={refresh} className={`w-full py-3 rounded-2xl font-bold text-sm ${theme.btn}`}>Retry</button>
      </div>
    </Centered>;
  }

  if (phase === 'removed') {
    const reasonText = {
      no_show: 'The counter marked you as not present when you were called.',
      not_present: 'You were marked not present at the counter.',
      auto_timeout: 'You didn’t reach the counter in time when called.',
      ghost_buster_auto: 'We couldn’t reach your device, so your spot was released.',
      orphaned_cleanup: 'Your spot was reset. Please join again.',
      cancelled: 'You cancelled your spot.',
    }[me?.removed_reason] || 'Your spot in this queue is no longer active.';
    return <Centered>
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xl p-8 max-w-sm text-center">
        <span className="text-5xl block mb-3">👋</span>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">You’ve left the queue</h2>
        <p className="text-slate-500 text-sm mb-2">{reasonText}</p>
        <p className="text-slate-400 text-xs mb-8">You can rejoin anytime.</p>
        <button onClick={() => { sessionStorage.removeItem('myQueueData'); navigate(`/queue/${queueId}/join`); }} className={`w-full py-3.5 rounded-2xl font-bold text-sm ${theme.btn}`}>Rejoin queue</button>
      </div>
    </Centered>;
  }

  if (phase === 'served') {
    return <Centered>
      <div className="bg-white rounded-3xl border border-slate-100 shadow-xl p-8 max-w-md text-center">
        <div className="mx-auto mb-4 w-20 h-20 rounded-full flex items-center justify-center bg-teal-50 text-teal-600"><CheckCircle className="w-10 h-10" /></div>
        <p className="text-[10px] uppercase tracking-[0.35em] font-semibold mb-2 text-slate-400">Query completed</p>
        <h2 className="text-2xl font-extrabold text-slate-800 mb-3">All done!</h2>
        <p className="text-slate-500 text-sm mb-6">Token <span className="font-bold text-slate-700">{me?.token || session.token}</span> was handled successfully.</p>
        <div className="flex flex-col gap-3">
          <button onClick={() => { sessionStorage.removeItem('myQueueData'); navigate('/'); }} className={`w-full py-3.5 rounded-2xl font-bold text-sm ${theme.btn}`}>Back to home</button>
          <button onClick={() => { sessionStorage.removeItem('myQueueData'); navigate(`/queue/${queueId}/join`); }} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">Join another request</button>
        </div>
      </div>
    </Centered>;
  }

  if ((phase === 'called' || phase === 'in_service') && !turnDismissed) {
    return <YourTurnOverlay
      token={me?.token || session.token}
      userName={me?.name || session.name}
      counter={me?.counter_label || me?.counter_id || session.counter_label}
      inService={phase === 'in_service'}
      onDismiss={() => { setTurnDismissed(true); speakTurn(me?.token || session.token, me?.counter_label || 'counter'); }}
    />;
  }

  const position = me?.position ?? session.position;
  const ahead = me?.ahead ?? Math.max(0, (position || 1) - 1);
  const wait = me?.wait_predicted ?? session.wait_minutes ?? 0;
  const lower = Math.max(0, Math.round(wait * 0.8));
  const upper = Math.round(wait * 1.3);
  const confidence = me?.wait_confidence ?? session.confidence ?? 0;
  const confColor = confidence >= 80 ? '#10b981' : confidence >= 60 ? '#f59e0b' : '#ef4444';
  const counterLabel = me?.counter_label || (me?.counter_id ? me.counter_id.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase()) : session.counter_label) || 'Pending';

  const phaseLabel = phase === 'next' ? "You're next — get ready!" : phase === 'almost' ? "You're almost next" : 'Please wait for your turn';

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#F8FAFC]" id="waiting-room">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[6%] left-[8%] w-80 h-80 rounded-full bg-indigo-600/5 blur-3xl" />
        <div className="absolute bottom-[8%] right-[6%] w-[28rem] h-[28rem] rounded-full bg-teal-500/5 blur-3xl" />
      </div>

      {!connected && (
        <div className="fixed top-4 right-4 bg-red-600 text-white text-xs px-3.5 py-2 rounded-full font-bold shadow-md z-40 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" /> <span>Reconnecting…</span>
        </div>
      )}

      {flash && (
        <div className={`fixed bottom-6 left-4 right-4 max-w-md mx-auto z-50 p-4 rounded-2xl shadow-lg ${
          flash.type === 'urgent' || flash.type === 'turn_called' ? 'bg-red-600 text-white'
          : flash.type === 'warning' ? 'bg-amber-500 text-white' : 'bg-white text-slate-800 border border-slate-200'
        }`}>
          <p className="text-sm font-medium">{flash.message}</p>
        </div>
      )}

      <div className="relative z-10 mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="w-10 h-10 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/60 shadow-sm flex items-center justify-center text-slate-500" aria-label="Back">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.3em] text-slate-400">{queueId.replace(/_/g, ' ')}</p>
              <p className="text-sm mt-0.5 text-slate-500">Hello, <span className="font-bold text-slate-800">{me?.name || session.name}</span> 👋</p>
            </div>
          </div>
          <span className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-full border ${connected ? 'bg-teal-50 text-teal-600 border-teal-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
            <Radio className="w-3 h-3" /> {connected ? 'Live' : 'Offline'}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-start">
          <div className="space-y-6">
            <div className="rounded-3xl bg-white p-8 shadow-[0_12px_40px_rgba(15,23,42,0.05)] border border-slate-100 relative overflow-hidden">
              <div className={`absolute top-0 left-8 right-8 h-[3px] bg-gradient-to-r ${theme.gradient} rounded-b-full opacity-70`} />
              <p className="text-[10px] uppercase tracking-[0.3em] font-extrabold text-slate-400 mt-1">{queueId.replace(/_/g, ' ')}</p>
              <h2 className="mt-2 text-3xl font-black text-slate-800 tracking-tight">You’re in the queue</h2>
              <p className={`mt-1 text-sm font-semibold ${theme.textColor}`}>{phaseLabel}</p>

              <div className="mt-8 rounded-3xl border border-slate-100 bg-gradient-to-b from-slate-50/60 to-white p-8 text-center">
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400 font-extrabold">Your token</p>
                <p className={`mt-3 text-[4.5rem] font-black tracking-tighter bg-gradient-to-br ${theme.gradient} bg-clip-text text-transparent leading-none`}>
                  {me?.token || session.token}
                </p>
                <p className="mt-4 text-sm font-semibold text-slate-600">
                  {ahead > 0 ? `${ahead} student${ahead === 1 ? '' : 's'} ahead of you` : 'You are next — proceed immediately!'}
                </p>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <Stat icon={<UserCheck className="w-4 h-4" />} label="Your counter" value={counterLabel} sub="Proceed when called" soft={theme.soft} />
                <Stat icon={<Clock className="w-4 h-4" />} label="Estimated wait" value={ahead === 0 ? 'Now' : `${lower}–${upper} min`} sub="Approximate" />
                <Stat icon={<Sparkles className="w-4 h-4" />} label="AI confidence" value={`${confidence}%`} valueColor={confColor} sub={confidence >= 80 ? 'Accurate' : confidence >= 60 ? 'Fair' : 'Estimate'} soft="bg-teal-50 text-teal-600" />
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-[0_12px_40px_rgba(15,23,42,0.04)] border border-slate-100">
              <p className="text-[10px] uppercase tracking-[0.3em] font-extrabold text-slate-400 mb-5">Queue details</p>
              <div className="grid grid-cols-3 gap-4">
                <MiniStat label="Position" value={`#${position ?? '—'}`} />
                <MiniStat label="Ahead" value={ahead} />
                <MiniStat label="Status" value={(me?.status || 'waiting').replace('_', ' ')} />
              </div>
            </div>

            {status && (
              <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                <Pill>Waiting now: <b className="text-slate-700">{status.count}</b></Pill>
                <Pill>Counters open: <b className="text-slate-700">{status.counters_open}</b></Pill>
                <Pill>Avg wait: <b className="text-slate-700">{status.avg_wait}m</b></Pill>
                {status.status !== 'open' && <Pill tone="amber">Queue is {status.status}</Pill>}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-[0_12px_40px_rgba(15,23,42,0.04)] border border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-2xl ${theme.soft} flex items-center justify-center`}><FileText className="w-5 h-5" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Documents to carry</h3>
                    <p className="text-[11px] text-slate-400 font-semibold uppercase">Based on your visit reason</p>
                  </div>
                </div>
                <span className={`text-xs font-bold ${allReady ? 'text-teal-600' : 'text-slate-500'}`}>{readyDocs}/{totalDocs}</span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded-full mb-5 overflow-hidden">
                <div className={`h-full bg-gradient-to-r ${theme.gradient} transition-all duration-500`} style={{ width: `${totalDocs ? (readyDocs / totalDocs) * 100 : 0}%` }} />
              </div>
              <div className="space-y-2">
                {docs.map((doc, i) => {
                  const name = typeof doc === 'string' ? doc : doc?.name || 'Document';
                  const done = !!checkedDocs[i];
                  return (
                    <button key={i} onClick={() => toggleDoc(i)} className={`w-full flex items-center justify-between gap-3 rounded-2xl border p-3 text-left transition ${done ? 'border-teal-200 bg-teal-50/30' : 'border-slate-150 bg-slate-50/50 hover:bg-slate-50'}`}>
                      <span className={`text-sm font-medium ${done ? 'line-through text-slate-400' : 'text-slate-700'}`}>{name}</span>
                      {done ? <CheckCircle className="w-5 h-5 text-teal-500" /> : <span className="w-4 h-4 rounded border-2 border-slate-300" />}
                    </button>
                  );
                })}
              </div>
              {allReady && <p className="mt-4 text-xs font-bold text-teal-600 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> All set — great!</p>}
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-[0_12px_40px_rgba(15,23,42,0.04)] border border-slate-100">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Info className="w-4 h-4" /> We’ll notify + play a sound when it’s your turn. Keep this tab open.
              </div>
              <button onClick={() => speakApproaching(me?.name || session.name, ahead || 1, counterLabel)} className="mt-4 w-full flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                <Volume2 className="w-4 h-4" /> Test voice alert
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-[10px] uppercase tracking-widest font-extrabold text-slate-300 pt-10">AI-assisted · Your position updates live</p>
      </div>
    </div>
  );
}

function Centered({ children }) {
  return <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F8FAFC]">{children}</div>;
}

function Stat({ icon, label, value, sub, valueColor, soft = 'bg-indigo-50 text-indigo-600' }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/40 p-4 text-center">
      <div className={`w-8 h-8 rounded-xl ${soft} flex items-center justify-center mx-auto mb-2`}>{icon}</div>
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold">{label}</p>
      <p className="mt-1 text-xl font-black text-slate-800" style={valueColor ? { color: valueColor } : undefined}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-400">{sub}</p>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl bg-slate-50/80 p-4 text-center border border-slate-100">
      <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-bold">{label}</p>
      <p className="mt-1 text-xl font-black text-slate-800 capitalize">{value}</p>
    </div>
  );
}

function Pill({ children, tone }) {
  return <span className={`px-3 py-1.5 rounded-full border ${tone === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-white text-slate-500 border-slate-200'}`}>{children}</span>;
}
