/**
 * Fraud Scanner — Duplicate & Bot Detection
 * -------------------------------------------
 * Blocks proxy joins, duplicate phone numbers, and bot-pattern registrations.
 *
 * Checks:
 *   1. Phone already active in queue? → Duplicate
 *   2. Join timestamp < 2s from page load? → Bot pattern
 *   3. GPS location impossible for campus? → Proxy (future)
 *
 * AI Usage: NONE — Firebase duplicate check + rule-based.
 */

const { db } = require('../firebase/init');
const crypto = require('crypto');

/**
 * Scan a join request for fraud before accepting.
 * @param {string} queueId
 * @param {object} joinData — { phone, join_timestamp, page_load_time, gps_lat, gps_lng, user_agent }
 * @param {object} io — Socket.io server instance
 * @returns {object} { fraud_flag, confidence, reason, details }
 */
async function scanForFraud(queueId, joinData, io) {
  const result = { fraud_flag: false, confidence: 0, reason: '', details: [] };

  try {
    const { phone, join_timestamp, page_load_time, gps_lat, gps_lng, user_agent } = joinData;

    // ── Check 1: Duplicate phone in active queue ─────────────────
    const usersRef = db.ref(`queues/${queueId}/users`);
    const snapshot = await usersRef.get();

    if (snapshot.exists()) {
      const users = snapshot.val();
      for (const [userId, user] of Object.entries(users)) {
        if (
          user.phone === phone &&
          ['waiting', 'called', 'in_service'].includes(user.status)
        ) {
          result.fraud_flag = true;
          result.confidence = 95;
          result.reason = 'duplicate_phone';
          result.details.push(`Phone ${phone.slice(-4)} already active in queue as ${user.name}`);

          // Emit fraud alert to admin
          if (io) {
            io.to(`admin_${queueId}`).emit('fraud_alert', {
              type: 'duplicate_phone',
              phone: phone.slice(-4),
              existing_user: user.name,
              existing_token: user.token,
              confidence: 95,
            });
          }

          console.log(`🚨 Fraud Scanner: Duplicate phone detected — ${phone.slice(-4)}`);
          return result;
        }
      }
    }

    // ── Check 2: Bot-speed join (< 2s from page load) ───────────
    if (join_timestamp && page_load_time) {
      const timeDiff = join_timestamp - page_load_time;
      if (timeDiff < 2000) {
        result.fraud_flag = true;
        result.confidence = 75;
        result.reason = 'bot_pattern';
        result.details.push(`Form submitted in ${timeDiff}ms — likely bot`);

        if (io) {
          io.to(`admin_${queueId}`).emit('fraud_alert', {
            type: 'bot_pattern',
            time_to_fill: timeDiff,
            confidence: 75,
          });
        }

        console.log(`🚨 Fraud Scanner: Bot pattern detected — ${timeDiff}ms fill time`);
        return result;
      }
    }

    // ── Check 3: Cross-queue duplicate (same phone in diff queue) ─
    // Check if phone is active in ANY queue (broader fraud check)
    const allQueuesSnap = await db.ref('queues').get();
    if (allQueuesSnap.exists()) {
      const allQueues = allQueuesSnap.val();
      for (const [otherQueueId, queueData] of Object.entries(allQueues)) {
        if (otherQueueId === queueId) continue; // Skip current queue
        if (!queueData.users) continue;

        for (const [userId, user] of Object.entries(queueData.users)) {
          if (
            user.phone === phone &&
            ['waiting', 'called'].includes(user.status)
          ) {
            result.details.push(`Phone also active in queue: ${otherQueueId}`);
            // Not blocking, just flagging for admin awareness
          }
        }
      }
    }

  } catch (err) {
    console.error('❌ Fraud Scanner error:', err.message);
  }

  return result;
}

/**
 * Run periodic fraud re-check on all users in a queue.
 * (Called by monitorLoop every 60s)
 */
async function runFraudScanner(queueId, io) {
  const result = { scanned: 0, flagged: 0, alerts: [] };

  try {
    const usersRef = db.ref(`queues/${queueId}/users`);
    const snapshot = await usersRef.get();

    if (!snapshot.exists()) return result;

    const users = snapshot.val();

    // Check for duplicate phones within the queue
    const phoneMap = {};
    for (const [userId, user] of Object.entries(users)) {
      if (!['waiting', 'called'].includes(user.status)) continue;
      result.scanned++;

      if (phoneMap[user.phone]) {
        result.flagged++;
        result.alerts.push({
          type: 'duplicate_in_queue',
          phone: user.phone.slice(-4),
          users: [phoneMap[user.phone], user.name],
        });

        if (io) {
          io.to(`admin_${queueId}`).emit('fraud_alert', {
            type: 'duplicate_in_queue',
            phone: user.phone.slice(-4),
            users: [phoneMap[user.phone], user.name],
            confidence: 90,
          });
        }
      } else {
        phoneMap[user.phone] = user.name;
      }
    }
  } catch (err) {
    console.error('❌ Fraud Scanner periodic error:', err.message);
  }

  return result;
}

/**
 * Hash a phone number for user_history storage.
 */
function hashPhone(phone) {
  return crypto.createHash('sha256').update(phone).digest('hex');
}

module.exports = { scanForFraud, runFraudScanner, hashPhone };
