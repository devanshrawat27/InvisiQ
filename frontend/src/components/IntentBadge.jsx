const INTENTS = {
  fee_payment: { label: 'Fee Payment', color: '#1a3c8f', bg: '#eef2ff' },
  bonafide_cert: { label: 'Bonafide Cert', color: '#7c3aed', bg: '#f3e8ff' },
  tc_mc_request: { label: 'TC Request', color: '#0891b2', bg: '#ecfeff' },
  scholarship: { label: 'Scholarship', color: '#059669', bg: '#ecfdf5' },
  admission: { label: 'Admission', color: '#d97706', bg: '#fffbeb' },
  exam_query: { label: 'Exam Query', color: '#dc2626', bg: '#fef2f2' },
  general: { label: 'General Query', color: '#64748b', bg: '#f8fafc' },
};

export default function IntentBadge({ category }) {
  const intent = INTENTS[category] || INTENTS.general;
  return (
    <span className="intent-badge" style={{ background: intent.bg, color: intent.color, borderColor: intent.color + '20' }}>
      {intent.label}
    </span>
  );
}
