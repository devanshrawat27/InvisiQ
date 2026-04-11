/**
 * Urgency Engine — Dynamic Queue Re-Ordering
 * ---------------------------------------------
 * Re-scores all waiting users every 60s and re-orders queue based on urgency.
 *
 * Formula:
 *   urgency_score = (deadline_gap_minutes < 30 ? 40 : 0)
 *                 + (wait_exceeded_percent × 0.2)
 *                 + (declared_emergency ? 40 : 0)
 *                 + (distance_km > 50 ? 10 : 0)
 *
 * AI Usage: NONE — Rule-based scoring engine.
 */

const { db } = require('../firebase/init');
const calendar = require('../data/college_calendar.json');

/**
 * Check if today has a fee deadline.
 * @returns {boolean}
 */
function isFeeDeadlineToday() {
  const today = new Date().toISOString().slice(0, 10);
  return (calendar.fee_deadlines || []).includes(today);
}

/**
 * Get minutes until closest fee deadline today.
 * Returns Infinity if no deadline today.
 */
function minutesToDeadline() {
  if (!isFeeDeadlineToday()) return Infinity;

  // Assume 5pm deadline as per handoff
  const now = new Date();
  const deadline = new Date();
  deadline.setHours(17, 0, 0, 0);

  return Math.max(0, (deadline - now) / (1000 * 60));
}

/**
 * Run Urgency Engine on all waiting users in a queue.
 * @param {string} queueId
 * @param {object} io — Socket.io server instance
 * @returns {object} { rescored, reordered, alerts[] }
 */
async function runUrgencyEngine(queueId, io) {
  const result = { rescored: 0, reordered: false, alerts: [] };

  try {
    const usersRef = db.ref(`queues/${queueId}/users`);
    const snapshot = await usersRef.get();

    if (!snapshot.exists()) return result;

    const users = snapshot.val();
    const now = Date.now();
    const deadlineGapMinutes = minutesToDeadline();

    // Collect all waiting users with their scores
    const waitingUsers = [];

    for (const [userId, user] of Object.entries(users)) {
      if (user.status !== 'waiting') continue;
      result.rescored++;

      const oldPosition = user.position;

      // ── Calculate urgency score ─────────────────────────────────
      const expectedWait = user.wait_predicted || 10;
      const actualWait = (now - (user.join_time || now)) / (1000 * 60);
      const waitExceededPercent = expectedWait > 0
        ? Math.max(0, ((actualWait - expectedWait) / expectedWait) * 100)
        : 0;

      const isEmergency = user.priority === 'emergency' || user.priority === 'elderly';
      const distanceKm = 0; // Default: no GPS data

      // ── Score formula (from handoff doc) ────────────────────────
      const urgencyScore = Math.round(
        (deadlineGapMinutes < 30 ? 40 : 0) +
        (waitExceededPercent * 0.2) +
        (isEmergency ? 40 : 0) +
        (distanceKm > 50 ? 10 : 0)
      );

      // Update score in DB
      await db.ref(`queues/${queueId}/users/${userId}`).update({
        urgency_score: urgencyScore,
      });

      waitingUsers.push({
        userId,
        user,
        urgencyScore,
        oldPosition,
        joinTime: user.join_time || now,
      });
    }

    // ── Sort by urgency score (desc), then by join time (asc) ─────
    waitingUsers.sort((a, b) => {
      if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
      return a.joinTime - b.joinTime; // FIFO for equal urgency
    });

    // ── Assign new positions ──────────────────────────────────────
    for (let i = 0; i < waitingUsers.length; i++) {
      const newPosition = i + 1;
      const { userId, oldPosition, user } = waitingUsers[i];

      await db.ref(`queues/${queueId}/users/${userId}`).update({
        position: newPosition,
      });

      // Flash alert if position improved by 2+
      if (oldPosition && oldPosition - newPosition >= 2) {
        result.reordered = true;
        const alert = {
          userId,
          userName: user.name,
          oldPosition,
          newPosition,
          flash_message: `Good news! Your priority has been updated. You are now #${newPosition} in queue.`,
        };
        result.alerts.push(alert);

        if (io) {
          io.to(`queue_${queueId}`).emit('flash_message', {
            target_user: userId,
            message: alert.flash_message,
            type: 'success',
            duration: 8000,
          });
        }
      }

      // Flash alert when user reaches #3
      if (newPosition <= 3 && oldPosition > 3) {
        if (io) {
          const counterAssigned = user.counter_id || 'counter_1';
          io.to(`queue_${queueId}`).emit('flash_message', {
            target_user: userId,
            message: `You're ${newPosition} spots away — please head to ${counterAssigned.replace('_', ' ')} now.`,
            type: 'info',
            duration: 10000,
          });

          // Emit turn_approaching
          io.to(`queue_${queueId}`).emit('turn_approaching', {
            userId,
            position: newPosition,
            counter: counterAssigned,
          });
        }
      }
    }

    // Emit updated queue to everyone
    if (io && result.reordered) {
      io.to(`queue_${queueId}`).emit('queue_update', {
        action: 'reordered',
        reason: 'urgency_engine',
      });
    }
  } catch (err) {
    console.error('❌ Urgency Engine error:', err.message);
  }

  return result;
}

module.exports = { runUrgencyEngine };
