import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Bell, ArrowRight } from 'lucide-react';
import { speakTurn } from '../utils/tts';

/**
 * YourTurnOverlay — full-screen modal when it's the student's turn.
 * Calm teal theme, pulsing rings, glass card, TTS auto-speak.
 */
export default function YourTurnOverlay({ token, userName, counter, onDismiss }) {
  useEffect(() => {
    speakTurn(token, counter, userName);
  }, [token, counter, userName]);

  const counterLabel = counter?.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase()) || 'Counter';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-md"
      style={{ background: 'radial-gradient(ellipse at center, rgba(15,118,110,0.5), rgba(2,6,23,0.82))' }}
      id="your-turn-overlay"
    >
      {/* Pulsing rings */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
        {[0, 0.6, 1.2].map((d, i) => (
          <span
            key={i}
            className="absolute rounded-full border border-teal-300/30 animate-ping"
            style={{ width: 340, height: 340, marginLeft: -170, marginTop: -170, animationDuration: '2.4s', animationDelay: `${d}s` }}
          />
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm rounded-[28px] p-8 text-center border border-white/60"
        style={{
          background: 'linear-gradient(150deg, rgba(255,255,255,0.96) 0%, rgba(224,242,241,0.95) 55%, rgba(178,236,228,0.92) 100%)',
          boxShadow: '0 0 90px rgba(13,148,136,0.3), 0 30px 70px -20px rgba(2,6,23,0.5)',
        }}
      >
        <div className="relative inline-flex mb-6">
          <div className="absolute inset-0 bg-teal-400/30 rounded-full blur-2xl animate-breathe" />
          <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/40">
            <Bell className="w-10 h-10 text-white" />
          </div>
        </div>

        <h1 className="font-display text-3xl font-black text-teal-700 mb-5 tracking-tight">YOUR TURN</h1>

        <div className="rounded-2xl bg-white/70 backdrop-blur-sm py-4 px-5 mb-3 border border-teal-100 shadow-sm">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-[0.25em] mb-1.5 font-bold">Your token</p>
          <p className="font-mono text-3xl font-bold text-on-surface">{token}</p>
        </div>

        <div className="rounded-2xl bg-white/70 backdrop-blur-sm py-4 px-5 mb-7 border border-teal-100 shadow-sm">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-[0.25em] mb-1.5 font-bold">Proceed to</p>
          <p className="font-display text-xl font-bold text-primary">{counterLabel}</p>
        </div>

        <button
          onClick={onDismiss}
          className="btn-accent w-full text-base py-4 group"
          id="your-turn-dismiss-btn"
        >
          <span>Heading there now</span>
          <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
        </button>
      </motion.div>
    </div>
  );
}
