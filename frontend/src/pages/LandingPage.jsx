import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getQueueStatus, listQueues } from '../utils/api';
import QRModal from '../components/QRModal';
import { 
  CreditCard, 
  GraduationCap, 
  FileText, 
  ClipboardList, 
  ShieldAlert, 
  Building2, 
  Users, 
  Clock, 
  QrCode, 
  ArrowRight, 
  Play, 
  ExternalLink,
  ChevronRight,
  Sparkles,
  Layers,
  Compass
} from 'lucide-react';

export default function LandingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Core Data States
  const [queues, setQueues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeQRQueue, setActiveQRQueue] = useState(null);
  const [showHowItWorks, setShowHowItWorks] = useState(true);

  // College-wide stats
  const [stats, setStats] = useState({ activeCells: 0, totalWaiting: 0, avgWait: 0 });

  // Check if a specific queue was targeted via query parameter (e.g. ?q=fee_cell)
  const queryQueueId = searchParams.get('q');

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const listData = await listQueues();
        const activeQueuesList = listData.queues || [];

        const detailed = await Promise.all(
          activeQueuesList.map(async (q) => {
            try {
              const status = await getQueueStatus(q.id);
              return { ...q, ...status };
            } catch {
              return { ...q, count: 0, avg_wait: 0, surge_active: false };
            }
          })
        );

        setQueues(detailed);

        // Stats calculation
        const activeCells = detailed.filter(q => q.status === 'open').length;
        const totalWaiting = detailed.reduce((acc, q) => acc + (q.count || 0), 0);
        const avgWait = detailed.length
          ? Math.round(detailed.reduce((acc, q) => acc + (q.avg_wait || 0), 0) / detailed.length)
          : 0;

        setStats({ activeCells, totalWaiting, avgWait });
      } catch (err) {
        setError(err.message || 'Failed to connect to servers');
      } finally {
        setLoading(false);
      }
    }

    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  // Helper to resolve department icons
  const getCellIcon = (id, className = "w-5 h-5") => {
    switch (id) {
      case 'fee_cell': return <CreditCard className={className} />;
      case 'admission_cell': return <GraduationCap className={className} />;
      case 'exam_cell': return <FileText className={className} />;
      case 'registration_cell': return <ClipboardList className={className} />;
      case 'admin_cell': return <ShieldAlert className={className} />;
      default: return <Building2 className={className} />;
    }
  };

  // One calm theme for every department (single consistent look).
  const getCellTheme = () => ({
    gradient: 'from-indigo-500/10 to-teal-500/5',
    borderHover: 'hover:border-teal-300 hover:shadow-teal-500/10',
    iconBg: 'bg-teal-50 text-teal-700',
    btnBg: 'bg-teal-600 hover:bg-teal-700 hover:shadow-teal-500/20',
    textAccent: 'text-teal-700',
    ringColor: 'ring-teal-500/30',
  });

  // Scroll to queues section
  const handleScrollToQueues = () => {
    const el = document.getElementById('campus-service-desks');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Animated counters
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

  const animWaiting = useAnimatedCount(stats.totalWaiting);
  const animWaitTime = useAnimatedCount(stats.avgWait);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F1F2F4] p-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <div className="inline-block relative w-12 h-12 mb-2">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-600/10" />
            <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
          </div>
          <p className="text-slate-500 font-bold text-sm animate-pulse">Loading Smart Campus Hub...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="card w-full max-w-sm text-center animate-fade-in-scale">
          <span className="text-5xl block mb-4">⚠️</span>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Connection Error</h2>
          <p className="text-sm text-slate-500 mb-6">{error}</p>
          <button onClick={() => window.location.reload()} className="btn-primary w-full py-3">Try Again</button>
        </div>
      </div>
    );
  }

  // ─── Direct specific queue landing state (Single Queue Mode) ───────────────────
  if (queryQueueId) {
    const singleQueue = queues.find(q => q.id === queryQueueId) || {
      id: queryQueueId,
      name: queryQueueId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      status: 'open',
      count: 0,
      avg_wait: 0
    };

    const isOpen = singleQueue.status === 'open';
    const isPaused = singleQueue.status === 'paused';
    const theme = getCellTheme(singleQueue.id);

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F8FAFC] relative overflow-hidden" id="landing-page">
        {/* Soft ambient blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[10%] left-[10%] w-72 h-72 rounded-full bg-indigo-600/5 blur-3xl animate-breathe" />
          <div className="absolute bottom-[15%] right-[5%] w-96 h-96 rounded-full bg-teal-500/5 blur-3xl animate-breathe" style={{ animationDelay: '2s' }} />
        </div>

        <div className="w-full max-w-sm space-y-6 relative z-10">
          <button onClick={() => navigate('/')} className="btn-ghost flex items-center gap-1.5 self-start text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            ← College Hub
          </button>

          {/* Header */}
          <div className="text-center space-y-4 animate-fade-in-up">
            <div className="inline-flex items-center gap-3 mb-2 justify-center">
              <div className={`w-12 h-12 rounded-2xl ${theme.iconBg} flex items-center justify-center border border-slate-100 shadow-md`}>
                {getCellIcon(singleQueue.id, "w-6 h-6")}
              </div>
              <div className="text-left">
                <p className="font-bold text-slate-800 tracking-wide text-sm leading-tight">Academic Curator</p>
                <p className="text-[10px] text-slate-400 tracking-widest uppercase font-bold">Smart Queue System</p>
              </div>
            </div>

            <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">{singleQueue.name}</h1>

            <div className="flex items-center justify-center gap-3">
              <span className="pill bg-slate-100 text-slate-600">{singleQueue.type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'General'}</span>
              <span className={`pill flex items-center gap-1.5 ${isOpen ? 'bg-teal-50 text-teal-600 border border-teal-100' : isPaused ? 'bg-amber-50 text-amber-600 border border-amber-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                {isOpen && <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-500 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500" /></span>}
                {isOpen ? 'Open' : isPaused ? 'Paused' : 'Closed'}
              </span>
            </div>
          </div>

          {/* Stats */}
          <div className="card animate-fade-in-up stagger-2 bg-white rounded-3xl p-6 border border-slate-100 shadow-[0_12px_40px_rgba(0,0,0,0.02)]">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center py-3 rounded-2xl bg-slate-50/80">
                <p className="text-3xl font-black text-slate-800">{singleQueue.count || 0}</p>
                <p className="text-[9px] text-slate-400 uppercase tracking-wider mt-1 font-bold">In Queue</p>
              </div>
              <div className="text-center py-3 rounded-2xl bg-slate-50/80">
                <p className={`text-3xl font-black ${theme.textAccent}`}>{singleQueue.avg_wait || 0}<span className="text-sm text-slate-400 font-medium ml-0.5">m</span></p>
                <p className="text-[9px] text-slate-400 uppercase tracking-wider mt-1 font-bold">Avg Wait</p>
              </div>
              <div className="text-center py-3 rounded-2xl bg-slate-50/80">
                <p className="text-3xl font-black text-slate-800">{singleQueue.counters_open ?? 1}</p>
                <p className="text-[9px] text-slate-400 uppercase tracking-wider mt-1 font-bold">Counters</p>
              </div>
            </div>
          </div>

          {/* Surge */}
          {singleQueue.surge_active && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-amber-50 border border-amber-100 animate-fade-in-up">
              <span className="text-lg animate-pulse">⚡</span>
              <span className="text-sm font-semibold text-amber-700">High traffic — longer wait expected</span>
            </div>
          )}

          {/* CTA */}
          <div className="space-y-3 animate-fade-in-up stagger-3">
            <button 
              onClick={() => navigate(`/queue/${singleQueue.id}/join`)} 
              disabled={!isOpen} 
              className={`w-full py-4 text-sm font-bold tracking-wide rounded-2xl transition-all duration-300 flex items-center justify-center gap-2 shadow-lg active:scale-98 ${
                isOpen 
                  ? `${theme.btnBg} text-white` 
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200/50'
              }`}
              id="join-queue-btn"
            >
              <span>Join Queue</span> 
              <ArrowRight className="w-4 h-4" />
            </button>
            {!isOpen && (
              <p className="text-center text-sm text-slate-500">
                {isPaused ? 'Queue is temporarily paused.' : 'Queue is closed. Come back later.'}
              </p>
            )}
          </div>

          <p className="text-center text-[10px] text-slate-400 mt-6 font-bold tracking-widest uppercase">
            Powered by AI · No more standing in line
          </p>
        </div>
      </div>
    );
  }

  // ─── General College Hub Landing State (Matches Figma/Mockup Design) ───────────
  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col relative overflow-hidden" id="college-hub-landing">
      
      {/* Top half container matching the 3D illustration background color (#F1F2F4) */}
      <div className="bg-[#F4F6FB] w-full relative overflow-hidden">
        <div className="absolute inset-0 bg-mesh opacity-80 pointer-events-none" />
        {/* Navigation Header */}
        <nav className="sticky top-0 z-40 w-full glass border-b border-white/40">
          <div className="w-full max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-teal-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Layers className="text-white w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display font-black text-xl tracking-tight text-slate-800 leading-none">InvisiQ</h1>
              <p className="text-[9px] uppercase tracking-widest text-slate-400 font-bold mt-1">Smart Campus Curator</p>
            </div>
          </div>

          <button
            onClick={() => navigate('/admin')}
            className="btn-outline text-xs py-2.5 px-5"
          >
            <span>Admin Portal</span>
            <ShieldAlert className="w-3.5 h-3.5 text-indigo-600" />
          </button>
          </div>
        </nav>

        {/* Hero Container Section */}
        <header className="relative z-10 w-full max-w-7xl mx-auto px-8 pt-6 pb-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Info Column */}
          <div className="lg:col-span-6 space-y-8 text-left animate-fade-in-up">
            <div className="glint-border inline-flex items-center gap-2 px-4 py-2 text-[11px] font-bold tracking-wide text-brand-ink">
              <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
              <span>Real-time campus queueing</span>
            </div>

            <h2 className="text-4xl md:text-5xl lg:text-[56px] font-black tracking-tight text-slate-900 leading-[1.08]">
              Queue up <span className="highlight-cream">without standing</span> <br />in line
            </h2>

            <p className="text-sm md:text-[15px] text-slate-500 max-w-xl leading-relaxed">
              InvisiQ brings real-time, AI-assisted queueing to your campus desks. Join instantly via a QR code, watch your position from anywhere, and walk to the counter only when it’s your turn.
            </p>

            {/* Action CTAs — clear Student vs Admin paths */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                onClick={handleScrollToQueues}
                className="btn-solid text-sm py-3.5"
                id="student-cta"
              >
                <GraduationCap className="w-4 h-4" />
                <span>I’m a Student</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => navigate('/admin')}
                className="btn-solid-outline text-sm py-3.5"
                id="admin-cta"
              >
                <ShieldAlert className="w-4 h-4 text-brand" />
                <span>I’m an Admin</span>
              </button>

              <button
                onClick={() => setShowHowItWorks(!showHowItWorks)}
                className="text-slate-500 hover:text-slate-900 font-semibold text-xs py-3.5 px-2 flex items-center justify-center gap-2 transition-colors"
              >
                <Play className="w-3.5 h-3.5 text-slate-400 fill-slate-400" />
                <span>{showHowItWorks ? 'Hide steps' : 'How it works'}</span>
              </button>
            </div>

            {/* Stats Bar */}
            <div className="rounded-3xl border border-brand-ink/10 bg-white/70 backdrop-blur-md p-5 shadow-premium max-w-xl grid grid-cols-3 gap-6 divide-x divide-slate-100">
              <div className="flex items-center gap-3.5 pl-2">
                <div className="w-11 h-11 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-sm shadow-indigo-500/10">
                  <Compass className="w-5 h-5" style={{ animation: 'spin 8s linear infinite' }} />
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-800 leading-none">{stats.activeCells}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mt-1.5 leading-none tracking-wider">Active Cells</p>
                </div>
              </div>
              <div className="flex items-center gap-3.5 pl-6">
                <div className="w-11 h-11 rounded-2xl bg-teal-50 flex items-center justify-center text-teal-500 shadow-sm shadow-teal-500/10">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-800 leading-none">{animWaiting}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mt-1.5 leading-none tracking-wider">Waiting Users</p>
                </div>
              </div>
              <div className="flex items-center gap-3.5 pl-6">
                <div className="w-11 h-11 rounded-2xl bg-teal-50 flex items-center justify-center text-teal-700 shadow-sm shadow-teal-500/10">
                  <Clock className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-800 leading-none">{animWaitTime}<span className="text-sm font-medium">m</span></p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mt-1.5 leading-none tracking-wider">Avg Wait</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right 3D Visualizer Column (Borderless, completely integrated background) */}
          <div className="lg:col-span-6 flex justify-center animate-fade-in-scale">
            <div className="relative w-full max-w-lg aspect-square flex items-center justify-center">
              <img 
                src="/landing_hero_3d.png" 
                alt="InvisiQ 3D Campus Virtual Queue"
                className="w-full h-auto object-contain z-10 animate-bounce-soft"
                style={{ animationDuration: '6s' }}
              />
            </div>
          </div>
        </header>

        {/* Bottom smooth fade transition from #F1F2F4 to page background (#F8FAFC) */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-b from-transparent to-[#F8FAFC]" />
      </div>

      {/* How it Works Expanded Alert */}
      {showHowItWorks && (
        <div className="w-full max-w-7xl mx-auto px-8 mb-12 mt-6 animate-slide-up relative z-10">
          <div className="rounded-3xl p-8 grid grid-cols-1 md:grid-cols-3 gap-8 border border-slate-200/70 bg-white/80 backdrop-blur-md shadow-premium relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/70 via-transparent to-teal-50/70 pointer-events-none" />
            <div className="space-y-4 relative z-10">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <QrCode className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-lg tracking-tight text-slate-900">1. Choose a service desk</h4>
              <p className="text-sm text-slate-500 leading-relaxed">Pick the department you need — fee, admission, exam and more. See the live queue length and estimated wait before you commit.</p>
            </div>
            <div className="space-y-4 relative z-10">
              <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center">
                <Layers className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-lg tracking-tight text-slate-900">2. Join &amp; get a token</h4>
              <p className="text-sm text-slate-500 leading-relaxed">Enter your name, phone and reason. We instantly give you a token — no app, no waiting in line.</p>
            </div>
            <div className="space-y-4 relative z-10">
              <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center">
                <Sparkles className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-lg tracking-tight text-slate-900">3. Track &amp; get called</h4>
              <p className="text-sm text-slate-500 leading-relaxed">Follow your live position anywhere. Get a notification and voice alert the moment it’s your turn.</p>
            </div>
          </div>
        </div>
      )}

      {/* Main Grid Section */}
      <main className="relative z-10 w-full max-w-7xl mx-auto px-8 pb-24 mt-8" id="campus-service-desks">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 border-b border-slate-100 pb-5">
          <div>
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Campus <span className="highlight">service desks</span></h3>
            <p className="text-xs md:text-sm text-slate-400 mt-1 font-medium">Pick a department below — see the live wait and join in one tap</p>
          </div>
          <span className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-widest mt-3 md:mt-0 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500" />
            </span>
            Auto-refreshing every 30s
          </span>
        </div>

        {/* Queues Cards Grid */}
        {queues.length === 0 ? (
          <div className="card text-center py-16 max-w-lg mx-auto">
            <span className="text-5xl block mb-4">🏫</span>
            <h4 className="text-lg font-bold text-slate-800 mb-2">No service desks are open yet</h4>
            <p className="text-sm text-slate-500">
              An administrator needs to set up a queue first. If you’re an admin, open the admin portal to create one.
            </p>
            <button onClick={() => navigate('/admin')} className="btn-primary mt-6">Open Admin Portal</button>
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {queues.map((q) => {
            const isOpen = q.status === 'open';
            const isPaused = q.status === 'paused';
            const theme = getCellTheme(q.id);

            return (
              <motion.div
                key={q.id}
                initial={{ opacity: 0, y: 26 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                whileHover={{ y: -6 }}
                className={`group rounded-[26px] p-6 bg-white/75 backdrop-blur-md border border-brand-ink/10 hover:border-brand-ink/25 shadow-premium transition-colors duration-300 flex flex-col justify-between relative overflow-hidden`}
              >
                {/* Accent line on top */}
                <div className="absolute top-0 left-6 right-6 h-[3px] bg-gradient-to-r from-indigo-500 to-teal-500 rounded-b-full opacity-60" />

                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between mb-5 mt-1">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-2xl ${theme.iconBg} flex items-center justify-center border border-slate-100 shadow-sm transition-transform duration-300 group-hover:scale-110`}>
                        {getCellIcon(q.id, "w-5 h-5")}
                      </div>
                      <div>
                        <h4 className="text-[14px] font-black text-slate-800 leading-tight tracking-tight">{q.name}</h4>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">{q.id.replace(/_/g, ' ')}</p>
                      </div>
                    </div>

                    <span className={`flex items-center gap-1.5 text-[9px] font-extrabold px-2.5 py-1 rounded-full border shadow-sm ${
                      isOpen ? 'bg-teal-50 text-teal-600 border-teal-100' : 
                      isPaused ? 'bg-amber-50 text-amber-600 border-amber-100' : 
                      'bg-red-50 text-red-600 border-red-100'
                    }`}>
                      {isOpen && <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-teal-500" /></span>}
                      {isOpen ? 'Open' : isPaused ? 'Paused' : 'Closed'}
                    </span>
                  </div>

                  {/* Metrics Table Slots */}
                  <div className="grid grid-cols-2 gap-3 mb-6 text-center">
                    <div className="bg-slate-50/55 hover:bg-slate-50 rounded-2xl py-3 border border-slate-100 transition-colors duration-200">
                      <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Waiting</p>
                      <p className="text-xl font-black text-slate-800 mt-0.5">{q.count || 0}</p>
                    </div>
                    <div className="bg-slate-50/55 hover:bg-slate-50 rounded-2xl py-3 border border-slate-100 transition-colors duration-200">
                      <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Est. Wait</p>
                      <p className={`text-xl font-black ${theme.textAccent} mt-0.5`}>{q.avg_wait || 0}<span className="text-xs font-semibold ml-0.5">m</span></p>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="space-y-2">
                  <button 
                    onClick={() => navigate(`/queue/${q.id}/join`)}
                    disabled={!isOpen}
                    className={`w-full py-3 text-[12px] ${
                      isOpen
                        ? 'btn-solid'
                        : 'rounded-[0_14px_0_14px] bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200/60 font-bold tracking-wide'
                    }`}
                  >
                    <span>{isOpen ? 'Join queue' : 'Unavailable'}</span>
                    {isOpen && <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />}
                  </button>

                  <button 
                    onClick={() => setActiveQRQueue(q)}
                    className="w-full py-2.5 rounded-[14px_0_14px_0] text-slate-500 hover:text-slate-800 hover:bg-white/70 font-bold text-[11px] tracking-wide transition-all duration-200 flex items-center justify-center gap-1.5 border border-slate-200/60"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Show QR code</span>
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
        )}
      </main>

      {/* QR Code Modal rendering */}
      {activeQRQueue && (
        <QRModal 
          queueId={activeQRQueue.id}
          queueName={activeQRQueue.name}
          onClose={() => setActiveQRQueue(null)}
        />
      )}
    </div>
  );
}
