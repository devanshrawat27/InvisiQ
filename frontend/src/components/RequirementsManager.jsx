import { useState, useEffect, useCallback } from 'react';
import { getRequirements, saveRequirements } from '../utils/api';

/**
 * RequirementsManager — admin component to add/edit/remove document requirements.
 * Text-only: just document names, no photo uploads.
 * Dark mode themed for the admin dashboard.
 */
export default function RequirementsManager({ queueId, idToken, onClose }) {
  const [requirements, setRequirements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  // Fetch existing requirements
  useEffect(() => {
    if (!queueId) return;
    setLoading(true);
    getRequirements(queueId)
      .then(data => setRequirements(data.requirements || []))
      .catch(() => setRequirements([]))
      .finally(() => setLoading(false));
  }, [queueId]);

  // Add new empty requirement
  const handleAdd = useCallback(() => {
    setRequirements(prev => [...prev, { name: '', photo_url: null }]);
    setSaved(false);
  }, []);

  // Update requirement name
  const handleNameChange = useCallback((idx, value) => {
    setRequirements(prev => prev.map((r, i) => i === idx ? { ...r, name: value } : r));
    setSaved(false);
  }, []);

  // Remove requirement
  const handleRemove = useCallback((idx) => {
    setRequirements(prev => prev.filter((_, i) => i !== idx));
    setSaved(false);
  }, []);

  // Save all requirements
  const handleSave = useCallback(async () => {
    // Filter out empty names
    const valid = requirements.filter(r => r.name.trim().length > 0);
    if (valid.length === 0 && requirements.length > 0) {
      setError('Add at least one document name');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await saveRequirements(queueId, valid, idToken);
      setRequirements(valid);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Save error:', err);
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [requirements, queueId, idToken]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" 
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-lg rounded-3xl animate-scale-in overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(28,30,42,0.97), rgba(15,17,23,0.97))',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}>

        {/* Header */}
        <div className="px-7 py-6 flex items-center justify-between"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(245, 158, 11, 0.1)' }}>
              <span className="text-lg">📋</span>
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-white">Document Requirements</h2>
              <p className="text-xs text-on-surface-dark-variant">What students need to bring</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-on-surface-dark-variant hover:text-white hover:bg-white/10 transition-all">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-7 py-5 max-h-[60vh] overflow-y-auto space-y-3 scrollbar-thin">
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="h-14 rounded-xl animate-shimmer"
                  style={{
                    background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 20%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0.04) 100%)',
                    backgroundSize: '200% 100%',
                  }} />
              ))}
            </div>
          ) : (
            <>
              {requirements.map((req, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3.5 rounded-xl transition-all duration-200 animate-fade-in-up group"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>

                  {/* Document icon */}
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(26, 125, 185, 0.1)' }}>
                    <svg className="w-5 h-5 text-primary/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>

                  {/* Name input */}
                  <input
                    type="text"
                    value={req.name}
                    onChange={(e) => handleNameChange(idx, e.target.value)}
                    placeholder="e.g. Fee Receipt, College ID, Marksheet..."
                    className="flex-1 text-sm text-white placeholder-white/20 bg-transparent outline-none font-medium"
                    maxLength={100}
                  />

                  {/* Remove button */}
                  <button
                    onClick={() => handleRemove(idx)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-on-surface-dark-variant hover:text-red-400 hover:bg-red-400/10 transition-all flex-shrink-0 opacity-0 group-hover:opacity-100"
                    title="Remove">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}

              {/* Add button */}
              <button
                onClick={handleAdd}
                className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 text-on-surface-dark-variant hover:text-primary hover:bg-primary/5"
                style={{ border: '1px dashed rgba(255,255,255,0.1)' }}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                Add Document
              </button>

              {requirements.length === 0 && (
                <div className="text-center py-8">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
                    style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <span className="text-2xl">📄</span>
                  </div>
                  <p className="text-sm text-on-surface-dark-variant font-medium">No documents required yet</p>
                  <p className="text-xs text-on-surface-dark-variant/60 mt-1">Add documents students should bring</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-7 mb-3 px-4 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 animate-flash-in"
            style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}>
            <span>⚠️</span>
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="px-7 py-5 flex items-center justify-between gap-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-[10px] text-on-surface-dark-variant">
            {requirements.filter(r => r.name.trim()).length} document{requirements.filter(r => r.name.trim()).length !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="text-sm py-2.5 px-5 rounded-xl font-medium text-on-surface-dark-variant hover:text-white transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary text-sm py-2.5 px-6 flex items-center gap-2">
              {saving ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </>
              ) : saved ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                  </svg>
                  Saved!
                </>
              ) : (
                'Save Requirements'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
