const LABELS = {
  fee_payment: 'Fee Payment',
  bonafide_cert: 'Bonafide Cert',
  tc_mc_request: 'TC Request',
  scholarship: 'Scholarship',
  admission: 'Admission',
  exam_query: 'Exam Query',
  general: 'General Query',
};

/**
 * IntentBadge — a single calm style for every category (consistent theme).
 */
export default function IntentBadge({ category }) {
  const label = LABELS[category] || LABELS.general;
  return (
    <span
      className="intent-badge"
      style={{ background: '#eef2ff', color: '#1a3c8f', borderColor: 'rgba(26,60,143,0.15)' }}
    >
      {label}
    </span>
  );
}
