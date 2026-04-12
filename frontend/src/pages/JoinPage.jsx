import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { joinQueue } from '../utils/api';
import { getSuggestions } from '../data/queueData';

export default function JoinPage() {
  const { id: queueId } = useParams();
  const navigate = useNavigate();
  const nameRef = useRef(null);
  const pageLoadTime = useRef(Date.now());

  const [form, setForm] = useState({ name: '', phone: '', visit_reason: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [focusedField, setFocusedField] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestTimer = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  // Suggestions
  const handleReasonChange = useCallback((value) => {
    setForm(p => ({ ...p, visit_reason: value }));
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (value.length < 2) { setSuggestions([]); setShowSuggestions(false); return; }
    suggestTimer.current = setTimeout(() => {
      const r = getSuggestions(value);
      setSuggestions(r);
      setShowSuggestions(r.length > 0);
    }, 300);
  }, []);

  const pickSuggestion = useCallback((s) => {
    setForm(p => ({ ...p, visit_reason: s }));
    setSuggestions([]); setShowSuggestions(false);
  }, []);

  // Validation
  function validate(field, value) {
    const errs = { ...errors };
    if (field === 'name') { if (!value || value.length < 2) errs.name = 'Name is required'; else delete errs.name; }
    if (field === 'phone') { if (!/^[6-9]\d{9}$/.test(value)) errs.phone = 'Enter a valid 10-digit number'; else delete errs.phone; }
    if (field === 'visit_reason') { if (!value || value.length < 5) errs.visit_reason = 'Tell us why you are visiting'; else delete errs.visit_reason; }
    setErrors(errs);
    return errs;
  }

  function handleBlur(field) {
    validate(field, form[field]);
    setFocusedField(null);
    if (field === 'visit_reason') setTimeout(() => setShowSuggestions(false), 200);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setApiError(null);
    const all = { ...validate('name', form.name), ...validate('phone', form.phone), ...validate('visit_reason', form.visit_reason) };
    if (Object.keys(all).length > 0) { setErrors(all); return; }
    setSubmitting(true);
    try {
      const resp = await joinQueue(queueId, { ...form, page_load_time: Date.now() - pageLoadTime.current });
      sessionStorage.setItem('myQueueData', JSON.stringify({ ...resp, name: form.name, queue_id: queueId }));
      navigate(`/queue/${queueId}/wait`);
    } catch (err) {
      setApiError(err.status === 409 ? 'You are already in this queue.' : err.status === 429 ? 'Too many attempts. Wait a moment.' : err.body?.message || 'Something went wrong.');
      setSubmitting(false);
    }
  }

  const filled = [form.name.length >= 2, form.phone.length === 10, form.visit_reason.length >= 5].filter(Boolean).length;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface" id="join-page">
      <div className="w-full max-w-md animate-fade-in-up">
        {/* Back */}
        <button onClick={() => navigate(-1)} className="text-on-surface-variant text-sm mb-6 flex items-center gap-1.5 hover:text-primary transition-colors group">
          <span className="group-hover:-translate-x-1 transition-transform">←</span> Back
        </button>

        <div className="card">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-card bg-primary flex items-center justify-center"><span className="text-white text-xl">🏛</span></div>
            <div>
              <h1 className="text-xl font-bold text-on-surface">{queueId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</h1>
              <p className="text-sm text-on-surface-variant">Fill in your details to join</p>
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex gap-2 mb-8">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex-1 h-1.5 rounded-full overflow-hidden bg-gray-100">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: i < filled ? '100%' : '0%', background: '#00c896' }} />
              </div>
            ))}
          </div>

          {/* Error */}
          {apiError && (
            <div className="bg-danger-light text-danger text-sm font-medium p-4 rounded-btn mb-5 animate-flash-in flex items-center gap-2">
              <span>⚠️</span>{apiError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div className="animate-fade-in-up stagger-1">
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">1</span>Full Name
              </label>
              <input ref={nameRef} type="text" value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                onFocus={() => setFocusedField('name')} onBlur={() => handleBlur('name')}
                placeholder="Rahul Sharma"
                className={`input-field ${errors.name ? 'error' : ''}`} maxLength={60} id="input-name" />
              {errors.name && <p className="text-xs text-danger mt-1.5 animate-flash-in">• {errors.name}</p>}
            </div>

            {/* Phone */}
            <div className="animate-fade-in-up stagger-2">
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">2</span>Phone
              </label>
              <div className="flex">
                <span className="flex items-center px-4 rounded-l-[12px] text-sm font-semibold text-on-surface-variant bg-surface border-2 border-r-0 border-transparent">+91</span>
                <input type="tel" value={form.phone}
                  onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); setForm(p => ({ ...p, phone: v })); }}
                  onFocus={() => setFocusedField('phone')} onBlur={() => handleBlur('phone')}
                  placeholder="9876543210"
                  className={`input-field rounded-l-none ${errors.phone ? 'error' : ''}`} inputMode="numeric" id="input-phone" />
              </div>
              {errors.phone && <p className="text-xs text-danger mt-1.5 animate-flash-in">• {errors.phone}</p>}
            </div>

            {/* Visit Reason */}
            <div className="animate-fade-in-up stagger-3 relative">
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">3</span>Visit Reason
              </label>
              <textarea value={form.visit_reason}
                onChange={e => handleReasonChange(e.target.value)}
                onFocus={() => { setFocusedField('reason'); if (suggestions.length) setShowSuggestions(true); }}
                onBlur={() => handleBlur('visit_reason')}
                placeholder="Start typing... e.g. fee, certificate, admission"
                className={`input-field min-h-[90px] resize-none ${errors.visit_reason ? 'error' : ''}`}
                maxLength={200} rows={3} id="input-reason" />

              {/* Suggestions */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 animate-fade-in-up">
                  {suggestions.map((s, i) => (
                    <button key={i} type="button" onClick={() => pickSuggestion(s)}
                      className="text-xs py-2 px-3.5 rounded-full font-medium bg-primary/5 text-primary border border-primary/10 hover:bg-primary/10 transition-all active:scale-95">
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex justify-between mt-1.5">
                {errors.visit_reason ? <p className="text-xs text-danger animate-flash-in">• {errors.visit_reason}</p> : <span />}
                <p className={`text-[10px] font-medium ${form.visit_reason.length > 150 ? 'text-warning' : 'text-on-surface-variant'}`}>{form.visit_reason.length}/200</p>
              </div>
            </div>

            {/* Submit */}
            <div className="animate-fade-in-up stagger-4 pt-2">
              <button type="submit" disabled={submitting} className="btn-accent w-full text-base py-4 group" id="submit-join-btn">
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Joining...
                  </span>
                ) : (<><span>Join Queue</span><span className="ml-2 group-hover:translate-x-1 transition-transform">→</span></>)}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
