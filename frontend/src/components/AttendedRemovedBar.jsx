import { useState } from 'react';

/**
 * AttendedRemovedBar — big green/red button pair for admin.
 * Disables immediately on click to prevent double-tap.
 */
export default function AttendedRemovedBar({ user, onAttended, onRemoved, onDone }) {
  const [loading, setLoading] = useState(null); // 'attended' | 'removed' | 'done'

  const handleAttended = async () => {
    setLoading('attended');
    try {
      await onAttended(user.userId);
    } catch {
      setLoading(null); // Re-enable on error
    }
  };

  const handleRemoved = async () => {
    setLoading('removed');
    try {
      await onRemoved(user.userId);
    } catch {
      setLoading(null);
    }
  };

  const handleDone = async () => {
    setLoading('done');
    try {
      await onDone(user.userId);
    } catch {
      setLoading(null);
    }
  };

  const isDisabled = loading !== null;

  return (
    <div className="flex flex-col gap-3" id="attended-removed-bar">
      {user.status === 'in_service' ? (
        <button
          onClick={handleDone}
          disabled={isDisabled}
          className="btn-primary w-full text-base"
        >
          {loading === 'done' ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processing...
            </span>
          ) : '✓ Service Complete'}
        </button>
      ) : (
        <>
          <button
            onClick={handleAttended}
            disabled={isDisabled}
            className="btn-success w-full text-base"
            id="btn-attended"
          >
            {loading === 'attended' ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Processing...
              </span>
            ) : '✓ ATTENDED'}
          </button>
          <button
            onClick={handleRemoved}
            disabled={isDisabled}
            className="btn-danger w-full text-base"
            id="btn-removed"
          >
            {loading === 'removed' ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Processing...
              </span>
            ) : '✕ REMOVED'}
          </button>
        </>
      )}
    </div>
  );
}
