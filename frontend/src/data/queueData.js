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
 * Get document list for a given intent category.
 * Falls back to 'general' if category not found.
 */
export function getDocumentsForIntent(intentCategory) {
  if (!intentCategory) return INTENT_DOCUMENTS.general;
  const key = intentCategory.toLowerCase().replace(/\s+/g, '_');
  return INTENT_DOCUMENTS[key] || INTENT_DOCUMENTS.general;
}
