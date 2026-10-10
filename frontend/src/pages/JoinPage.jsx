import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { joinQueue, getRequirements, attachSubmittedDocuments } from '../utils/api';
import { getSuggestions, getDocumentsForReason } from '../data/queueData';
import { uploadRequirementPhoto } from '../firebase/config';

function describeJoinError(err) {
  if (!err.status) return 'Can’t reach the server. Check your internet connection and try again.';
  const msg = err.body?.message;
  switch (err.status) {
    case 400: return msg || 'Please check your details and try again.';
    case 403: return msg || 'This queue isn’t available right now.';
    case 404: return msg || 'This queue doesn’t exist anymore. Please pick another desk.';
    case 429: return 'Too many attempts from this device. Please wait a few minutes and try again.';
    case 503: return msg || 'The queue is very busy right now. Please try again in a few minutes.';
    default: return msg || 'Something went wrong. Please try again.';
  }
}

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
  const [queueRequirements, setQueueRequirements] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const suggestTimer = useRef(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  useEffect(() => {
    let mounted = true;
    getRequirements(queueId)
      .then((data) => {
        if (mounted) setQueueRequirements(data.requirements || []);
      })
      .catch(() => {
        if (mounted) setQueueRequirements([]);
      });

    return () => { mounted = false; };
  }, [queueId]);

  // Smart document detection based on typed reason
  const reasonDocuments = useMemo(() => {
    return getDocumentsForReason(form.visit_reason);
  }, [form.visit_reason]);

  const showDocSection = form.visit_reason.length >= 5 && reasonDocuments !== null;

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
      const resp = await joinQueue(queueId, { ...form, form_fill_ms: Date.now() - pageLoadTime.current });
      sessionStorage.setItem('myQueueData', JSON.stringify({ ...resp, name: form.name, queue_id: queueId, visit_reason: form.visit_reason }));
      navigate(`/queue/${queueId}/wait`);

      const filesToUpload = [...selectedFiles];
      if (filesToUpload.length > 0 && resp?.userId) {
        void (async () => {
          try {
            const submittedDocuments = await Promise.all(
              filesToUpload.map(async (file) => ({
                name: file.name,
                url: await uploadRequirementPhoto(queueId, file.name, file),
                mime_type: file.type || null,
                size: file.size || null,
              }))
            );

            await attachSubmittedDocuments(queueId, resp.userId, submittedDocuments);
          } catch (uploadErr) {
            console.error('Background document upload failed:', uploadErr);
          }
        })();
      }
    } catch (err) {
      setApiError(describeJoinError(err));
      setSubmitting(false);
    }
  }

  const filled = [form.name.length >= 2, form.phone.length === 10, form.visit_reason.length >= 5].filter(Boolean).length;

  // Intent label for the doc section header
  const intentLabel = reasonDocuments?.intent?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || '';

  return (
    <div className="min-h-screen relative overflow-hidden bg-surface" id="join-page">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[6%] left-[6%] w-80 h-80 rounded-full bg-primary/5 blur-3xl animate-breathe" />
        <div className="absolute bottom-[8%] right-[8%] w-[28rem] h-[28rem] rounded-full bg-accent/5 blur-3xl animate-breathe" style={{ animationDelay: '1.8s' }} />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-10">
        <button onClick={() => navigate(-1)} className="mb-6 flex items-center gap-1.5 text-sm text-on-surface-variant transition-colors hover:text-primary group">
          <span className="transition-transform group-hover:-translate-x-1">←</span> Back
        </button>

        <div className="w-full">
          <div className="card mx-auto w-full max-w-none p-6 sm:p-8 lg:p-10">
            <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-card bg-primary flex items-center justify-center shrink-0 shadow-sm"><span className="text-white text-xl">🏛</span></div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-on-surface-variant mb-2">Queue join</p>
                  <h1 className="text-3xl font-extrabold text-on-surface">{queueId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</h1>
                  <p className="text-sm text-on-surface-variant mt-1 max-w-2xl">Fill in your details to join the queue. Tell us your reason and we'll suggest the documents you need.</p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                <span className="rounded-full bg-primary/10 px-3 py-1 font-semibold text-primary">Smart docs</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold">Fast join</span>
              </div>
            </div>

            {/* Step indicator */}
            <div className="grid grid-cols-3 gap-3 mb-8">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-2.5 rounded-full overflow-hidden bg-gray-100">
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

            <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-2 lg:gap-6">
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

              {/* Visit Reason — NOW COMES BEFORE DOCUMENTS */}
              <div className="animate-fade-in-up stagger-3 relative lg:col-span-2">
                <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider flex items-center gap-2 mb-2">
                  <span className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">3</span>Visit Reason
                </label>
                <textarea value={form.visit_reason}
                  onChange={e => handleReasonChange(e.target.value)}
                  onFocus={() => { setFocusedField('reason'); if (suggestions.length) setShowSuggestions(true); }}
                  onBlur={() => handleBlur('visit_reason')}
                  placeholder="Start typing... e.g. fee, certificate, admission"
                  className={`input-field min-h-[120px] resize-none ${errors.visit_reason ? 'error' : ''}`}
                  maxLength={200} rows={4} id="input-reason" />

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

              {/* Smart Document Suggestions — ONLY shows AFTER reason is typed */}
              {showDocSection && (
                <div className="rounded-2xl p-5 bg-gradient-to-br from-primary/[0.04] to-accent/[0.04] border border-primary/15 lg:col-span-2"
                     style={{ animation: 'slideDown 0.4s ease-out' }}>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-sm">📋</span>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-on-surface">
                          Required Documents
                          <span className="ml-2 text-[10px] font-medium normal-case tracking-normal text-primary">for {intentLabel}</span>
                        </p>
                        <p className="text-[11px] text-on-surface-variant mt-0.5">Bring these or upload below for faster verification</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-primary/10 text-primary shrink-0">AI Suggested</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {reasonDocuments.documents.map((doc, idx) => (
                      <span key={`${doc}-${idx}`} className="text-xs px-3 py-2 rounded-full bg-white text-on-surface shadow-sm border border-slate-200/70 flex items-center gap-1.5">
                        <span className="text-primary">•</span>
                        {doc}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Optional document upload — ONLY shows AFTER reason is typed */}
              {form.visit_reason.length >= 5 && (
                <div className="rounded-2xl p-4 bg-white border border-slate-200/70 lg:col-span-2"
                     style={{ animation: 'slideDown 0.35s ease-out' }}>
                  <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant flex items-center justify-between gap-2 mb-2">
                    <span className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center text-[11px]">📎</span>
                      Upload documents now
                    </span>
                    <span className="text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary">Speeds up verification</span>
                  </label>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
                    onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
                    className="block w-full text-sm text-on-surface-variant file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:bg-primary file:text-white file:font-semibold hover:file:opacity-95"
                  />
                  <p className="text-[11px] text-on-surface-variant mt-2">Upload the suggested documents above — fee receipt, marksheet, ID card, admission letter, etc.</p>
                  {selectedFiles.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedFiles.map((file) => (
                        <span key={file.name} className="text-xs px-3 py-2 rounded-full bg-slate-100 text-slate-700 flex items-center gap-1.5">
                          <span className="text-primary">✓</span>
                          {file.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Submit */}
              <div className="animate-fade-in-up stagger-6 pt-2 lg:col-span-2 lg:max-w-md">
                <button type="submit" disabled={submitting} className="btn-accent w-full text-base py-4 group" id="submit-join-btn">
                    {submitting ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        Joining...
                      </span>
                    ) : (
                      <>
                        <span>Join Queue</span>
                        <span className="ml-2 group-hover:translate-x-1 transition-transform">→</span>
                      </>
                    )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Slide-down animation keyframe */}
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-12px); max-height: 0; }
          to   { opacity: 1; transform: translateY(0);     max-height: 500px; }
        }
      `}</style>
    </div>
  );
}
