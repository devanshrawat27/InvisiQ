import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { auth, googleProvider, signInWithPopup, signOut } from '../firebase/config';
import { onAuthStateChanged } from 'firebase/auth';
import { useSocket } from '../hooks/useSocket';
import { getQueueUsers, getQueueStatus, getBriefing, markAttended, markRemoved, markDone, pauseQueue, resumeQueue, seedQueue, callNextUser, getAnalytics, updateCounters } from '../utils/api';
import { speakAdmin } from '../utils/tts';
import IntentBadge from '../components/IntentBadge';
import QRModal from '../components/QRModal';
import RequirementsManager from '../components/RequirementsManager';

function createQueueId(name) { return name.trim().toLowerCase().replace(/\s+/g, '_'); }
function getQueueName(id) { return id.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); }

export default function AdminDashboard() {
  const [availableQueues] = useState([
    { id: 'fee_cell', name: 'Fee Cell' },
    { id: 'admin_cell', name: 'Admin Cell' },
    { id: 'admission_cell', name: 'Admission Cell' },
  ]);
  const [activeQueueId, setActiveQueueId] = useState('fee_cell');
  const [showQRModal, setShowQRModal] = useState(false);
  const [showReqs, setShowReqs] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentView, setCurrentView] = useState('dashboard'); // 'dashboard' | 'analytics'

  // Auth
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [idToken, setIdToken] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        try {
          const t = await u.getIdToken();
          setIdToken(t); setUser(u);
        } catch { setUser(null); setIdToken(null); }
      } else { setUser(null); setIdToken(null); }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  const handleSignIn = async () => {
    try { setAuthError(null); await signInWithPopup(auth, googleProvider); }
    catch (err) { setAuthError(`Sign in failed: ${err.code || err.message}`); }
  };
  const handleSignOut = async () => {
    if (idToken === 'hackathon-bypass-token') { setUser(null); setIdToken(null); return; }
    await signOut(auth);
  };

  // Data
  const [queueStatus, setQueueStatus] = useState(null);
  const [users, setUsers] = useState([]);
  const [briefing, setBriefing] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [ghostFlags, setGhostFlags] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  const fetchAll = useCallback(async () => {
    try {
      if (!activeQueueId) return;
      const [status, usersRes] = await Promise.all([
        getQueueStatus(activeQueueId),
        getQueueUsers(activeQueueId),
      ]);
      setQueueStatus(status);
      setUsers(usersRes?.users || []);
      if (idToken) {
        getBriefing(activeQueueId, idToken).then(b => b && setBriefing(b)).catch(() => {});
      }
    } catch (err) { console.error('Fetch error:', err); }
    finally { setLoading(false); }
  }, [idToken, activeQueueId]);

  useEffect(() => {
    setLoading(true); setUsers([]); setQueueStatus(null); setNotifications([]);
    fetchAll();
    const iv = setInterval(fetchAll, 30000);
    return () => clearInterval(iv);
  }, [fetchAll, activeQueueId]);

  // Socket
  const addNotif = useCallback((type, msg) => {
    setNotifications(p => [{ type, message: msg, timestamp: Date.now() }, ...p.slice(0, 19)]);
  }, []);

  const socketHandlers = useMemo(() => ({
    queue_update: () => fetchAll(),
    user_called: (d) => { addNotif('call', `${d.name} called to ${d.counter}`); speakAdmin(d.token, d.counter); fetchAll(); },
    service_completed: (d) => { addNotif('done', `${d.name} served — ${d.actual_wait}min`); fetchAll(); },
    user_removed: (d) => { addNotif('remove', `${d.name} removed`); fetchAll(); },
    user_attended: () => fetchAll(),
    ghost_flag: (d) => { if (d.userId) setGhostFlags(p => ({ ...p, [d.userId]: true })); addNotif('ghost', `${d.userName || 'User'} flagged as ghost`); fetchAll(); },
    surge_alert: () => addNotif('surge', 'Surge detected — queue filling fast'),
    fraud_alert: (d) => addNotif('fraud', `Fraud attempt: ${d.phone || 'unknown'}`),
  }), [fetchAll, addNotif]);

  useSocket(user ? activeQueueId : null, null, socketHandlers, true);

  // Actions
  const doAction = async (fn, ...args) => {
    const uid = args[0];
    setActionLoading(uid);
    try { await fn(...args); await fetchAll(); } catch (e) { console.error(e); }
    finally { setActionLoading(null); }
  };

  const handleCall = () => doAction(callNextUser, activeQueueId, idToken);
  const handleAttended = (uid) => doAction(markAttended, activeQueueId, uid, idToken);
  const handleRemoved = (uid) => doAction(markRemoved, activeQueueId, uid, idToken);
  const handleDone = (uid) => doAction(markDone, activeQueueId, uid, idToken);
  const handlePause = async () => {
    try {
      if (queueStatus?.status === 'open') await pauseQueue(activeQueueId, idToken);
      else await resumeQueue(activeQueueId, idToken);
      await fetchAll();
    } catch (e) { console.error(e); }
  };

  // Derived
  const serving = useMemo(() => users.find(u => u.status === 'called' || u.status === 'in_service'), [users]);
  const waiting = useMemo(() => users.filter(u => u.status === 'waiting').sort((a, b) => (a.position || 999) - (b.position || 999)), [users]);

  // Auth gate
  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="text-center"><div className="w-10 h-10 border-3 border-primary border-t-transparent rounded-full animate-spin mx-auto" /><p className="mt-4 text-on-surface-variant text-sm">Loading...</p></div>
    </div>
  );

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="card max-w-sm w-full text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-6"><span className="text-white font-bold text-lg">🏛</span></div>
        <h1 className="text-2xl font-bold text-on-surface mb-2">Academic Curator</h1>
        <p className="text-on-surface-variant text-sm mb-8">Admin access required</p>
        {authError && <div className="bg-danger-light text-danger-dark text-sm p-3 rounded-btn mb-4">{authError}</div>}
        <button onClick={handleSignIn} className="btn-primary w-full">Sign in with Google</button>
        <button onClick={() => { setIdToken('hackathon-bypass-token'); setUser({ displayName: 'College Admin', photoURL: '', email: 'admin@college.edu' }); }} className="btn-ghost w-full mt-3">Demo Mode</button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-surface">
      {/* ─── Sidebar ─────────────────────────────────────────────── */}
      <aside className={`sidebar fixed lg:relative z-30 lg:z-auto ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} transition-transform duration-300`}>
        <div className="p-5 pt-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center"><span className="text-white text-lg">🏛</span></div>
            <div><p className="font-bold text-on-surface text-sm">Academic Curator</p></div>
          </div>

          <nav className="space-y-1">
            <div className={`sidebar-item ${currentView === 'dashboard' ? 'active' : ''}`} onClick={() => { setCurrentView('dashboard'); setSidebarOpen(false); }} style={{ cursor: 'pointer' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg> Dashboard
            </div>
            <div className={`sidebar-item ${currentView === 'queue' ? 'active' : ''}`} onClick={() => { setCurrentView('queue'); setSidebarOpen(false); }} style={{ cursor: 'pointer' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg> Queue Overview
            </div>
            <div className={`sidebar-item ${currentView === 'analytics' ? 'active' : ''}`} onClick={() => { setCurrentView('analytics'); setSidebarOpen(false); }} style={{ cursor: 'pointer' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> Analytics
            </div>
          </nav>
        </div>

        {/* Queue Selector */}
        <div className="px-5 mt-4">
          <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-3">Queues</p>
          <div className="space-y-1">
            {availableQueues.map(q => (
              <button key={q.id} onClick={() => setActiveQueueId(q.id)}
                className={`w-full text-left text-sm px-3 py-2.5 rounded-btn transition-all ${activeQueueId === q.id ? 'bg-primary text-white font-semibold' : 'text-on-surface-variant hover:bg-surface'}`}>
                {q.name}
              </button>
            ))}
          </div>
        </div>

        {/* Profile at bottom */}
        <div className="mt-auto p-5 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white font-bold text-sm">{user.displayName?.[0] || 'A'}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-on-surface truncate">{user.displayName || 'Admin'}</p>
              <p className="text-xs text-on-surface-variant">Curator Admin</p>
            </div>
            <button onClick={handleSignOut} className="text-on-surface-variant hover:text-danger transition-colors" title="Sign out">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/30 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* ─── Main Content ────────────────────────────────────────── */}
      <main className="flex-1 min-w-0">
        {/* Top Bar */}
        <header className="bg-white px-6 py-4 flex items-center gap-4 border-b border-gray-100">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-2 rounded-btn hover:bg-surface"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg></button>
          <div className="flex-1 max-w-md">
            <div className="flex items-center gap-2 bg-surface rounded-btn px-4 py-2.5">
              <svg className="w-4 h-4 text-on-surface-variant" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input type="text" placeholder={currentView === 'analytics' ? 'Search analytics...' : 'Search student tokens or names...'} className="bg-transparent text-sm w-full outline-none text-on-surface placeholder-on-surface-variant" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {currentView === 'dashboard' && (
              <>
                <button onClick={() => setShowQRModal(true)} className="btn-ghost text-xs">📱 QR</button>
                <button onClick={() => setShowReqs(true)} className="btn-ghost text-xs">📄 Docs</button>
                <button onClick={handlePause} className={`text-xs px-3 py-2 rounded-btn font-semibold transition-all ${queueStatus?.status === 'open' ? 'text-on-surface-variant hover:bg-surface' : 'bg-danger-light text-danger'}`}>
                  {queueStatus?.status === 'open' ? '⏸ Pause' : '▶ Resume'}
                </button>
              </>
            )}
            {currentView === 'queue' && (
              <>
                <button className="btn-ghost text-xs relative">
                  🔔
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-danger" />
                </button>
                <button className="btn-ghost text-xs">⚙️</button>
              </>
            )}
            {currentView === 'analytics' && (
              <>
                <button className="btn-ghost text-xs relative">
                  🔔
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-danger" />
                </button>
                <button className="btn-ghost text-xs">⚙️</button>
              </>
            )}
          </div>
        </header>

        {/* Route content based on currentView */}
        {currentView === 'dashboard' && (
          <DashboardView
            loading={loading} queueStatus={queueStatus} serving={serving} waiting={waiting}
            ghostFlags={ghostFlags} actionLoading={actionLoading} briefing={briefing}
            notifications={notifications} activeQueueId={activeQueueId} idToken={idToken}
            fetchAll={fetchAll} handleCall={handleCall} handleAttended={handleAttended}
            handleRemoved={handleRemoved} handleDone={handleDone}
          />
        )}
        {currentView === 'queue' && (
          <QueueOverviewView
            loading={loading} queueStatus={queueStatus} users={users}
            ghostFlags={ghostFlags} actionLoading={actionLoading}
            activeQueueId={activeQueueId} fetchAll={fetchAll}
            handleCall={handleCall} handleAttended={handleAttended}
            handleRemoved={handleRemoved} handleDone={handleDone}
          />
        )}
        {currentView === 'analytics' && (
          <AnalyticsView briefing={briefing} queueStatus={queueStatus} activeQueueId={activeQueueId} idToken={idToken} />
        )}
      </main>

      {/* Modals */}
      {showQRModal && <QRModal queueId={activeQueueId} onClose={() => setShowQRModal(false)} />}
      {showReqs && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowReqs(false)}>
          <div className="bg-white rounded-card max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <RequirementsManager queueId={activeQueueId} token={idToken} onClose={() => setShowReqs(false)} />
          </div>
        </div>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════
   DASHBOARD VIEW — the original main dashboard content
   ═══════════════════════════════════════════════════════════════════ */
function DashboardView({ loading, queueStatus, serving, waiting, ghostFlags, actionLoading, briefing, notifications, activeQueueId, idToken, fetchAll, handleCall, handleAttended, handleRemoved, handleDone }) {
  const [counterLoading, setCounterLoading] = useState(false);

  const countersOpen = queueStatus?.counters_open || 1;
  const queueCount = queueStatus?.count || 0;
  const COUNTER_THRESHOLD = 8; // suggest adding counter when students per counter > threshold
  const studentsPerCounter = countersOpen > 0 ? Math.ceil(queueCount / countersOpen) : queueCount;
  const shouldSuggestMore = queueCount > 0 && studentsPerCounter >= COUNTER_THRESHOLD;

  const handleAddCounter = async () => {
    setCounterLoading(true);
    try { await updateCounters(activeQueueId, 'add', idToken); await fetchAll(); }
    catch (e) { console.error('Add counter error:', e); }
    finally { setCounterLoading(false); }
  };

  const handleRemoveCounter = async () => {
    setCounterLoading(true);
    try { await updateCounters(activeQueueId, 'remove', idToken); await fetchAll(); }
    catch (e) { console.error('Remove counter error:', e); }
    finally { setCounterLoading(false); }
  };

  return (
    <div className="p-6">
      {/* ─── Stats Row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading ? [1,2,3,4].map(i => <div key={i} className="skeleton h-24 rounded-card" />) : (<>
          <div className="stat-card animate-fade-in-up stagger-1">
            <p className="text-sm text-on-surface-variant font-medium">People in Queue</p>
            <p className="text-3xl font-bold text-on-surface mt-1">{queueCount}</p>
          </div>
          <div className="stat-card animate-fade-in-up stagger-2">
            <p className="text-sm text-on-surface-variant font-medium">Avg Wait</p>
            <p className="text-3xl font-bold text-on-surface mt-1">{queueStatus?.avg_wait || 0}<span className="text-lg text-on-surface-variant ml-1">m</span></p>
          </div>
          <div className="stat-card animate-fade-in-up stagger-3">
            <p className="text-sm text-on-surface-variant font-medium">Status</p>
            <div className="flex items-center gap-2 mt-1"><span className={`status-dot ${queueStatus?.congestion || 'normal'}`} /><span className="text-3xl font-bold text-on-surface capitalize">{queueStatus?.congestion || 'Normal'}</span></div>
          </div>
          <div className="stat-card animate-fade-in-up stagger-4">
            <p className="text-sm text-on-surface-variant font-medium">Counters</p>
            <div className="flex items-center gap-2 mt-1">
              <button onClick={handleRemoveCounter} disabled={counterLoading || countersOpen <= 1}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-lg font-bold transition-all"
                style={{ background: countersOpen <= 1 ? '#f0f2f5' : '#fee2e2', color: countersOpen <= 1 ? '#ccc' : '#e53935', cursor: countersOpen <= 1 ? 'not-allowed' : 'pointer' }}>−</button>
              <span className="text-3xl font-bold text-on-surface">{countersOpen}</span>
              <button onClick={handleAddCounter} disabled={counterLoading}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-lg font-bold transition-all hover:scale-105"
                style={{ background: shouldSuggestMore ? '#fef3c7' : '#ecfdf5', color: shouldSuggestMore ? '#92400e' : '#00c896', cursor: 'pointer' }}>+</button>
            </div>
            {shouldSuggestMore && (
              <p className="text-[10px] font-semibold mt-1.5 px-2 py-1 rounded-full inline-block" style={{ background: '#fef3c7', color: '#92400e' }}>
                ⚠ {studentsPerCounter} per counter — add more
              </p>
            )}
          </div>
        </>)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ─── Center (Hero + Queue) ────────────────────────────── */}
        <div className="lg:col-span-8 space-y-6">
          {/* Hero: Currently Serving */}
          {serving ? (
            <div className="card-hero animate-fade-in-up">
              <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-accent text-white mb-4 tracking-wide">SERVING NOW</span>
              <h2 className="text-3xl lg:text-4xl font-extrabold mb-2">{serving.name}</h2>
              <p className="text-white/80 text-lg mb-1">Token: <span className="font-mono font-bold">{serving.token}</span></p>
              <div className="flex items-center gap-3 mb-6">
                <IntentBadge category={serving.intent_category} />
                <span className="text-white/50 text-sm">{serving.status === 'in_service' ? '🔧 In Service' : '📢 Called'}</span>
              </div>
              {serving.intent_details && <p className="text-white/50 text-sm italic mb-6">"{serving.intent_details}"</p>}
              <ServiceTimer user={serving} />
              <div className="flex gap-3 mt-6 relative z-10">
                {serving.status === 'called' && (
                  <button onClick={() => handleAttended(serving.userId)} disabled={actionLoading === serving.userId} className="btn-accent flex-1">Attended</button>
                )}
                {serving.status === 'in_service' && (
                  <button onClick={() => handleDone(serving.userId)} disabled={actionLoading === serving.userId} className="btn-accent flex-1">✅ Done</button>
                )}
                <button onClick={() => handleRemoved(serving.userId)} disabled={actionLoading === serving.userId} className="btn-danger">Removed</button>
              </div>
            </div>
          ) : (
            <div className="card-hero text-center py-12 animate-fade-in-up">
              <p className="text-white/60 text-lg mb-4">No one being served right now</p>
              {waiting.length > 0 && <button onClick={handleCall} className="btn-accent">📢 Call Next Student</button>}
            </div>
          )}

          {/* Live Queue */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-on-surface italic">Live Queue</h3>
              <button onClick={fetchAll} className="btn-ghost text-xs">↻ Refresh</button>
            </div>

            {loading ? (
              <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="skeleton h-20 rounded-card" />)}</div>
            ) : waiting.length === 0 ? (
              <div className="card text-center py-12 animate-fade-in-scale">
                <span className="text-4xl block mb-3">📭</span>
                <p className="text-on-surface-variant">Queue is empty</p>
              </div>
            ) : (
              <div className="space-y-3">
                {waiting.map((u, i) => (
                  <QueueRow key={u.userId} user={u} ghostFlags={ghostFlags} actionLoading={actionLoading}
                    onCall={handleCall} onAttended={handleAttended} onRemoved={handleRemoved}
                    style={{ animationDelay: `${i * 60}ms` }} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── Right Panel ──────────────────────────────────────── */}
        <div className="lg:col-span-4 space-y-6">
          {/* AI Overview */}
          <div className="card animate-fade-in-up stagger-3">
            <h3 className="font-bold text-on-surface flex items-center gap-2 mb-4"><span>✨</span> AI Overview</h3>
            {(() => {
              const count = queueStatus?.count || 0;
              const avgWait = queueStatus?.avg_wait || 0;
              const congestion = queueStatus?.congestion || 'normal';
              const countersOpen = queueStatus?.counters_open || 1;
              const waitingList = waiting || [];

              // Compute top intent from waiting users
              const intentMap = {};
              waitingList.forEach(u => {
                if (u.intent_category) intentMap[u.intent_category] = (intentMap[u.intent_category] || 0) + 1;
              });
              const topIntent = Object.entries(intentMap).sort((a, b) => b[1] - a[1])[0];
              const formatCat = (c) => c ? c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : '';

              // Smart recommendation based on real state
              const spc = countersOpen > 0 ? Math.ceil(count / countersOpen) : count;
              let recommendation = '';
              if (count === 0) recommendation = 'Queue is empty — no action needed';
              else if (spc >= 8) recommendation = `${spc} students per counter — add a counter to reduce wait times`;
              else if (congestion === 'critical') recommendation = `Critical load — consider opening more counters`;
              else if (congestion === 'surge') recommendation = `Surge detected — monitor and prepare additional staff`;
              else if (avgWait > 20) recommendation = `Avg wait ${avgWait}m exceeds target — increase throughput`;
              else if (count > 5) recommendation = `${count} students, ${countersOpen} counter${countersOpen > 1 ? 's' : ''} — throughput is healthy`;
              else recommendation = `Operations smooth — ${count} student${count !== 1 ? 's' : ''} at ${countersOpen} counter${countersOpen > 1 ? 's' : ''}`;

              // Use AI briefing if available, otherwise use computed data
              const peakText = briefing?.peak_time || (count > 0 ? `${count} active, ~${avgWait}m avg wait` : 'No active queue right now');
              const recText = briefing?.recommendation || recommendation;
              const summaryText = briefing?.summary || (topIntent ? `Top intent: ${formatCat(topIntent[0])} (${topIntent[1]} student${topIntent[1] > 1 ? 's' : ''})${serving ? ` • Currently serving ${serving.name}` : ''}` : (serving ? `Currently serving ${serving.name}` : null));

              return (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0"><span className="text-sm">📊</span></div>
                    <div><p className="text-xs text-on-surface-variant font-semibold uppercase">Queue Status</p><p className="text-sm font-bold text-on-surface">{peakText}</p></div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0"><span className="text-sm">💡</span></div>
                    <div><p className="text-xs text-on-surface-variant font-semibold uppercase">Recommendation</p><p className="text-sm font-bold text-on-surface">{recText}</p></div>
                  </div>
                  {summaryText && <div className="bg-surface rounded-btn p-3"><p className="text-sm text-on-surface-variant italic">"{summaryText}"</p></div>}
                </div>
              );
            })()}
          </div>

          {/* Notifications */}
          <div className="card animate-fade-in-up stagger-4">
            <h3 className="font-bold text-on-surface mb-4">Notifications</h3>
            {notifications.length === 0 ? (
              <p className="text-sm text-on-surface-variant text-center py-8">No alerts yet</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {notifications.slice(0, 8).map((n, i) => (
                  <div key={i} className="flex items-start gap-2 p-2.5 rounded-btn bg-surface text-sm animate-slide-up">
                    <span className="flex-shrink-0">{n.type === 'call' ? '📢' : n.type === 'done' ? '✅' : n.type === 'remove' ? '❌' : n.type === 'ghost' ? '👻' : n.type === 'surge' ? '⚡' : '🔔'}</span>
                    <p className="text-on-surface-variant flex-1">{n.message}</p>
                    <span className="text-xs text-on-surface-muted flex-shrink-0">{Math.round((Date.now() - n.timestamp) / 60000)}m</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Surge Alert Bar ──────────────────────────────────── */}
      {notifications.some(n => n.type === 'surge') && (
        <div className="surge-bar mt-6 animate-slide-up">
          <span className="text-xl">⚡</span>
          <div className="flex-1">
            <p className="font-bold text-on-surface text-sm">Surge Alert</p>
            <p className="text-xs text-on-surface-variant">High join rate detected in {getQueueName(activeQueueId)}. Current wait time spike.</p>
          </div>
          <button className="btn-primary text-xs px-4 py-2">Manage Flow</button>
        </div>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════
   QUEUE OVERVIEW VIEW — Real-time queue management table
   ═══════════════════════════════════════════════════════════════════ */
function QueueOverviewView({ loading, queueStatus, users, ghostFlags, actionLoading, activeQueueId, fetchAll, handleCall, handleAttended, handleRemoved, handleDone }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | intent categories
  const [showCount, setShowCount] = useState(10);

  // Categorize users
  const allUsers = useMemo(() => {
    return users
      .filter(u => ['waiting', 'called', 'in_service'].includes(u.status))
      .sort((a, b) => (a.position || 999) - (b.position || 999));
  }, [users]);

  // Get unique intent categories from real data
  const intentCategories = useMemo(() => {
    const cats = new Set();
    allUsers.forEach(u => { if (u.intent_category) cats.add(u.intent_category); });
    return Array.from(cats);
  }, [allUsers]);

  // Filter and search
  const filteredUsers = useMemo(() => {
    let list = allUsers;
    if (filter !== 'all') {
      list = list.filter(u => u.intent_category === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        u.name?.toLowerCase().includes(q) ||
        u.token?.toLowerCase().includes(q) ||
        u.intent_category?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allUsers, filter, search]);

  const displayedUsers = filteredUsers.slice(0, showCount);

  // Format intent label
  const formatIntent = (cat) => {
    if (!cat) return 'General';
    return cat.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Urgency color
  const getUrgencyColor = (score) => {
    if (score >= 70) return '#e53935';
    if (score >= 40) return '#1a3c8f';
    return '#93c5fd';
  };

  // Status badge
  const getStatusBadge = (user) => {
    if (user.status === 'called' || user.status === 'in_service') {
      return { label: 'CALLED', bg: '#e53935', color: 'white' };
    }
    const waitMin = user.join_time ? Math.round((Date.now() - user.join_time) / 60000) : 0;
    return { label: `WAITING (${waitMin}M)`, bg: '#f4f6fa', color: '#64748b', border: '1px solid #e8ecf2' };
  };

  // Risk badge
  const getRiskBadge = (bail) => {
    if (bail >= 70) return { label: `${bail}%`, color: '#e53935', icon: '⚠️' };
    if (bail >= 40) return { label: `${bail}%`, color: '#f59e0b', icon: '⚠️' };
    return { label: null, color: '#94a3b8', icon: '😊' };
  };

  // Intent badge color
  const getIntentColor = (cat) => {
    const map = {
      fee_payment: { bg: '#eef2ff', color: '#1a3c8f', border: '#dce4ff' },
      admission: { bg: '#fef3c7', color: '#92400e', border: '#fde68a' },
      tc_mc_request: { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' },
      scholarship: { bg: '#ecfdf5', color: '#065f46', border: '#a7f3d0' },
      bonafide_cert: { bg: '#f0f9ff', color: '#0369a1', border: '#bae6fd' },
      exam_query: { bg: '#fdf4ff', color: '#86198f', border: '#f0abfc' },
    };
    return map[cat] || { bg: '#f4f6fa', color: '#64748b', border: '#e8ecf2' };
  };

  // Download CSV report
  const downloadReport = () => {
    const headers = ['Position', 'Name', 'Token', 'Intent', 'Urgency Score', 'Bail Risk %', 'Status', 'Wait (min)', 'Counter'];
    const rows = allUsers.map(u => [
      u.position,
      u.name,
      u.token,
      formatIntent(u.intent_category),
      u.urgency_score || 0,
      u.bail_probability || 0,
      u.status,
      u.join_time ? Math.round((Date.now() - u.join_time) / 60000) : '—',
      u.counter_id || '—',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${activeQueueId}_queue_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const waitingCount = allUsers.filter(u => u.status === 'waiting').length;
  const calledCount = allUsers.filter(u => u.status === 'called' || u.status === 'in_service').length;
  const surgeActive = queueStatus?.surge_active || queueStatus?.congestion === 'critical';

  return (
    <div className="p-6 space-y-6 animate-fade-in-up">
      {/* Page Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-on-surface">Queue Overview</h1>
          <p className="text-sm text-on-surface-variant mt-1">Real-time management of active student sessions and service flow.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={downloadReport} className="btn-outline text-xs px-4 py-2.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Download Report
          </button>
          <button onClick={handleCall} className="btn-primary text-xs px-5 py-2.5">
            📢 Call Next Student
          </button>
        </div>
      </div>

      {/* ─── Stat Cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? [1,2,3,4].map(i => <div key={i} className="skeleton h-28 rounded-card" />) : (<>
          <div className="stat-card animate-fade-in-up stagger-1">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">In Queue</p>
              <svg className="w-5 h-5 text-primary/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </div>
            <p className="text-4xl font-extrabold text-on-surface">{queueStatus?.count || 0}</p>
            <p className="text-xs text-on-surface-variant mt-1">{calledCount > 0 ? `${calledCount} being served` : 'All waiting'}</p>
          </div>

          <div className="stat-card animate-fade-in-up stagger-2">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Avg. Wait</p>
              <span className="text-base">⏱</span>
            </div>
            <p className="text-4xl font-extrabold text-on-surface">{queueStatus?.avg_wait || 0}<span className="text-lg text-on-surface-variant ml-0.5">m</span></p>
            {(queueStatus?.avg_wait || 0) > 15 ? (
              <p className="text-xs text-danger font-medium mt-1">▲ Above target (15m)</p>
            ) : (
              <p className="text-xs text-on-surface-variant mt-1">Within target</p>
            )}
          </div>

          <div className="stat-card animate-fade-in-up stagger-3">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Staff Active</p>
              <svg className="w-5 h-5 text-primary/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </div>
            <p className="text-4xl font-extrabold text-on-surface">{String(queueStatus?.counters_open || 1).padStart(2, '0')}</p>
            <p className="text-xs text-on-surface-variant mt-1">{queueStatus?.counters_open || 1} stations available</p>
          </div>

          <div className="stat-card animate-fade-in-up stagger-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Surge Alert</p>
              <span className="text-base">⚡</span>
            </div>
            <p className={`text-4xl font-extrabold capitalize ${
              queueStatus?.congestion === 'critical' ? 'text-danger' :
              queueStatus?.congestion === 'surge' ? 'text-warning' :
              'text-on-surface'
            }`}>{queueStatus?.congestion || 'Normal'}</p>
            <p className="text-xs text-on-surface-variant mt-1">
              {queueStatus?.congestion === 'critical' ? 'Peak enrollment period' :
               queueStatus?.congestion === 'surge' ? 'Above normal traffic' :
               'Normal operations'}
            </p>
          </div>
        </>)}
      </div>

      {/* ─── Live Queue Feed ─────────────────────────────────────── */}
      <div className="card" style={{ padding: 0 }}>
        {/* Table Header */}
        <div className="px-6 pt-5 pb-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: '1px solid #e8ecf2' }}>
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-on-surface">Live Queue Feed</h3>
            <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full" style={{ background: '#ecfdf5', color: '#00c896' }}>Live Update</span>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setFilter('all')}
              className={`text-xs px-3.5 py-1.5 rounded-full font-medium transition-all ${
                filter === 'all' ? 'bg-primary text-white' : 'bg-surface text-on-surface-variant hover:bg-gray-100'
              }`}
            >All</button>
            {intentCategories.map(cat => (
              <button key={cat}
                onClick={() => setFilter(filter === cat ? 'all' : cat)}
                className={`text-xs px-3.5 py-1.5 rounded-full font-medium transition-all ${
                  filter === cat ? 'bg-primary text-white' : 'bg-surface text-on-surface-variant hover:bg-gray-100'
                }`}
              >{formatIntent(cat)}</button>
            ))}
          </div>
        </div>

        {/* Search bar inside table */}
        <div className="px-6 py-3" style={{ borderBottom: '1px solid #e8ecf2' }}>
          <div className="flex items-center gap-2 bg-surface rounded-btn px-3 py-2 max-w-sm">
            <svg className="w-4 h-4 text-on-surface-variant flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, token, or intent..."
              className="bg-transparent text-sm w-full outline-none text-on-surface placeholder-on-surface-variant"
            />
            {search && <button onClick={() => setSearch('')} className="text-on-surface-variant hover:text-on-surface text-xs">✕</button>}
          </div>
        </div>

        {/* Column Headers */}
        <div className="px-6 py-3 grid items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant" style={{
          gridTemplateColumns: '60px 1fr 140px 140px 120px 50px',
          borderBottom: '1px solid #e8ecf2',
        }}>
          <span>Pos</span>
          <span>Student / Token</span>
          <span>Intent</span>
          <span>Urgency</span>
          <span>Status</span>
          <span></span>
        </div>

        {/* Table Body */}
        {loading ? (
          <div className="p-6 space-y-4">
            {[1,2,3,4,5].map(i => <div key={i} className="skeleton h-16 rounded-btn" />)}
          </div>
        ) : displayedUsers.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-4xl block mb-3">📭</span>
            <p className="text-on-surface-variant font-medium">{search || filter !== 'all' ? 'No matching students found' : 'Queue is empty'}</p>
            <p className="text-xs text-on-surface-variant mt-1">{search && 'Try adjusting your search'}</p>
          </div>
        ) : (
          <div>
            {displayedUsers.map((u, idx) => (
              <QueueTableRow key={u.userId} user={u} idx={idx}
                ghostFlags={ghostFlags} actionLoading={actionLoading}
                handleCall={handleCall} handleAttended={handleAttended}
                handleRemoved={handleRemoved} handleDone={handleDone}
                getStatusBadge={getStatusBadge}
                getIntentColor={getIntentColor} getUrgencyColor={getUrgencyColor}
                formatIntent={formatIntent}
              />
            ))}
          </div>
        )}

        {/* Load More */}
        {filteredUsers.length > showCount && (
          <div className="text-center py-4" style={{ borderTop: '1px solid #e8ecf2' }}>
            <button onClick={() => setShowCount(p => p + 10)} className="text-sm font-medium text-primary hover:underline">
              Load More Students ↓
            </button>
          </div>
        )}

        {/* Result count */}
        {!loading && filteredUsers.length > 0 && (
          <div className="px-6 py-3 flex items-center justify-between text-xs text-on-surface-variant" style={{ borderTop: '1px solid #e8ecf2' }}>
            <span>Showing {Math.min(showCount, filteredUsers.length)} of {filteredUsers.length} students</span>
            <button onClick={fetchAll} className="text-primary font-medium hover:underline">↻ Refresh</button>
          </div>
        )}
      </div>

      {/* ─── Surge Alert Bar ─────────────────────────────────────── */}
      {surgeActive && (
        <div className="surge-bar animate-slide-up">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(229,57,53,0.1)' }}>
            <span className="text-lg">⚠️</span>
          </div>
          <div className="flex-1">
            <p className="font-bold text-on-surface text-sm">Queue Surge Detected</p>
            <p className="text-xs text-on-surface-variant">The wait time has exceeded target for {waitingCount} students. Consider opening additional stations.</p>
          </div>
          <button className="btn-danger text-xs px-4 py-2">Open Station</button>
        </div>
      )}
    </div>
  );
}

/* ─── Queue Table Row (for Queue Overview) ────────────────────────── */
function QueueTableRow({ user: u, idx, ghostFlags, actionLoading, handleCall, handleAttended, handleRemoved, handleDone, getStatusBadge, getIntentColor, getUrgencyColor, formatIntent }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const statusBadge = getStatusBadge(u);
  const intentColor = getIntentColor(u.intent_category);
  const urgScore = u.urgency_score || 0;
  const isGhost = ghostFlags?.[u.userId] || u.bail_probability > 85;

  return (
    <div
      className="px-6 py-4 grid items-center gap-4 transition-all duration-200 hover:bg-surface/50 animate-fade-in-up"
      style={{
        gridTemplateColumns: '60px 1fr 140px 140px 120px 50px',
        borderBottom: '1px solid #f0f2f5',
        animationDelay: `${idx * 40}ms`,
      }}
    >
      {/* Position */}
      <span className={`text-2xl font-extrabold ${
        u.status === 'called' || u.status === 'in_service' ? 'text-primary' : 'text-on-surface'
      }`}>#{u.position}</span>

      {/* Name & Token */}
      <div>
        <p className="text-sm font-semibold text-on-surface flex items-center gap-2">
          {u.name}
          {u.priority && u.priority !== 'normal' && <span className={`priority-badge ${u.priority}`}>{u.priority}</span>}
          {isGhost && <span className="ghost-badge">⚠ Ghost</span>}
        </p>
        <p className="text-xs font-mono text-on-surface-variant mt-0.5">{u.token}</p>
      </div>

      {/* Intent Badge */}
      <div>
        <span className="text-xs font-semibold px-3 py-1.5 rounded-full inline-block" style={{
          background: intentColor.bg, color: intentColor.color, border: `1px solid ${intentColor.border}`,
        }}>{formatIntent(u.intent_category)}</span>
      </div>

      {/* Urgency */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#e8ecf2', maxWidth: '80px' }}>
          <div className="h-full rounded-full transition-all duration-500" style={{
            width: `${Math.min(100, urgScore)}%`,
            background: getUrgencyColor(urgScore),
          }} />
        </div>
        <span className="text-xs font-bold text-on-surface" style={{ minWidth: '24px' }}>{urgScore}</span>
      </div>

      {/* Status */}
      <div>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full" style={{
          background: statusBadge.bg, color: statusBadge.color, border: statusBadge.border || 'none',
        }}>{statusBadge.label}</span>
      </div>

      {/* Actions Menu */}
      <div className="relative">
        <div className="dot-menu" onClick={() => setMenuOpen(!menuOpen)}><span /><span /><span /></div>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-1 bg-white rounded-btn shadow-card-hover py-2 w-48 z-20 animate-fade-in-scale">
              {u.status === 'waiting' && (
                <button onClick={() => { handleCall?.(); setMenuOpen(false); }} disabled={!!actionLoading} className="w-full text-left px-4 py-2 text-sm hover:bg-surface transition-colors text-primary font-medium">📢 Call to Counter</button>
              )}
              {u.status === 'called' && (
                <button onClick={() => { handleAttended?.(u.userId); setMenuOpen(false); }} disabled={!!actionLoading} className="w-full text-left px-4 py-2 text-sm hover:bg-surface transition-colors text-primary font-medium">✅ Mark Attended</button>
              )}
              {u.status === 'in_service' && (
                <button onClick={() => { handleDone?.(u.userId); setMenuOpen(false); }} disabled={!!actionLoading} className="w-full text-left px-4 py-2 text-sm hover:bg-surface transition-colors text-accent font-medium">✓ Mark Done</button>
              )}
              <button onClick={() => { handleRemoved?.(u.userId); setMenuOpen(false); }} disabled={!!actionLoading} className="w-full text-left px-4 py-2 text-sm hover:bg-surface transition-colors text-danger font-medium">✕ Remove</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════
   ANALYTICS VIEW — Performance & AI Insights page (Real Data)
   ═══════════════════════════════════════════════════════════════════ */
function AnalyticsView({ briefing, queueStatus, activeQueueId, idToken }) {
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Fetch real analytics data from backend
  useEffect(() => {
    if (!activeQueueId || !idToken) return;
    setAnalyticsLoading(true);
    getAnalytics(activeQueueId, idToken)
      .then(data => { setAnalytics(data); })
      .catch(err => { console.error('Analytics fetch error:', err); })
      .finally(() => setAnalyticsLoading(false));
  }, [activeQueueId, idToken]);

  // Also refresh every 30s
  useEffect(() => {
    if (!activeQueueId || !idToken) return;
    const iv = setInterval(() => {
      getAnalytics(activeQueueId, idToken)
        .then(data => setAnalytics(data))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(iv);
  }, [activeQueueId, idToken]);

  // Use real data or fallbacks
  const accuracyData = analytics?.accuracy_data?.length > 0 ? analytics.accuracy_data : [];
  const heatmapData = analytics?.heatmap_data?.length > 0 ? analytics.heatmap_data : [];
  const effScore = analytics?.efficiency_score ?? 0;
  const noShowRate = analytics?.no_show_rate ?? 0;
  const totalServed = analytics?.total_served_today ?? 0;
  const currentInQueue = analytics?.active_in_queue ?? queueStatus?.count ?? 0;
  const predictionAccuracy = analytics?.prediction_accuracy ?? 0;
  const peakHourLabel = analytics?.peak_hour_label ?? '—';
  const intentBreakdown = analytics?.intent_breakdown ?? [];

  const outlookCards = [
    { label: 'DEMAND FORECAST', text: briefing?.expected_peak || (analytics?.peak_hour_label ? `Peak traffic at ${analytics.peak_hour_label}` : 'Analyzing traffic patterns...'), color: '#1a3c8f' },
    { label: 'RESOURCE LOGIC', text: briefing?.staff_recommendation || `${analytics?.counters_open || 1} counter(s) active — Avg service: ${analytics?.avg_service_time || 7}m`, color: '#1a3c8f' },
    { label: 'PROACTIVE STRATEGY', text: briefing?.actionable_tip || (totalServed > 0 ? `${totalServed} served today with ${predictionAccuracy}% prediction accuracy` : 'Collecting data for recommendations...'), color: '#1a3c8f' },
  ];

  // SVG chart dimensions
  const chartW = 600, chartH = 220, padL = 40, padR = 20, padT = 20, padB = 30;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const hasChartData = accuracyData.length > 0;
  const maxVal = hasChartData ? Math.max(1, ...accuracyData.flatMap(d => [d.predicted, d.actual])) : 60;

  const getX = (i) => padL + (i / Math.max(1, accuracyData.length - 1)) * plotW;
  const getY = (v) => padT + plotH - (v / (maxVal + 10)) * plotH;

  const predictedPath = hasChartData ? accuracyData.map((d, i) => `${i === 0 ? 'M' : 'L'}${getX(i)},${getY(d.predicted)}`).join(' ') : '';
  const actualPath = hasChartData ? accuracyData.map((d, i) => `${i === 0 ? 'M' : 'L'}${getX(i)},${getY(d.actual)}`).join(' ') : '';

  // Y-axis ticks based on real data range
  const yStep = Math.max(5, Math.ceil(maxVal / 4 / 5) * 5);
  const yTicks = [0, yStep, yStep * 2, yStep * 3];

  // Intent color mapping
  const intentColorMap = {
    fee_payment: '#1a3c8f', admission: '#92400e', tc_mc_request: '#991b1b',
    scholarship: '#065f46', bonafide_cert: '#0369a1', exam_query: '#86198f', general: '#64748b',
  };

  const formatIntentLabel = (cat) => {
    if (!cat) return 'General';
    return cat.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  if (analyticsLoading) {
    return (
      <div className="p-6 space-y-6">
        <div><h1 className="text-2xl font-extrabold text-on-surface">Performance & AI Insights</h1></div>
        <div className="skeleton h-48 rounded-card" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 skeleton h-72 rounded-card" />
          <div className="lg:col-span-4 skeleton h-72 rounded-card" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="skeleton h-36 rounded-card" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in-up">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-on-surface">Performance & AI Insights</h1>
          <p className="text-sm text-on-surface-variant mt-1">Real-time metrics and predictive intelligence for campus operations.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full" style={{ background: '#ecfdf5', color: '#00c896' }}>Live Data</span>
        </div>
      </div>

      {/* ─── AI Daily Briefing Hero ───────────────────────────────── */}
      <div className="card-hero animate-fade-in-up stagger-1" style={{ padding: '2rem' }}>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.15)' }}>
            <span className="text-sm">📡</span>
          </div>
          <span className="text-xs font-bold uppercase tracking-widest text-white/60">AI Daily Briefing</span>
        </div>
        <h2 className="text-3xl font-extrabold text-white mb-5">Today's Outlook</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {outlookCards.map((card, i) => (
            <div key={i} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2">{card.label}</p>
              <p className="text-sm font-semibold text-white leading-relaxed">{card.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Charts Row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Wait Time Accuracy Chart */}
        <div className="lg:col-span-8 card animate-fade-in-up stagger-2">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="text-lg font-bold text-on-surface">Wait Time Accuracy</h3>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {hasChartData ? `Predicted vs. Actual wait times (${accuracyData.length} day${accuracyData.length > 1 ? 's' : ''})` : 'No historical data yet — serve students to start tracking'}
              </p>
            </div>
            {hasChartData && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#1a3c8f' }} />
                  <span className="text-xs text-on-surface-variant font-medium">Predicted</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#00c896' }} />
                  <span className="text-xs text-on-surface-variant font-medium">Actual</span>
                </div>
              </div>
            )}
          </div>

          {hasChartData ? (
            <div className="w-full overflow-hidden">
              <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" style={{ height: '240px' }}>
                {yTicks.map(v => (
                  <g key={v}>
                    <line x1={padL} y1={getY(v)} x2={chartW - padR} y2={getY(v)} stroke="#e8ecf2" strokeWidth="1" />
                    <text x={padL - 6} y={getY(v) + 4} textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="Inter">{v}m</text>
                  </g>
                ))}
                <path d={predictedPath} fill="none" stroke="#1a3c8f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d={actualPath} fill="none" stroke="#00c896" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {accuracyData.map((d, i) => (
                  <circle key={`p-${i}`} cx={getX(i)} cy={getY(d.predicted)} r="5" fill="#1a3c8f" stroke="white" strokeWidth="2" />
                ))}
                {accuracyData.map((d, i) => (
                  <circle key={`a-${i}`} cx={getX(i)} cy={getY(d.actual)} r="5" fill="#00c896" stroke="white" strokeWidth="2" />
                ))}
                {accuracyData.map((d, i) => (
                  <text key={`x-${i}`} x={getX(i)} y={chartH - 5} textAnchor="middle" fill="#94a3b8" fontSize="11" fontWeight="500" fontFamily="Inter">{d.day}</text>
                ))}
              </svg>
            </div>
          ) : (
            <div className="text-center py-16">
              <span className="text-4xl block mb-3">📊</span>
              <p className="text-on-surface-variant font-medium">Chart data will appear here as students are served</p>
              <p className="text-xs text-on-surface-variant mt-1">Predicted vs actual wait time comparison</p>
            </div>
          )}
        </div>

        {/* Traffic Heatmap */}
        <div className="lg:col-span-4 card animate-fade-in-up stagger-3">
          <h3 className="text-lg font-bold text-on-surface mb-1">Traffic Heatmap</h3>
          <p className="text-xs text-on-surface-variant mb-5">Today's busy periods by hour</p>

          {heatmapData.length > 0 ? (
            <div className="space-y-3.5">
              {heatmapData.map((row, i) => {
                const barColor = row.load >= 90 ? '#b45309' : row.load >= 70 ? '#1a3c8f' : row.load >= 40 ? '#3b82f6' : '#93c5fd';
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs font-medium text-on-surface-variant w-16 flex-shrink-0 text-right">{row.hourLabel}</span>
                    <div className="flex-1 h-3.5 rounded-full overflow-hidden" style={{ background: '#f0f2f5' }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{
                        width: `${Math.max(2, row.load)}%`,
                        background: barColor,
                        animationDelay: `${i * 100}ms`,
                      }} />
                    </div>
                    <span className="text-[10px] font-bold text-on-surface-variant w-6">{row.count}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-10">
              <span className="text-3xl block mb-2">🕐</span>
              <p className="text-sm text-on-surface-variant">No traffic data for today yet</p>
            </div>
          )}

          <div className="flex items-center gap-2 mt-6 pt-4" style={{ borderTop: '1px solid #e8ecf2' }}>
            <p className="text-xs text-on-surface-variant italic flex-1">
              {peakHourLabel !== '—' ? `Peak hour: ${peakHourLabel}` : 'Peak hour will be calculated'}
            </p>
            <span className="text-lg">📈</span>
          </div>
        </div>
      </div>

      {/* ─── Intent Breakdown (new section with real data) ────────── */}
      {intentBreakdown.length > 0 && (
        <div className="card animate-fade-in-up stagger-4">
          <h3 className="text-lg font-bold text-on-surface mb-1">Intent Distribution</h3>
          <p className="text-xs text-on-surface-variant mb-5">Breakdown of student visit purposes</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {intentBreakdown.map((item, i) => {
              const color = intentColorMap[item.category] || '#64748b';
              const total = intentBreakdown.reduce((s, x) => s + x.count, 0);
              const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
              return (
                <div key={i} className="rounded-xl p-4 text-center" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
                  <p className="text-2xl font-extrabold" style={{ color }}>{pct}%</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mt-1">{formatIntentLabel(item.category)}</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">{item.count} total</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Bottom Metric Cards ─────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Efficiency Score */}
        <div className="card animate-fade-in-up stagger-5" style={{ borderLeft: '4px solid #1a3c8f' }}>
          <div className="flex items-start justify-between mb-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Efficiency Score</p>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(26,60,143,0.08)' }}>
              <svg className="w-4 h-4" fill="none" stroke="#1a3c8f" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
          </div>
          <p className="text-5xl font-extrabold text-on-surface">{effScore} <span className="text-lg font-medium text-on-surface-variant">/100</span></p>
          <p className="text-xs text-on-surface-variant mt-2">Based on prediction accuracy & throughput</p>
        </div>

        {/* Prediction Accuracy */}
        <div className="card animate-fade-in-up stagger-5" style={{ borderLeft: '4px solid #3b82f6' }}>
          <div className="flex items-start justify-between mb-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Prediction Accuracy</p>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.08)' }}>
              <svg className="w-4 h-4" fill="none" stroke="#3b82f6" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
            </div>
          </div>
          <p className="text-5xl font-extrabold text-on-surface">{predictionAccuracy} <span className="text-lg font-medium text-on-surface-variant">%</span></p>
          <p className="text-xs text-on-surface-variant mt-2">Wait time prediction vs actual</p>
        </div>

        {/* No-Show Rate */}
        <div className="card animate-fade-in-up stagger-6" style={{ borderLeft: '4px solid #e53935' }}>
          <div className="flex items-start justify-between mb-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">No-Show Rate</p>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(229,57,53,0.08)' }}>
              <svg className="w-4 h-4" fill="none" stroke="#e53935" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" /></svg>
            </div>
          </div>
          <p className="text-5xl font-extrabold text-on-surface">{noShowRate} <span className="text-lg font-medium text-on-surface-variant">%</span></p>
          <p className="text-xs text-on-surface-variant mt-2">{analytics?.total_removed_today || 0} removed out of {(analytics?.total_served_today || 0) + (analytics?.total_removed_today || 0)} total</p>
        </div>

        {/* Total Served Today */}
        <div className="card animate-fade-in-up stagger-6" style={{ borderLeft: '4px solid #00c896' }}>
          <div className="flex items-start justify-between mb-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Total Served Today</p>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(0,200,150,0.08)' }}>
              <svg className="w-4 h-4" fill="none" stroke="#00c896" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
          </div>
          <p className="text-5xl font-extrabold text-on-surface">{totalServed}</p>
          <p className="text-xs text-on-surface-variant mt-2">{currentInQueue} students currently in queue</p>
        </div>
      </div>
    </div>
  );
}


/* ─── Queue Row Component ──────────────────────────────────────── */
function QueueRow({ user: u, ghostFlags, actionLoading, onCall, onAttended, onRemoved, style }) {
  const [elapsed, setElapsed] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!u.join_time) return;
    const update = () => setElapsed(Math.round((Date.now() - u.join_time) / 60000));
    update();
    const iv = setInterval(update, 10000);
    return () => clearInterval(iv);
  }, [u.join_time]);

  const isGhost = ghostFlags[u.userId] || u.bail_probability > 85;
  const isFirst = u.position === 1;

  return (
    <div className="card flex items-center gap-4 py-4 animate-fade-in-up" style={style}>
      {/* Position */}
      <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0 ${
        isFirst ? 'bg-primary text-white' : isGhost ? 'bg-danger-light text-danger border-2 border-danger/30' : 'bg-surface text-on-surface'
      }`}>
        {String(u.position).padStart(2, '0')}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-on-surface">{u.name}</span>
          {u.priority && u.priority !== 'normal' && <span className={`priority-badge ${u.priority}`}>{u.priority}</span>}
          {isGhost && <span className="ghost-badge">⚠ Ghost Alert</span>}
        </div>
        <p className="text-xs text-on-surface-variant font-mono mt-0.5">{u.token}</p>
      </div>

      {/* Intent */}
      <IntentBadge category={u.intent_category} />

      {/* Menu */}
      <div className="relative">
        <div className="dot-menu" onClick={() => setMenuOpen(!menuOpen)}><span /><span /><span /></div>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-1 bg-white rounded-btn shadow-card-hover py-2 w-44 z-20 animate-fade-in-scale">
              <button onClick={() => { onCall?.(); setMenuOpen(false); }} disabled={!!actionLoading} className="w-full text-left px-4 py-2 text-sm hover:bg-surface transition-colors text-primary font-medium">📢 Call to Counter</button>
              <button onClick={() => { onRemoved?.(u.userId); setMenuOpen(false); }} disabled={!!actionLoading} className="w-full text-left px-4 py-2 text-sm hover:bg-surface transition-colors text-danger font-medium">✕ Remove</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Service Timer ────────────────────────────────────────────── */
function ServiceTimer({ user }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = user.attended_at || user.called_at || user.join_time || Date.now();
    const update = () => setElapsed(Math.round((Date.now() - start) / 1000));
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [user]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <p className="text-white/70 text-sm">
      {user.status === 'in_service' ? 'Service time' : 'Called'}: <span className="font-mono font-bold text-white">{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>
    </p>
  );
}
