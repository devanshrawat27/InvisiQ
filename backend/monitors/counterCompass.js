/**
 * Counter Compass — Counter Load Balancer
 * ------------------------------------------
 * When multiple counters are open, assigns each new user
 * to the counter with lowest expected wait.
 *
 * Formula:
 *   expected_wait = (queue_length × avg_service_time)
 *                 + time_remaining_for_current_user
 *
 * Assign to min(expected_wait).
 *
 * AI Usage: NONE — Pure math.
 */

const { db } = require('../firebase/init');

// Default service times (minutes) from handoff doc
const DEFAULT_SERVICE_TIMES = {
  fee_payment: 9,
  bonafide_cert: 3,
  tc_mc_request: 18,
  scholarship: 12,
  admission: 14,
  exam_query: 5,
  general: 7,
};

/**
 * Find the optimal counter for a new user.
 * @param {string} queueId
 * @param {string} serviceType — The intent category of the user
 * @returns {object} { counter_id, counter_label, expected_wait }
 */
async function assignCounter(queueId, serviceType) {
  try {
    const countersRef = db.ref(`queues/${queueId}/counters`);
    const snapshot = await countersRef.get();

    // Default: single counter
    if (!snapshot.exists()) {
      return {
        counter_id: 'counter_1',
        counter_label: 'Counter 1',
        expected_wait: 0,
      };
    }

    const counters = snapshot.val();
    const now = Date.now();

    let bestCounter = null;
    let minWait = Infinity;

    for (const [counterId, counter] of Object.entries(counters)) {
      const queueLength = counter.queue_length || 0;
      const avgServiceTime = DEFAULT_SERVICE_TIMES[serviceType] || 7;

      // Time remaining for current user at this counter
      let timeRemaining = 0;
      if (counter.current_user_id && counter.service_started_at) {
        const serviceStarted = counter.service_started_at;
        const expectedFinish = counter.expected_finish || (serviceStarted + avgServiceTime * 60 * 1000);
        timeRemaining = Math.max(0, (expectedFinish - now) / (1000 * 60));
      }

      // Expected wait = queued users × avg time + current user remaining
      const expectedWait = (queueLength * avgServiceTime) + timeRemaining;

      if (expectedWait < minWait) {
        minWait = expectedWait;
        bestCounter = {
          counter_id: counterId,
          counter_label: counter.label || counterId.replace('_', ' '),
          expected_wait: Math.round(expectedWait),
        };
      }
    }

    if (!bestCounter) {
      return {
        counter_id: 'counter_1',
        counter_label: 'Counter 1',
        expected_wait: 0,
      };
    }

    // Increment queue_length at the assigned counter
    await db.ref(`queues/${queueId}/counters/${bestCounter.counter_id}`).update({
      queue_length: (counters[bestCounter.counter_id].queue_length || 0) + 1,
    });

    return bestCounter;
  } catch (err) {
    console.error('❌ Counter Compass error:', err.message);
    return {
      counter_id: 'counter_1',
      counter_label: 'Counter 1',
      expected_wait: 0,
    };
  }
}

/**
 * Run Counter Compass rebalance across all counters.
 * Called every 60s by monitorLoop.
 */
async function runCounterCompass(queueId, io) {
  const result = { counters_checked: 0, rebalanced: false };

  try {
    const countersRef = db.ref(`queues/${queueId}/counters`);
    const snapshot = await countersRef.get();

    if (!snapshot.exists()) return result;

    const counters = snapshot.val();
    const usersRef = db.ref(`queues/${queueId}/users`);
    const usersSnap = await usersRef.get();
    const users = usersSnap.exists() ? usersSnap.val() : {};

    // Recount actual queue lengths per counter
    for (const counterId of Object.keys(counters)) {
      result.counters_checked++;
      let count = 0;

      for (const [userId, user] of Object.entries(users)) {
        if (user.counter_id === counterId && user.status === 'waiting') {
          count++;
        }
      }

      await db.ref(`queues/${queueId}/counters/${counterId}`).update({
        queue_length: count,
      });
    }
  } catch (err) {
    console.error('❌ Counter Compass rebalance error:', err.message);
  }

  return result;
}

module.exports = { assignCounter, runCounterCompass, DEFAULT_SERVICE_TIMES };
