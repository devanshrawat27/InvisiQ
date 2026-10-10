/**
 * Urgency Engine — dynamic re-ordering (OPT-IN)
 * ---------------------------------------------
 * Re-scores waiting users. Re-ordering only happens when the queue has
 * settings.urgency_enabled === true; otherwise the queue stays fair FIFO with
 * a priority boost handled by queueService. It never removes users.
 */

const { db } = require('../firebase/init');
const queueService = require('../services/queueService');
const { emitToUser } = require('../socket/registry');
const calendar = require('../data/college_calendar.json');

function isFeeDeadlineToday() {
  const today = new Date().toISOString().slice(0, 10);
  return (calendar.fee_deadlines || []).includes(today);
}

function minutesToDeadline() {
  if (!isFeeDeadlineToday()) return Infinity;
  const now = new Date();
  const deadline = new Date();
  deadline.setHours(17, 0, 0, 0);
  return Math.max(0, (deadline - now) / (1000 * 60));
}

async function runUrgencyEngine(queueId, io) {
  const result = { rescored: 0, reordered: false, alerts: [] };

  try {
    const state = await queueService.loadState(queueId);
    if (!state.meta) return result;
    const settings = queueService.getSettings(state.meta);
    const deadlineGap = minutesToDeadline();
    const now = Date.now();

    // Always refresh urgency scores (cheap, advisory)…
    for (const [userId, user] of Object.entries(state.users || {})) {
      if (!user || user.status !== 'waiting') continue;
      result.rescored++;
      const expectedWait = user.wait_predicted || 10;
      const actualWait = (now - (user.join_time || now)) / 60000;
      const waitExceededPercent = expectedWait > 0
        ? Math.max(0, ((actualWait - expectedWait) / expectedWait) * 100) : 0;
      const isEmergency = user.priority === 'emergency' || user.priority === 'elderly';
      const distanceKm = 0;
      const score = Math.round(
        (deadlineGap < 30 ? 40 : 0) +
        (waitExceededPercent * 0.2) +
        (isEmergency ? 40 : 0) +
        (distanceKm > 50 ? 10 : 0)
      );
      if (score !== user.urgency_score) {
        await db.ref(`queues/${queueId}/users/${userId}`).update({ urgency_score: score });
        user.urgency_score = score;
      }
    }

    // …but only re-order when explicitly enabled.
    if (!settings.urgency_enabled) return result;

    const before = {};
    for (const [uid, u] of Object.entries(state.users)) {
      if (u && u.status === 'waiting') before[uid] = u.position || 999;
    }
    const r = await queueService.recomputeQueue(queueId, io, 'reordered');

    for (const u of (r.waiting || [])) {
      const oldPos = before[u.id];
      if (oldPos && oldPos - u.position >= 2 && io) {
        result.reordered = true;
        emitToUser(io, u.id, 'flash_message', {
          target_user: u.id,
          message: `Good news! Your queue position improved. You are now #${u.position}.`,
          type: 'success', duration: 8000,
        });
      }
      if (u.position <= 3 && oldPos > 3 && io) {
        emitToUser(io, u.id, 'turn_approaching', { userId: u.id, position: u.position, counter: u.counter_id || 'counter_1' });
      }
    }
  } catch (err) {
    console.error('❌ Urgency Engine error:', err.message);
  }

  return result;
}

module.exports = { runUrgencyEngine };
