/**
 * Date Helpers — local-timezone date keys
 * ----------------------------------------
 * `Date.toISOString()` is UTC, which shifts "today" for servers east/west of
 * UTC (e.g. IST). Queue analytics must bucket by the office's local day, so
 * every date key is derived from local time instead.
 */

function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateKey(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

module.exports = { dateKey, parseDateKey };
