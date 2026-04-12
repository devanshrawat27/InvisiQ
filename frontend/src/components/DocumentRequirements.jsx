import { useMemo } from 'react';
import { getDocumentsForIntent } from '../data/queueData';

/**
 * DocumentRequirements — student waiting room card.
 * Shows required documents based on their classified intent category.
 * Pure frontend — no API call needed, uses hardcoded data matched to intent.
 */
export default function DocumentRequirements({ intentCategory }) {
  const documents = useMemo(
    () => getDocumentsForIntent(intentCategory),
    [intentCategory]
  );

  // Don't render if no documents
  if (!documents || documents.length === 0) return null;

  return (
    <div className="card py-5 animate-fade-in-up" id="document-requirements">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(245, 158, 11, 0.1)' }}>
          <span className="text-sm">📄</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-on-surface">Please keep these documents ready</h3>
          <p className="text-[10px] text-on-surface-variant">Based on your visit reason</p>
        </div>
      </div>

      {/* Document list */}
      <div className="space-y-2">
        {documents.map((doc, i) => (
          <div key={i}
            className="flex items-center gap-3 p-3 rounded-xl transition-all duration-200"
            style={{ background: 'rgba(0,0,0,0.02)' }}
          >
            {/* Check icon */}
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(26, 125, 185, 0.06)' }}>
              <svg className="w-4 h-4 text-primary/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>

            {/* Document name */}
            <p className="text-sm font-medium text-on-surface flex-1">{doc}</p>

            {/* Bullet indicator */}
            <div className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: 'rgba(26, 125, 185, 0.3)' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
