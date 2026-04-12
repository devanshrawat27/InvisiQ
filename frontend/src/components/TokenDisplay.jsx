import { useState } from 'react';

/**
 * TokenDisplay — large monospaced token with copy animation.
 */
export default function TokenDisplay({ token }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // fallback — select the text
    }
  };

  return (
    <div
      className="card text-center py-5 cursor-pointer transition-all duration-300 hover:shadow-float active:scale-[0.97] group relative overflow-hidden"
      onClick={handleCopy}
      title="Click to copy"
      id="token-display"
    >
      {/* Subtle gradient bg on hover */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/0 to-primary/0 group-hover:from-primary/3 group-hover:to-transparent transition-all duration-500" />

      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-on-surface-variant mb-2 relative">
        Your Token
      </p>
      <p className="font-mono text-2xl font-bold text-on-surface tracking-wider relative">
        {token || '—'}
      </p>
      <p className={`text-xs mt-2.5 relative transition-colors duration-300 font-medium ${
        copied ? 'text-success' : 'text-on-surface-variant'
      }`}>
        {copied ? (
          <span className="flex items-center justify-center gap-1 animate-flash-in">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
            Copied!
          </span>
        ) : 'Tap to copy'}
      </p>
    </div>
  );
}
