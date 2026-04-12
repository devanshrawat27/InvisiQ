import { useEffect } from 'react';
import { speakTurn } from '../utils/tts';

/**
 * YourTurnOverlay — full-screen modal when turn_called fires.
 * Premium green glow, pulsing rings, TTS auto-speak.
 */
export default function YourTurnOverlay({ token, counter, onDismiss }) {
  useEffect(() => {
    // Speak the turn notification
    speakTurn(token, counter);
  }, [token, counter]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, rgba(0,0,0,0.7), rgba(6,95,70,0.3))' }}
      id="your-turn-overlay"
    >
      {/* Animated pulsing rings */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="w-80 h-80 rounded-full border-2 border-success/20 animate-ripple" />
        <div className="w-80 h-80 rounded-full border-2 border-success/20 animate-ripple absolute inset-0" style={{ animationDelay: '0.5s' }} />
        <div className="w-80 h-80 rounded-full border-2 border-success/20 animate-ripple absolute inset-0" style={{ animationDelay: '1s' }} />
      </div>

      <div
        className="relative w-full max-w-sm rounded-3xl p-8 text-center animate-scale-in"
        style={{
          background: 'linear-gradient(135deg, rgba(236,253,245,0.95) 0%, rgba(209,250,229,0.95) 50%, rgba(167,243,208,0.95) 100%)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 0 80px rgba(16, 185, 129, 0.3), 0 20px 60px rgba(0, 0, 0, 0.15)',
        }}
      >
        {/* Bell icon with glow */}
        <div className="relative inline-block mb-5">
          <div className="absolute inset-0 bg-success/20 rounded-full blur-xl animate-breathe" />
          <div className="text-6xl relative animate-bounce">🔔</div>
        </div>

        <h1 className="font-display text-3xl font-extrabold text-success-dark mb-4 tracking-tight">
          YOUR TURN!
        </h1>

        <div className="bg-white/70 backdrop-blur-sm rounded-2xl py-4 px-5 mb-3 border border-success/10">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1.5 font-semibold">Token</p>
          <p className="font-mono text-3xl font-bold text-on-surface">{token}</p>
        </div>

        <div className="bg-white/70 backdrop-blur-sm rounded-2xl py-4 px-5 mb-6 border border-success/10">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1.5 font-semibold">Proceed to</p>
          <p className="font-display text-xl font-bold text-primary">
            {counter?.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Counter'}
          </p>
        </div>

        <button
          onClick={onDismiss}
          className="btn-success w-full text-lg py-4 group"
          id="your-turn-dismiss-btn"
        >
          <span>✓ OK, heading there now</span>
          <span className="ml-2 inline-block transition-transform duration-300 group-hover:translate-x-1">→</span>
        </button>
      </div>
    </div>
  );
}
