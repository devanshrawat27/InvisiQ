/**
 * Visit Reason Suggestions — common visit reasons per queue type.
 * Used for auto-suggest chips on the JoinPage as the user types.
 */

const VISIT_SUGGESTIONS = [
  // Fee related
  'Fee payment before deadline',
  'Fee receipt correction',
  'Fee refund request',
  'Late fee penalty waiver',
  'Hostel fee payment',
  'Exam fee payment',
  'Fee structure enquiry',
  
  // Certificates
  'Bonafide certificate request',
  'Character certificate request',
  'Migration certificate',
  'Transfer certificate',
  'Medical certificate submission',
  
  // Admission
  'New admission enquiry',
  'Admission form submission',
  'Admission fee payment',
  'Course change request',
  'Branch change request',
  
  // Scholarship
  'Scholarship form submission',
  'Scholarship status enquiry',
  'Scholarship document verification',
  
  // Exam related
  'Exam form submission',
  'Exam result query',
  'Re-evaluation request',
  'Backlog exam registration',
  'Exam admit card collection',
  'Exam hall ticket correction',
  
  // General
  'Document verification',
  'ID card collection',
  'Duplicate ID card request',
  'Library clearance',
  'No dues certificate',
  'General enquiry',
  'Complaint registration',
  'Name correction in records',
  'Address change request',
];

/**
 * Filter suggestions based on user input.
 * Returns top 4 matching suggestions.
 */
export function getSuggestions(query) {
  if (!query || query.length < 2) return [];
  
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  
  return VISIT_SUGGESTIONS
    .filter(s => {
      const sl = s.toLowerCase();
      // Match if ANY word from the query appears in the suggestion
      return words.some(w => sl.includes(w));
    })
    .slice(0, 4);
}

/**
 * Document requirements per intent category.
 * Shown on the WaitingRoom after joining, based on the AI-classified intent.
 */
export const INTENT_DOCUMENTS = {
  fee_payment: [
    'Original fee challan / receipt',
    'College ID card',
    'Admission letter',
  ],
  bonafide_cert: [
    'College ID card',
    'Filled application form',
    '1 passport size photo',
  ],
  tc_mc_request: [
    'Original College ID card',
    'No dues certificate',
    'Application written on plain paper',
  ],
  scholarship: [
    'Income certificate',
    'Marksheet of previous year',
    'Bank passbook copy',
    'Caste certificate (if applicable)',
  ],
  admission: [
    '10th and 12th marksheet',
    'Transfer certificate',
    '4 passport size photos',
    'Aadhar card',
  ],
  exam_query: [
    'College ID card',
    'Exam admit card',
  ],
  general: [
    'College ID card',
  ],
  // Fallbacks / aliases
  certificate: [
    'College ID card',
    'Filled application form',
    '1 passport size photo',
  ],
  document_verification: [
    'Original documents for verification',
    'College ID card',
    'Photocopies of all documents',
  ],
};

/**
 * Queue-level common document packs.
 * These are shown before join so students know what to bring or upload.
 */
export const QUEUE_DOCUMENT_PACKS = {
  fee_cell: [
    'Original fee challan / receipt',
    'College ID card',
    'Admission letter',
  ],
  admission_cell: [
    '10th and 12th marksheet',
    'Transfer certificate',
    '4 passport size photos',
    'Aadhar card',
  ],
  admin_cell: [
    'College ID card',
    'Application form',
    'Supporting documents related to your request',
  ],
  exam_cell: [
    'College ID card',
    'Exam admit card',
    'Previous marksheet if required',
  ],
  registration_cell: [
    'College ID card',
    'Admission proof',
    'Recent passport-size photo',
  ],
  general: [
    'College ID card',
  ],
};

/**
 * Get a queue-specific common document list.
 */
export function getCommonDocumentsForQueue(queueId) {
  if (!queueId) return QUEUE_DOCUMENT_PACKS.general;
  const key = queueId.toLowerCase().replace(/\s+/g, '_');
  return QUEUE_DOCUMENT_PACKS[key] || QUEUE_DOCUMENT_PACKS.general;
}

/**
 * Get document list for a given intent category.
 * Falls back to 'general' if category not found.
 */
export function getDocumentsForIntent(intentCategory) {
  if (!intentCategory) return INTENT_DOCUMENTS.general;
  const key = intentCategory.toLowerCase().replace(/\s+/g, '_');
  return INTENT_DOCUMENTS[key] || INTENT_DOCUMENTS.general;
}

/**
 * Keyword map: maps keywords in user's typed reason → intent category key.
 */
const REASON_KEYWORD_MAP = [
  { keywords: ['fee', 'challan', 'payment', 'receipt', 'refund', 'penalty', 'hostel fee', 'exam fee'], intent: 'fee_payment' },
  { keywords: ['bonafide', 'bona fide'], intent: 'bonafide_cert' },
  { keywords: ['transfer certificate', 'tc', 'migration', 'leaving'], intent: 'tc_mc_request' },
  { keywords: ['scholarship', 'stipend', 'freeship'], intent: 'scholarship' },
  { keywords: ['admission', 'new admission', 'enroll', 'registration', 'branch change', 'course change'], intent: 'admission' },
  { keywords: ['exam', 'result', 'revaluation', 're-evaluation', 'backlog', 'admit card', 'hall ticket'], intent: 'exam_query' },
  { keywords: ['certificate', 'character certificate'], intent: 'certificate' },
  { keywords: ['verification', 'document verification', 'verify'], intent: 'document_verification' },
  { keywords: ['no dues', 'clearance', 'library'], intent: 'tc_mc_request' },
  { keywords: ['id card', 'identity card', 'duplicate id'], intent: 'general' },
];

/**
 * Detect the intent category from a user's free-text visit reason.
 * Returns the matched intent key or null if no match.
 */
export function detectIntentFromReason(reason) {
  if (!reason || reason.length < 3) return null;
  const lower = reason.toLowerCase();
  for (const { keywords, intent } of REASON_KEYWORD_MAP) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return intent;
    }
  }
  return null;
}

/**
 * Get relevant documents based on the user's typed visit reason.
 * Returns { intent, documents } or null if no match.
 */
export function getDocumentsForReason(reason) {
  const intent = detectIntentFromReason(reason);
  if (!intent) return null;
  const documents = INTENT_DOCUMENTS[intent] || INTENT_DOCUMENTS.general;
  return { intent, documents };
}
