/**
 * Counter Compass — counter recommendation
 * -----------------------------------------
 * Given a service type, recommend the counter with the lowest expected wait.
 * Pure advisory: it does NOT mutate state and never assigns an unavailable
 * (in-service) counter. Actual assignment happens when a user is called.
 */

const { db } = require('../firebase/init');

const DEFAULT_SERVICE_TIMES = {
  fee_payment: 9,
  bonafide_cert: 3,
  tc_mc_request: 18,
  scholarship: 12,
  admission: 14,
  exam_query: 5,
  general: 7,
};

function statusOf(counter) {
  if (!counter) return 'idle';
  if (counter.status) return counter.status;
  if (counter.current_user_id) return counter.service_started_at ? 'in_service' : 'serving';
  return 'idle';
}

async function assignCounter(queueId, serviceType) {
  try {
    const [countersSnap, usersSnap] = await Promise.all([
      db.ref(`queues/${queueId}/counters`).get(),
      db.ref(`queues/${queueId}/users`).get(),
    ]);
    if (!countersSnap.exists()) {
      return { counter_id: 'counter_1', counter_label: 'Counter 1', expected_wait: 0 };
    }
    const counters = countersSnap.val();
    const users = usersSnap.exists() ? usersSnap.val() : {};
    const avg = DEFAULT_SERVICE_TIMES[serviceType] || 7;
    const now = Date.now();

    let best = null;
    let minWait = Infinity;
    for (const [counterId, counter] of Object.entries(counters)) {
      const status = statusOf(counter);
      if (status === 'in_service') continue;
      const supported = counter.supported_types || [];
      const compatible = supported.length === 0 || supported.includes(serviceType);
      const queued = Object.values(users).filter(u => u && u.status === 'waiting' && u.counter_id === counterId).length;
      let remaining = 0;
      if (status === 'serving' && counter.service_started_at) {
        const finish = counter.estimated_free_at || (counter.service_started_at + avg * 60000);
        remaining = Math.max(0, (finish - now) / 60000);
      }
      const expected = queued * avg + remaining + (compatible ? 0 : 3);
      if (expected < minWait) {
        minWait = expected;
        best = { counter_id: counterId, counter_label: counter.label || counterId.replace('_', ' '), expected_wait: Math.round(expected) };
      }
    }
    return best || { counter_id: 'counter_1', counter_label: 'Counter 1', expected_wait: 0 };
  } catch (err) {
    console.error('❌ Counter Compass error:', err.message);
    return { counter_id: 'counter_1', counter_label: 'Counter 1', expected_wait: 0 };
  }
}

/**
 * Periodic counter availability snapshot (advisory).
 */
async function runCounterCompass(queueId, io) {
  const result = { counters_checked: 0, idle: 0, busy: 0 };
  try {
    const snap = await db.ref(`queues/${queueId}/counters`).get();
    if (!snap.exists()) return result;
    for (const counter of Object.values(snap.val())) {
      result.counters_checked++;
      if (statusOf(counter) === 'idle') result.idle++;
      else result.busy++;
    }
  } catch (err) {
    console.error('❌ Counter Compass error:', err.message);
  }
  return result;
}

module.exports = { assignCounter, runCounterCompass, DEFAULT_SERVICE_TIMES };
