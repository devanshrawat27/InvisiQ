import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { auth, googleProvider, signInWithPopup, signOut } from '../firebase/config';
import { onAuthStateChanged } from 'firebase/auth';
import { useSocket } from '../hooks/useSocket';
import { 
  getQueueUsers, getQueueStatus, getBriefing, markAttended, markRemoved, markDone,
  pauseQueue, resumeQueue, callNextUser, getAnalytics,
  updateCounters, loginAdmin, listQueues, registerAdmin, createQueue, getMe 
} from '../utils/api';
import IntentBadge from '../components/IntentBadge';
import QRModal from '../components/QRModal';
import RequirementsManager from '../components/RequirementsManager';

function getQueueName(id) { return id.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()); }

export default function AdminDashboard() {
  const [availableQueues, setAvailableQueues] = useState([]);
  const [activeQueueId, setActiveQueueId] = useState('fee_cell');
  const [showQRModal, setShowQRModal] = useState(false);
  const [showReqs, setShowReqs] = useState(false);
  const [docPreview, setDocPreview] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentView, setCurrentView] = useState('dashboard'); // 'dashboard' | 'queue' | 'analytics' | 'system_control'

  // Auth
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [idToken, setIdToken] = useState(null);

  // JWT Auth login forms
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Load Queues list
  const loadQueuesList = useCallback(async () => {
    try {
      const res = await listQueues();
      if (res && res.queues) {
        setAvailableQueues(res.queues);
      }
    } catch (e) {
      console.error('Error loading queues:', e);
      setAvailableQueues([
        { id: 'fee_cell', name: 'Fee Cell' },
        { id: 'admin_cell', name: 'Admin Cell' },
        { id: 'admission_cell', name: 'Admission Cell' },
      ]);
    }
  }, []);

  useEffect(() => {
    loadQueuesList();
  }, [loadQueuesList]);

  // Auth Initialization
  useEffect(() => {
    // Check local storage for JWT token first
    const storedToken = localStorage.getItem('adminToken') || sessionStorage.getItem('adminToken');
    const storedUser = localStorage.getItem('adminUser') || sessionStorage.getItem('adminUser');
    
    if (storedToken && storedUser) {
      try {
        setIdToken(storedToken);
        setUser(JSON.parse(storedUser));
        setAuthLoading(false);
        return;
      } catch (e) {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
      }
    }

    // If Firebase client auth isn't configured, username/password login still works.
    if (!auth) { setAuthLoading(false); return; }

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        try {
          const t = await u.getIdToken();
          // The backend only accepts Firebase identities that are linked to an
          // existing admin account — validate before entering the dashboard.
          const me = await getMe(t);
          setIdToken(t);
          setUser(me.user);
        } catch {
          setAuthError('This Google account is not linked to an admin. Please use username/password sign-in.');
          try { await signOut(auth); } catch { /* ignore */ }
          setUser(null);
          setIdToken(null);
        }
      } else {
        setUser(null);
        setIdToken(null);
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // Filter queues based on role and cells
  const filteredQueues = useMemo(() => {
    if (!user) return [];
    if (user.role === 'super_admin' || (user.cells && user.cells.includes('*'))) {
      return availableQueues;
    }
    return availableQueues.filter(q => user.cells && user.cells.includes(q.id));
  }, [user, availableQueues]);

  // Reset active queue if not permitted
  useEffect(() => {
    if (filteredQueues.length > 0) {
      if (!filteredQueues.find(q => q.id === activeQueueId)) {
        setActiveQueueId(filteredQueues[0].id);
      }
    }
  }, [filteredQueues, activeQueueId]);

  const handleSignIn = async () => {
    if (!auth) {
      setAuthError('Google sign-in is not configured. Please use username and password.');
      return;
    }
    try {
      setAuthError(null);
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(`Sign in failed: ${err.code || err.message}`);
    }
  };

  const handleJWTLogin = async (e) => {
    if (e) e.preventDefault();
    setLoginLoading(true);
    setAuthError(null);
    try {
      const data = await loginAdmin(usernameInput, passwordInput);
      setIdToken(data.token);
      setUser(data.user);
      localStorage.setItem('adminToken', data.token);
      localStorage.setItem('adminUser', JSON.stringify(data.user));
    } catch (err) {
      setAuthError(err.message || 'Login failed. Check username and password.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSignOut = async () => {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    sessionStorage.removeItem('adminToken');
    sessionStorage.removeItem('adminUser');
    try {
      await signOut(auth);
    } catch (e) {
      console.error(e);
    }
    setUser(null);
    setIdToken(null);
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
        getQueueUsers(activeQueueId, idToken),
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
    user_called: (d) => { addNotif('call', `${d.name} called to ${d.counter}`); fetchAll(); },
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
    // If the action is markAttended, markRemoved, or markDone, the userId is args[1]
    const isUserAction = ['markAttended', 'markRemoved', 'markDone'].includes(fn.name);
    const loadingKey = isUserAction ? args[1] : 'global';
    setActionLoading(loadingKey);
    try {
      await fn(...args);
    } catch (e) {
      console.error('Action error:', e);
      alert(e.message || 'Action failed');
    } finally {
      setActionLoading(null);
      await fetchAll();
    }
  };

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
  const waiting = useMemo(() => users.filter(u => u.status === 'waiting').sort((a, b) => (a.position || 999) - (b.position || 999)), [users]);

  // Auth gate
  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="text-center"><div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" /><p className="mt-4 text-on-surface-variant text-sm">Loading…</p></div>
    </div>
  );

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-surface p-6">
      <div className="absolute inset-0 bg-mesh" />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md rounded-[24px] bg-white border border-slate-100 shadow-premium-lg p-8"
      >
        <div className="text-center mb-7">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 to-teal-400 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/25">
            <span className="text-white font-black text-2xl">IQ</span>
          </div>
          <h1 className="text-2xl font-extrabold text-on-surface tracking-tight">InvisiQ Admin</h1>
          <p className="text-on-surface-variant text-sm mt-1">Sign in to manage your queues</p>
        </div>

        {authError && (
          <div className="bg-danger-light text-danger-dark text-sm p-3.5 rounded-xl mb-5 border border-red-100">{authError}</div>
        )}

        <form onSubmit={handleJWTLogin} className="space-y-3">
          <input
            type="text" value={usernameInput} onChange={e => setUsernameInput(e.target.value)}
            placeholder="Username" required autoFocus className="input-field"
          />
          <input
            type="password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)}
            placeholder="Password" required className="input-field"
          />
          <button type="submit" disabled={loginLoading} className="btn-primary w-full mt-2">
            {loginLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-slate-100">
          <button onClick={handleSignIn} className="btn-ghost w-full text-xs">Or continue with Google</button>
        </div>
      </motion.div>
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
            <div className={`sidebar-item ${currentView === 'analytics' ? 'active' : ''}`} onClick={() => { setCurrentView('analytics'); setSidebarOpen(false); }} style={{ cursor: 'pointer' }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> Analytics
            </div>
            {(user?.role === 'super_admin' || user?.cells?.includes('*')) && (
              <div className={`sidebar-item ${currentView === 'system_control' ? 'active' : ''}`} onClick={() => { setCurrentView('system_control'); setSidebarOpen(false); }} style={{ cursor: 'pointer' }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg> Setup &amp; Admins
              </div>
            )}
          </nav>
        </div>

        {/* Queue Selector */}
        <div className="px-5 mt-4">
          <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-3">
            {user?.role === 'super_admin' ? 'All Queues' : 'My Queues'}
          </p>
          <div className="space-y-1">
            {filteredQueues.map(q => (
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
              <p className="text-xs text-on-surface-variant">{user.role === 'super_admin' ? '👑 Super Admin' : `🔑 ${user.cells?.join(', ') || 'Cell Admin'}`}</p>
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
        <header className="bg-white px-6 py-4 flex items-center gap-4 border-b border-gray-100 flex-wrap">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-2 rounded-btn hover:bg-surface" aria-label="Menu"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg></button>

          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Managing queue</p>
            <div className="flex items-center gap-2 mt-0.5">
              <h2 className="text-base font-bold text-on-surface truncate">{getQueueName(activeQueueId)}</h2>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                queueStatus?.status === 'open' ? 'bg-teal-100 text-teal-700'
                  : queueStatus?.status === 'paused' ? 'bg-amber-100 text-amber-700'
                  : 'bg-red-100 text-red-700'}`}>
                {queueStatus?.status || 'open'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={fetchAll} className="btn-ghost text-xs">↻ Refresh</button>
            <button onClick={() => setShowQRModal(true)} className="btn-ghost text-xs">📱 QR code</button>
            <button onClick={() => setShowReqs(true)} className="btn-ghost text-xs">📄 Documents</button>
            <button onClick={handlePause} className={`text-xs px-4 py-2 rounded-btn font-semibold transition-all ${queueStatus?.status === 'open' ? 'btn-outline' : 'btn-danger'}`}>
              {queueStatus?.status === 'open' ? '⏸ Pause joins' : '▶ Resume joins'}
            </button>
          </div>
        </header>

        {/* Route content based on currentView */}
        {currentView === 'dashboard' && (
          <DashboardView
            loading={loading} queueStatus={queueStatus} users={users} waiting={waiting}
            ghostFlags={ghostFlags} actionLoading={actionLoading}
            notifications={notifications} activeQueueId={activeQueueId} idToken={idToken}
            fetchAll={fetchAll} handleAttended={handleAttended}
            handleRemoved={handleRemoved} handleDone={handleDone}
            onPreviewDocuments={setDocPreview}
          />
        )}
        {currentView === 'analytics' && (
          <AnalyticsView briefing={briefing} queueStatus={queueStatus} activeQueueId={activeQueueId} idToken={idToken} />
        )}
        {currentView === 'system_control' && (user?.role === 'super_admin' || user?.cells?.includes('*')) && (
          <SystemControlView idToken={idToken} onQueueCreated={loadQueuesList} />
        )}
      </main>

      {/* Modals */}
      {showQRModal && <QRModal queueId={activeQueueId} queueName={getQueueName(activeQueueId)} onClose={() => setShowQRModal(false)} />}
      {showReqs && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowReqs(false)}>
          <div className="bg-white rounded-card max-w-lg w-full p-6 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <RequirementsManager queueId={activeQueueId} token={idToken} onClose={() => setShowReqs(false)} />
          </div>
        </div>
      )}
      {docPreview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDocPreview(null)}>
          <div className="w-full max-w-4xl rounded-3xl overflow-hidden bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-200">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Uploaded documents</p>
                <h3 className="text-lg font-bold text-on-surface">{docPreview.userName || 'Student'} {docPreview.token ? `• ${docPreview.token}` : ''}</h3>
              </div>
              <button onClick={() => setDocPreview(null)} className="w-10 h-10 rounded-full hover:bg-slate-100 text-slate-500 text-xl leading-none">×</button>
            </div>
            <div className="grid md:grid-cols-[280px_1fr] min-h-[65vh]">
              <div className="border-r border-slate-200 bg-slate-50 p-4 overflow-y-auto">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Files</p>
                <div className="space-y-2">
                  {(docPreview.documents || []).map((doc, index) => (
                    <button
                      key={`${doc.name || 'doc'}-${index}`}
                      onClick={() => setDocPreview(prev => ({ ...prev, activeIndex: index }))}
                      className={`w-full text-left px-3 py-3 rounded-2xl transition-colors ${docPreview.activeIndex === index ? 'bg-primary text-white' : 'bg-white hover:bg-slate-100 text-on-surface'}`}
                    >
                      <p className="text-sm font-semibold truncate">{doc.name || `Document ${index + 1}`}</p>
                      <p className={`text-[11px] mt-1 truncate ${docPreview.activeIndex === index ? 'text-white/75' : 'text-slate-500'}`}>{doc.url || 'No file URL available'}</p>
                    </button>
                  ))}
                  {(docPreview.documents || []).length === 0 && (
                    <div className="rounded-2xl bg-white p-4 text-sm text-slate-500">No uploaded documents for this user.</div>
                  )}
                </div>
              </div>
              <div className="p-4 md:p-6 bg-white">
                {(() => {
                  const currentDoc = (docPreview.documents || [])[docPreview.activeIndex || 0];
                  if (!currentDoc) {
                    return <div className="h-full min-h-[420px] rounded-3xl bg-slate-50 flex items-center justify-center text-slate-500">Select a file to preview it here.</div>;
                  }

                  const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(currentDoc.url || currentDoc.name || '');
                  const isPdf = /\.pdf$/i.test(currentDoc.url || currentDoc.name || '');

                  return (
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Preview</p>
                          <h4 className="text-base font-bold text-on-surface mt-1">{currentDoc.name || 'Document'}</h4>
                        </div>
                        {currentDoc.url && (
                          <a href={currentDoc.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary hover:underline">Open in new tab</a>
                        )}
                      </div>
                      <div className="min-h-[420px] rounded-3xl overflow-hidden bg-slate-100 flex items-center justify-center">
                        {currentDoc.url ? (
                          isImage ? (
                            <img src={currentDoc.url} alt={currentDoc.name || 'Uploaded document'} className="w-full h-full object-contain" />
                          ) : isPdf ? (
                            <iframe title={currentDoc.name || 'Uploaded document'} src={currentDoc.url} className="w-full h-[70vh] border-0" />
                          ) : (
                            <div className="p-6 text-center">
                              <p className="text-lg font-semibold text-on-surface">Preview unavailable</p>
                              <p className="text-sm text-on-surface-variant mt-2">This file type can be opened in a new tab.</p>
                            </div>
                          )
                        ) : (
                          <div className="p-6 text-center">
                            <p className="text-lg font-semibold text-on-surface">No preview URL</p>
                            <p className="text-sm text-on-surface-variant mt-2">The upload exists, but the link is missing.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════
   DASHBOARD VIEW — the original main dashboard content
   ═══════════════════════════════════════════════════════════════════ */
function DashboardView({
  loading, queueStatus, users = [], waiting = [], ghostFlags, actionLoading,
  notifications = [], activeQueueId, idToken, fetchAll,
  handleAttended, handleRemoved, handleDone, onPreviewDocuments,
}) {
  const [counterLoading, setCounterLoading] = useState(false);

  const counters = queueStatus?.counters || [];
  const crowd = queueStatus?.crowd;
  const idleCounters = counters.filter(c => (c.status || 'idle') === 'idle');
  const servingUsers = users.filter(u => u.status === 'called' || u.status === 'in_service');
  const waitingCount = queueStatus?.waiting_count ?? waiting.length;
  const countersOpen = counters.length || queueStatus?.counters_open || 1;
  const crowdLevel = crowd?.level || queueStatus?.congestion || 'normal';
  const recommendations = Array.isArray(crowd?.recommendations) ? crowd.recommendations : [];

  const userForCounter = (cid) => servingUsers.find(u => u.counter_id === cid) || null;

  const callOnCounter = async (cid) => {
    if (!cid) return;
    setCounterLoading(true);
    try { await callNextUser(activeQueueId, idToken, cid); await fetchAll(); }
    catch (e) { console.error('Call error:', e); }
    finally { setCounterLoading(false); }
  };

  const addCounter = async () => {
    setCounterLoading(true);
    try { await updateCounters(activeQueueId, 'add', idToken); await fetchAll(); }
    catch (e) { console.error('Add counter error:', e); }
    finally { setCounterLoading(false); }
  };

  const removeCounter = async (cid) => {
    setCounterLoading(true);
    try { await updateCounters(activeQueueId, { action: 'remove', counter_id: cid }, idToken); await fetchAll(); }
    catch (e) { console.error('Remove counter error:', e); }
    finally { setCounterLoading(false); }
  };

  const pauseJoins = async () => {
    try { await pauseQueue(activeQueueId, idToken); await fetchAll(); }
    catch (e) { console.error(e); }
  };

  const firstCallable = (idleCounters[0]?.id) || (counters[0]?.id) || 'counter_1';

  const exportCsv = () => {
    const rows = [
      ['Position', 'Name', 'Token', 'Reason', 'Status', 'Waiting (min)'],
      ...users
        .filter(u => ['waiting', 'called', 'in_service'].includes(u.status))
        .sort((a, b) => (a.position || 999) - (b.position || 999))
        .map(u => [
          u.position || '',
          `"${(u.name || '').replace(/"/g, '""')}"`,
          u.token || '',
          `"${(u.intent_details || u.intent_category || '').replace(/"/g, '""')}"`,
          u.status || '',
          u.join_time ? Math.round((Date.now() - u.join_time) / 60000) : '',
        ]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${activeQueueId}_queue_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="p-6 space-y-6">
      {/* ─── Step 1: What needs attention (only if there is something) ─── */}
      {recommendations.length > 0 && (
        <div className="space-y-2">
          {recommendations.map((r) => (
            <div key={r.id} className={`flex flex-wrap items-center gap-3 rounded-2xl p-4 border ${
              r.severity === 'high' ? 'bg-red-50 border-red-100'
                : r.severity === 'warning' ? 'bg-amber-50 border-amber-100'
                : 'bg-indigo-50 border-indigo-100'
            }`}>
              <span className="text-xl">{r.severity === 'high' ? '⚠️' : r.severity === 'warning' ? '⏱' : '💡'}</span>
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm font-bold text-on-surface">{r.title}</p>
                <p className="text-xs text-on-surface-variant mt-0.5">{r.detail}</p>
              </div>
              <div className="flex gap-2">
                {r.action === 'call_next' && (idleCounters[0] || counters[0]) && (
                  <button onClick={() => callOnCounter(firstCallable)} disabled={counterLoading} className="btn-primary text-xs px-4 py-2">Call next</button>
                )}
                {r.action === 'add_counter' && (
                  <button onClick={addCounter} disabled={counterLoading} className="btn-primary text-xs px-4 py-2">Add counter</button>
                )}
                {r.action === 'limit_joins' && (
                  <button onClick={pauseJoins} className="btn-danger text-xs px-4 py-2">Pause joins</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Step 2: Numbers at a glance ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? [1, 2, 3, 4].map(i => <div key={i} className="skeleton h-24 rounded-card" />) : (<>
          <KpiCard label="Waiting" value={waitingCount} sub="students in line" tone="primary" />
          <KpiCard label="Being served" value={servingUsers.length} sub={`at ${countersOpen} counter${countersOpen > 1 ? 's' : ''}`} tone="accent" />
          <KpiCard label="Avg wait" value={`${queueStatus?.avg_wait || 0}m`} sub="estimated" tone="violet" />
          <KpiCard label="Traffic" value={String(crowdLevel).replace(/^\w/, c => c.toUpperCase())} sub="crowd level" tone={crowdLevel === 'surge' ? 'danger' : crowdLevel === 'busy' ? 'warning' : 'success'} />
        </>)}
      </div>

      {/* ─── Step 3: Counters board — the main action surface ─── */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h3 className="text-lg font-bold text-on-surface">Counters</h3>
            <p className="text-xs text-on-surface-variant">Call a student, then mark them arrived → complete. Simple.</p>
          </div>
          <button onClick={addCounter} disabled={counterLoading} className="btn-outline text-xs px-4 py-2">+ Add counter</button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <div key={i} className="skeleton h-44 rounded-card" />)}
          </div>
        ) : counters.length === 0 ? (
          <div className="card text-center py-10">
            <p className="text-on-surface-variant">No counters set up for this queue yet.</p>
            <button onClick={addCounter} className="btn-primary text-xs px-4 py-2 mt-4">+ Add first counter</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {counters.map((c) => (
              <CounterCard
                key={c.id}
                counter={c}
                user={userForCounter(c.id)}
                totalCounters={counters.length}
                waitingCount={waitingCount}
                actionLoading={actionLoading}
                onCall={callOnCounter}
                onAttended={handleAttended}
                onRemoved={handleRemoved}
                onDone={handleDone}
                onRemove={removeCounter}
                onPreviewDocuments={onPreviewDocuments}
              />
            ))}
          </div>
        )}
      </div>

      {/* ─── Step 4: Waiting list ─── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-on-surface">Waiting list <span className="text-on-surface-variant font-medium">({waiting.length})</span></h3>
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} className="btn-ghost text-xs">⬇ Export CSV</button>
            <button onClick={fetchAll} className="btn-ghost text-xs">↻ Refresh</button>
          </div>
        </div>
        {loading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="skeleton h-16 rounded-btn" />)}</div>
        ) : waiting.length === 0 ? (
          <div className="text-center py-10">
            <span className="text-4xl block mb-2">📭</span>
            <p className="text-on-surface-variant">Nobody is waiting right now.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {waiting.map((u, i) => (
              <QueueRow
                key={u.userId}
                user={u}
                ghostFlags={ghostFlags}
                actionLoading={actionLoading}
                onCall={() => callOnCounter(firstCallable)}
                onAttended={handleAttended}
                onRemoved={handleRemoved}
                onPreviewDocuments={onPreviewDocuments}
                style={{ animationDelay: `${i * 50}ms` }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ─── Step 5: Recent activity ─── */}
      <div className="card">
        <h3 className="font-bold text-on-surface mb-1">Recent activity</h3>
        <p className="text-xs text-on-surface-variant mb-4">The queue only moves when you act — nothing happens automatically.</p>
        {notifications.length === 0 ? (
          <p className="text-sm text-on-surface-variant text-center py-8">No activity yet.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {notifications.slice(0, 12).map((n, i) => (
              <div key={i} className="flex items-start gap-2 p-2.5 rounded-btn bg-surface text-sm">
                <span className="flex-shrink-0">{n.type === 'call' ? '📢' : n.type === 'done' ? '✅' : n.type === 'remove' ? '❌' : n.type === 'ghost' ? '👻' : n.type === 'surge' ? '⚡' : '🔔'}</span>
                <p className="text-on-surface-variant flex-1">{n.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, tone = 'primary' }) {
  const tones = {
    primary: 'text-primary', accent: 'text-accent', violet: 'text-teal-700',
    danger: 'text-danger', warning: 'text-warning', success: 'text-success',
  };
  return (
    <div className="stat-card">
      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{label}</p>
      <p className={`text-3xl font-extrabold mt-1 ${tones[tone] || tones.primary}`}>{value}</p>
      <p className="text-xs text-on-surface-variant mt-0.5">{sub}</p>
    </div>
  );
}

function CounterCard({ counter, user, totalCounters, waitingCount, actionLoading, onCall, onAttended, onRemoved, onDone, onRemove, onPreviewDocuments }) {
  const status = counter.status || (counter.current_user_id ? 'serving' : 'idle');
  const busy = status !== 'idle' && user;
  const badge = status === 'idle'
    ? { t: 'Free', c: 'bg-slate-100 text-slate-500' }
    : status === 'in_service'
      ? { t: 'In service', c: 'bg-amber-100 text-amber-700' }
      : { t: 'Serving', c: 'bg-indigo-100 text-indigo-700' };

  return (
    <div className="card flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-extrabold">
            {(counter.label || '').match(/\d+/) ? (counter.label.match(/\d+/)[0]) : '•'}
          </div>
          <div>
            <p className="font-bold text-on-surface text-sm">{counter.label || counter.id}</p>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${badge.c}`}>{badge.t}</span>
          </div>
        </div>
        {status === 'idle' && totalCounters > 1 && (
          <button onClick={() => onRemove(counter.id)} disabled={actionLoading} title="Remove this counter" className="w-7 h-7 rounded-lg text-slate-400 hover:text-danger hover:bg-red-50 flex items-center justify-center">−</button>
        )}
      </div>

      {busy ? (
        <div className="flex-1 flex flex-col">
          <div className="rounded-2xl bg-surface p-3 mb-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-bold text-on-surface">{user.name}</p>
              {Array.isArray(user.submitted_documents) && user.submitted_documents.length > 0 && (
                <button onClick={() => onPreviewDocuments?.({ userName: user.name, token: user.token, documents: user.submitted_documents, activeIndex: 0 })}
                  className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-primary/10 text-primary">
                  {user.submitted_documents.length} docs
                </button>
              )}
            </div>
            <p className="text-xs font-mono text-on-surface-variant mt-0.5">{user.token}</p>
            <ElapsedTimer user={user} />
          </div>
          <div className="flex gap-2 mt-auto">
            {user.status === 'called' && (
              <button onClick={() => onAttended(user.userId)} disabled={actionLoading === user.userId} className="btn-accent flex-1">Mark arrived</button>
            )}
            {user.status === 'in_service' && (
              <button onClick={() => onDone(user.userId)} disabled={actionLoading === user.userId} className="btn-accent flex-1">Complete</button>
            )}
            <button onClick={() => onRemoved(user.userId)} disabled={actionLoading === user.userId} className="btn-danger">No-show</button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <p className="text-sm text-on-surface-variant mb-4">No student at this counter.</p>
          <button
            onClick={() => onCall(counter.id)}
            disabled={actionLoading || waitingCount === 0}
            className={`mt-auto w-full py-3 rounded-xl font-bold text-sm ${waitingCount === 0 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'btn-primary'}`}
          >
            {waitingCount === 0 ? 'Queue is empty' : '📢 Call next student'}
          </button>
        </div>
      )}
    </div>
  );
}

function ElapsedTimer({ user, light = false }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const start = user.attended_at || user.called_at || user.join_time || now;
  const secs = Math.max(0, Math.round((now - start) / 1000));
  const label = user.status === 'in_service' ? 'Service time' : 'Called';
  return (
    <p className={`text-xs mt-1.5 ${light ? 'text-white/70' : 'text-on-surface-variant'}`}>
      {label}: <span className="font-mono font-bold">{String(Math.floor(secs / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}</span>
    </p>
  );
}


/* ═══════════════════════════════════════════════════════════════════
   ANALYTICS VIEW — Performance & AI Insights page (Real Data)
   ═══════════════════════════════════════════════════════════════════ */
function AnalyticsView({ briefing, queueStatus, activeQueueId, idToken }) {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('today');

  useEffect(() => {
    if (!activeQueueId || !idToken) return;
    setLoading(true);
    getAnalytics(activeQueueId, idToken, range)
      .then(setAnalytics)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeQueueId, idToken, range]);

  useEffect(() => {
    if (!activeQueueId || !idToken) return;
    const iv = setInterval(() => {
      getAnalytics(activeQueueId, idToken, range).then(setAnalytics).catch(() => {});
    }, 30000);
    return () => clearInterval(iv);
  }, [activeQueueId, idToken, range]);

  const formatIntent = (cat) => (cat || 'General').replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  const rangeLabel = range === 'today' ? 'today' : range === 'week' ? 'this week' : 'this month';

  const served = analytics?.total_served_today ?? 0;
  const removed = analytics?.total_removed_today ?? 0;
  const total = served + removed;
  const noShow = analytics?.no_show_rate ?? 0;
  const avgWait = analytics?.avg_wait ?? queueStatus?.avg_wait ?? 0;
  const avgService = analytics?.avg_service_time ?? 7;
  const accuracy = analytics?.prediction_accuracy ?? 0;
  const inQueue = analytics?.active_in_queue ?? queueStatus?.count ?? 0;
  const peak = analytics?.peak_hour_label;
  const heatmap = (analytics?.heatmap_data || []).filter(h => h.count > 0);
  const intents = analytics?.intent_breakdown || [];
  const maxIntent = Math.max(1, ...intents.map(i => i.count));
  const trend = analytics?.daily_served_trend || [];
  const maxTrend = Math.max(1, ...trend.map(d => d.served));

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="skeleton h-10 w-64 rounded-btn" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-24 rounded-card" />)}</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="skeleton h-64 rounded-card" />
          <div className="skeleton h-64 rounded-card" />
        </div>
      </div>
    );
  }

  const summary = briefing?.summary || briefing?.actionable_tip ||
    (total > 0
      ? `${served} student${served === 1 ? '' : 's'} served ${rangeLabel}, with an average wait of about ${avgWait} minutes.`
      : `No students have been served ${rangeLabel} yet.`);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-on-surface">Reports</h1>
          <p className="text-sm text-on-surface-variant mt-1">A simple summary of how your queue is doing.</p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100">
          {[{ k: 'today', t: 'Today' }, { k: 'week', t: 'This week' }, { k: 'month', t: 'This month' }].map((opt) => (
            <button key={opt.k} onClick={() => setRange(opt.k)}
              className={`text-xs font-semibold px-4 py-2 rounded-lg transition-all ${range === opt.k ? 'bg-white text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>
              {opt.t}
            </button>
          ))}
        </div>
      </div>

      {/* Key numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label={`Served ${rangeLabel}`} value={served} sub="completed services" tone="accent" />
        <KpiCard label="No-shows" value={`${noShow}%`} sub={`${removed} student${removed === 1 ? '' : 's'}`} tone={noShow >= 30 ? 'danger' : 'primary'} />
        <KpiCard label="Avg waiting time" value={`${avgWait}m`} sub={`service takes ~${avgService}m`} tone="violet" />
        <KpiCard label="Prediction accuracy" value={`${accuracy}%`} sub="how close our estimates were" tone={accuracy >= 70 ? 'success' : 'warning'} />
      </div>

      {/* Plain-language summary */}
      <div className="card flex items-start gap-3">
        <span className="text-xl">💡</span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{range === 'today' ? "Today's summary" : 'Summary'}</p>
          <p className="text-sm text-on-surface mt-1">{summary}</p>
          {peak && <p className="text-xs text-on-surface-variant mt-1">Busiest time: <span className="font-semibold text-on-surface">{peak}</span></p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Busiest hours */}
        <div className="card">
          <h3 className="font-bold text-on-surface">Busiest hours</h3>
          <p className="text-xs text-on-surface-variant mb-4">How many students joined in each hour ({rangeLabel}).</p>
          {heatmap.length === 0 ? (
            <p className="text-sm text-on-surface-variant text-center py-10">No traffic recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {heatmap.map((row) => (
                <div key={row.hour} className="flex items-center gap-3">
                  <span className="w-14 text-right text-xs text-on-surface-variant">{row.hourLabel}</span>
                  <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, row.load)}%` }} />
                  </div>
                  <span className="w-8 text-xs font-bold text-on-surface">{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reasons */}
        <div className="card">
          <h3 className="font-bold text-on-surface">What students came for</h3>
          <p className="text-xs text-on-surface-variant mb-4">Most common reasons ({rangeLabel}).</p>
          {intents.length === 0 ? (
            <p className="text-sm text-on-surface-variant text-center py-10">No data yet.</p>
          ) : (
            <div className="space-y-3">
              {intents.slice(0, 6).map((it) => (
                <div key={it.category}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold text-on-surface">{formatIntent(it.category)}</span>
                    <span className="text-on-surface-variant">{it.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((it.count / maxIntent) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Daily trend (week/month) */}
      {range !== 'today' && trend.length > 0 && (
        <div className="card">
          <h3 className="font-bold text-on-surface">Students served per day</h3>
          <p className="text-xs text-on-surface-variant mb-5">Daily totals for {analytics?.range_label || rangeLabel}.</p>
          <div className="flex items-end gap-1.5" style={{ height: '160px' }}>
            {trend.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                <span className="text-[10px] font-bold text-on-surface">{d.served || ''}</span>
                <div className="w-full rounded-t-md bg-primary/80" style={{ height: `${Math.max(4, (d.served / maxTrend) * 120)}px` }} />
                <span className="text-[9px] text-on-surface-variant">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* How we did */}
      <div className="card">
        <h3 className="font-bold text-on-surface mb-1">How we did {rangeLabel}</h3>
        <p className="text-xs text-on-surface-variant mb-4">Completed vs missed students at a glance.</p>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <MiniStat label="Served" value={served} />
          <MiniStat label="No-shows" value={removed} />
          <MiniStat label="In queue now" value={inQueue} />
        </div>
        {total > 0 && (
          <div>
            <div className="flex h-3 rounded-full overflow-hidden bg-slate-100">
              <div className="h-full bg-accent" style={{ width: `${Math.round((served / total) * 100)}%` }} />
              <div className="h-full bg-red-400/80" style={{ width: `${Math.round((removed / total) * 100)}%` }} />
            </div>
            <div className="flex justify-between text-[11px] text-on-surface-variant mt-2">
              <span>✅ Served {Math.round((served / total) * 100)}%</span>
              <span>❌ No-show {Math.round((removed / total) * 100)}%</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Queue Row Component ──────────────────────────────────────── */
function QueueRow({ user: u, ghostFlags, actionLoading, onCall, onAttended, onRemoved, onPreviewDocuments, style }) {
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
          {Array.isArray(u.submitted_documents) && u.submitted_documents.length > 0 && (
            <button
              onClick={() => onPreviewDocuments?.({
                userName: u.name,
                token: u.token,
                documents: u.submitted_documents,
                activeIndex: 0,
              })}
              className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/15"
            >
              {u.submitted_documents.length} docs
            </button>
          )}
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

/* ═══════════════════════════════════════════════════════════════════
   SYSTEM CONTROL VIEW — Super Admin panel to manage queues & admins
   ═══════════════════════════════════════════════════════════════════ */
function SystemControlView({ idToken, onQueueCreated }) {
  // Create Queue form
  const [queueName, setQueueName] = useState('');
  const [queueCounters, setQueueCounters] = useState(1);
  const [queueCreating, setQueueCreating] = useState(false);
  const [queueMsg, setQueueMsg] = useState(null);

  // Register Admin form
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminDisplayName, setAdminDisplayName] = useState('');
  const [adminCells, setAdminCells] = useState('');
  const [adminCreating, setAdminCreating] = useState(false);
  const [adminMsg, setAdminMsg] = useState(null);

  const handleCreateQueue = async (e) => {
    e.preventDefault();
    setQueueCreating(true);
    setQueueMsg(null);
    try {
      const queueId = queueName.trim().toLowerCase().replace(/\s+/g, '_');
      await createQueue({
        queue_id: queueId,
        name: queueName.trim(),
        type: queueId,
        counters_open: queueCounters,
      }, idToken);
      setQueueMsg({ type: 'success', text: `✅ Queue "${queueName}" created successfully!` });
      setQueueName('');
      setQueueCounters(1);
      if (onQueueCreated) onQueueCreated();
    } catch (err) {
      setQueueMsg({ type: 'error', text: err.message || 'Failed to create queue' });
    } finally {
      setQueueCreating(false);
    }
  };

  const handleRegisterAdmin = async (e) => {
    e.preventDefault();
    setAdminCreating(true);
    setAdminMsg(null);
    try {
      const cellsArray = adminCells.split(',').map(c => c.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean);
      await registerAdmin({
        username: adminUsername.trim().toLowerCase(),
        password: adminPassword,
        displayName: adminDisplayName.trim(),
        cells: cellsArray,
        role: 'cell_admin',
      }, idToken);
      setAdminMsg({ type: 'success', text: `✅ Admin "${adminDisplayName}" registered!` });
      setAdminUsername('');
      setAdminPassword('');
      setAdminDisplayName('');
      setAdminCells('');
    } catch (err) {
      setAdminMsg({ type: 'error', text: err.message || 'Failed to register admin' });
    } finally {
      setAdminCreating(false);
    }
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in-up">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-on-surface">System Control</h1>
        <p className="text-sm text-on-surface-variant mt-1">Manage queues, cells, and admin accounts. Super Admin only.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ─── Create New Queue ──────────────────────────────── */}
        <div className="card animate-fade-in-up stagger-1">
          <h3 className="text-lg font-bold text-on-surface mb-1">Create New Queue Cell</h3>
          <p className="text-xs text-on-surface-variant mb-5">Add a new department or service counter to the system.</p>

          {queueMsg && (
            <div className={`text-sm p-3 rounded-btn mb-4 ${queueMsg.type === 'success' ? 'bg-success/10 text-success' : 'bg-danger-light text-danger-dark'}`}>
              {queueMsg.text}
            </div>
          )}

          <form onSubmit={handleCreateQueue} className="space-y-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1 block">Queue Name</label>
              <input type="text" value={queueName} onChange={e => setQueueName(e.target.value)} required
                placeholder="e.g. Library Cell, Hostel Cell"
                className="w-full px-4 py-3 rounded-btn bg-surface border border-gray-200 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1 block">Counters Open</label>
              <input type="number" min="1" max="10" value={queueCounters} onChange={e => setQueueCounters(Number(e.target.value))}
                className="w-full px-4 py-3 rounded-btn bg-surface border border-gray-200 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all" />
            </div>
            <button type="submit" disabled={queueCreating} className="btn-primary w-full">
              {queueCreating ? 'Creating...' : '➕ Create Queue'}
            </button>
          </form>
        </div>

        {/* ─── Register New Admin ───────────────────────────── */}
        <div className="card animate-fade-in-up stagger-2">
          <h3 className="text-lg font-bold text-on-surface mb-1">Register New Admin</h3>
          <p className="text-xs text-on-surface-variant mb-5">Create a new cell operator account with specific queue access.</p>

          {adminMsg && (
            <div className={`text-sm p-3 rounded-btn mb-4 ${adminMsg.type === 'success' ? 'bg-success/10 text-success' : 'bg-danger-light text-danger-dark'}`}>
              {adminMsg.text}
            </div>
          )}

          <form onSubmit={handleRegisterAdmin} className="space-y-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1 block">Display Name</label>
              <input type="text" value={adminDisplayName} onChange={e => setAdminDisplayName(e.target.value)} required
                placeholder="e.g. Library Operator"
                className="w-full px-4 py-3 rounded-btn bg-surface border border-gray-200 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1 block">Username</label>
                <input type="text" value={adminUsername} onChange={e => setAdminUsername(e.target.value)} required
                  placeholder="library_admin"
                  className="w-full px-4 py-3 rounded-btn bg-surface border border-gray-200 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1 block">Password</label>
                <input type="text" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} required
                  placeholder="Library@123"
                  className="w-full px-4 py-3 rounded-btn bg-surface border border-gray-200 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1 block">Assigned Cells (comma-separated IDs)</label>
              <input type="text" value={adminCells} onChange={e => setAdminCells(e.target.value)} required
                placeholder="e.g. library_cell, hostel_cell"
                className="w-full px-4 py-3 rounded-btn bg-surface border border-gray-200 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all" />
            </div>
            <button type="submit" disabled={adminCreating} className="btn-primary w-full">
              {adminCreating ? 'Registering...' : '👤 Register Admin'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ─── Small shared UI pieces ─────────────────────────────────────────── */
function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl bg-slate-50/80 p-3 text-center border border-slate-100">
      <p className="text-[9px] uppercase tracking-[0.2em] text-slate-400 font-bold">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-800">{value}</p>
    </div>
  );
}
