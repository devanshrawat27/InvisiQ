/**
 * Queue Service — single source of truth
 * ----------------------------------------
 * All queue ordering, position, wait estimation, counter selection and user
 * state transitions live here. Every mutation is serialized per queue via an
 * in-process lock so concurrent joins / admin actions / monitors cannot corrupt
 * state. Positions & waits are computed in exactly ONE place.
 *
 * User state machine:
 *   waiting → called → in_service → served
 *          ↘ removed (no_show / timeout / ghost / cancelled)
 *
 * Counter state machine:
 *   idle → serving (user=called) → in_service → idle
 */

const { db, firestore } = require('../firebase/init');
const { emitToUser } = require('../socket/registry');
const { DEFAULT_SERVICE_TIMES } = require('../monitors/counterCompass');
const { dateKey } = require('../utils/dates');

// ─── Per-queue mutation lock ──────────────────────────────────────────────────
const LOCKS = new Map();
function withQueueLock(queueId, fn) {
  const prev = LOCKS.get(queueId) || Promise.resolve();
  const run = prev.then(() => fn(), () => fn());
  LOCKS.set(queueId, run.then(() => {}, () => {}));
  return run;
}

// ─── Settings (configurable thresholds & automation, all opt-in) ─────────────
function getSettings(meta) {
  const s = (meta && meta.settings) || {};
  return {
    auto_advance: s.auto_advance === true,
    urgency_enabled: s.urgency_enabled === true,
    auto_remove_ghosts: s.auto_remove_ghosts === true,
    auto_pause_on_surge: s.auto_pause_on_surge === true,
    limit_joins_on_surge: s.limit_joins_on_surge === true,
    ghost_grace_minutes: Number.isFinite(s.ghost_grace_minutes) ? s.ghost_grace_minutes : 15,
    surge_multiplier: Number.isFinite(s.surge_multiplier) ? s.surge_multiplier : 2.5,
    max_wait_minutes: Number.isFinite(s.max_wait_minutes) ? s.max_wait_minutes : 45,
  };
}

// ─── Loading ──────────────────────────────────────────────────────────────────
async function loadState(queueId) {
  const [metaSnap, statsSnap, countersSnap, usersSnap] = await Promise.all([
    db.ref(`queues/${queueId}/meta`).get(),
    db.ref(`queues/${queueId}/stats`).get(),
    db.ref(`queues/${queueId}/counters`).get(),
    db.ref(`queues/${queueId}/users`).get(),
  ]);
  return {
    queueId,
    meta: metaSnap.exists() ? metaSnap.val() : null,
    stats: statsSnap.exists() ? statsSnap.val() : {},
    counters: countersSnap.exists() ? countersSnap.val() : {},
    users: usersSnap.exists() ? usersSnap.val() : {},
  };
}

function counterStatus(counter) {
  if (!counter) return 'idle';
  if (counter.status) return counter.status;
  if (counter.current_user_id) {
    return counter.service_started_at ? 'in_service' : 'serving';
  }
  return 'idle';
}

function countersOpen(state) {
  const n = Object.keys(state.counters || {}).length;
  if (n > 0) return n;
  return (state.meta && state.meta.counters_open) || 1;
}

// ─── Estimation (single formula used everywhere) ──────────────────────────────
function estimateWait(peopleAhead, avgServiceTime, openCounters) {
  const c = Math.max(1, openCounters);
  const avg = Number.isFinite(avgServiceTime) && avgServiceTime > 0 ? avgServiceTime : 7;
  return Math.max(0, Math.round((Math.max(0, peopleAhead) * avg) / c));
}

function waitBounds(waitMinutes) {
  return {
    lower: Math.max(1, Math.round(waitMinutes * 0.8)),
    upper: Math.max(1, Math.round(waitMinutes * 1.3)),
  };
}

function confidenceFor(totalServed) {
  return Math.min(95, Math.round(50 + ((totalServed || 0) / ((totalServed || 0) + 10)) * 45));
}

// ─── Ordering: priority boost, optional urgency, FIFO tiebreak ───────────────
function priorityRank(priority) {
  if (priority === 'emergency') return 2;
  if (priority === 'elderly') return 1;
  return 0;
}

function orderWaiting(users, urgencyEnabled) {
  return Object.entries(users)
    .filter(([, u]) => u && u.status === 'waiting')
    .map(([id, u]) => ({ id, ...u }))
    .sort((a, b) => {
      if (urgencyEnabled) {
        const ua = a.urgency_score || 0;
        const ub = b.urgency_score || 0;
        if (ub !== ua) return ub - ua;
      }
      const pa = priorityRank(a.priority);
      const pb = priorityRank(b.priority);
      if (pb !== pa) return pb - pa;
      return (a.join_time || 0) - (b.join_time || 0);
    });
}

// ─── Internal recompute (assumes lock held) ───────────────────────────────────
async function _recompute(state, io, reason) {
  const queueId = state.queueId;
  const settings = getSettings(state.meta);
  const open = countersOpen(state);
  const avg = state.stats.avg_service_time || 7;

  // Free counters whose current user is gone or terminal.
  const updates = [];
  for (const [counterId, counter] of Object.entries(state.counters || {})) {
    const uid = counter.current_user_id;
    if (!uid) continue;
    const u = state.users[uid];
    if (!u || ['served', 'removed'].includes(u.status)) {
      updates.push(db.ref(`queues/${queueId}/counters/${counterId}`).update({
        status: 'idle', current_user_id: null, service_started_at: null,
        expected_finish: null, auto_advance_timeout: null,
      }));
    }
  }
  if (updates.length) await Promise.all(updates);

  // Safety net: a 'called' user with no counter pointing at them should NEVER be
  // silently removed. Put them back in line so they keep their spot.
  const heldUserIds = new Set(Object.values(state.counters || {}).map(c => c.current_user_id).filter(Boolean));
  for (const [uid, u] of Object.entries(state.users || {})) {
    if (u && u.status === 'called' && !heldUserIds.has(uid)) {
      await db.ref(`queues/${queueId}/users/${uid}`).update({
        status: 'waiting', counter_id: null, called_at: null,
      });
      u.status = 'waiting';
      u.counter_id = null;
      console.warn(`↩️  ${uid} had no counter — returned to waiting (never auto-removed).`);
    }
  }

  const waiting = orderWaiting(state.users, settings.urgency_enabled);
  const confidence = confidenceFor(state.stats.total_served);

  let i = 0;
  for (const u of waiting) {
    const pos = i + 1;
    const wait = estimateWait(pos - 1, DEFAULT_SERVICE_TIMES[u.intent_category] || avg, open);
    await db.ref(`queues/${queueId}/users/${u.id}`).update({
      position: pos, wait_predicted: wait, wait_confidence: confidence,
    });
    u.position = pos;
    u.wait_predicted = wait;
    i++;
  }

  const waitingCount = waiting.length;
  const inServiceCount = Object.values(state.users || {}).filter(u => u && u.status === 'in_service').length;

  await db.ref(`queues/${queueId}/stats`).update({
    waiting_count: waitingCount,
    current_count: waitingCount,
    in_service_count: inServiceCount,
    avg_wait_live: estimateWait(Math.max(0, waitingCount - 1), avg, open),
  });

  if (io) {
    io.to(`queue_${queueId}`).emit('queue_update', {
      action: reason || 'positions_recalculated',
      count: waitingCount,
      avg_wait: estimateWait(Math.max(0, waitingCount - 1), avg, open),
    });
  }

  return { waiting, waitingCount, inServiceCount, open, avg, confidence };
}

// ─── Public recompute ─────────────────────────────────────────────────────────
async function recomputeQueue(queueId, io, reason) {
  return withQueueLock(queueId, async () => {
    const state = await loadState(queueId);
    if (!state.meta) return { ok: false, reason: 'no_queue' };
    const r = await _recompute(state, io, reason);
    return { ok: true, ...r };
  });
}

// ─── Enqueue (join) ────────────────────────────────────────────────────────────
async function enqueueUser(queueId, prepared) {
  return withQueueLock(queueId, async () => {
    const state = await loadState(queueId);
    if (!state.meta) return { ok: false, reason: 'no_queue' };
    if (state.meta.status === 'paused' || state.meta.status === 'closed') {
      return { ok: false, reason: state.meta.status };
    }

    // Atomic, unique token sequence.
    const seqRes = await db.ref(`queues/${queueId}/stats/token_seq`).transaction((cur) => (cur || 0) + 1);
    const tokenNum = (seqRes && seqRes.snapshot && seqRes.snapshot.val()) || 1;
    const token = `Q-${queueId.toUpperCase().slice(0, 3)}-${String(tokenNum).padStart(4, '0')}`;

    const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const userData = {
      ...prepared,
      userId,
      token,
      status: 'waiting',
      join_time: now,
      called_at: null,
      attended_at: null,
      done_at: null,
      last_active: now,
      last_seen: now,
      bail_probability: 0,
      sentiment_level: 0,
      last_flash_sent: 0,
      history_noshows: prepared.history_noshows || 0,
    };

    await db.ref(`queues/${queueId}/users/${userId}`).set(userData);

    await db.ref(`queues/${queueId}/stats`).update({
      joins_last_5min: (state.stats.joins_last_5min || 0) + 1,
      token_seq: tokenNum,
      total_joined: (state.stats.total_joined || 0) + 1,
    });

    // Insert into local state and recompute positions authoritatively.
    state.users[userId] = userData;
    const r = await _recompute(state, null, 'user_joined');
    const me = r.waiting.find(u => u.id === userId);

    return {
      ok: true,
      userId,
      token,
      position: me ? me.position : r.waitingCount,
      wait_minutes: me ? me.wait_predicted : 0,
      confidence: r.confidence,
      waitingCount: r.waitingCount,
    };
  });
}

// ─── Counter selection ─────────────────────────────────────────────────────────
function selectCounter(state, serviceType) {
  const entries = Object.entries(state.counters || {});
  if (entries.length === 0) return { counter_id: 'counter_1', counter_label: 'Counter 1', expected_wait: 0 };

  const avg = DEFAULT_SERVICE_TIMES[serviceType] || state.stats.avg_service_time || 7;
  let best = null;
  let minWait = Infinity;

  for (const [counterId, counter] of entries) {
    const status = counterStatus(counter);
    if (status === 'in_service') continue; // not available
    const supported = counter.supported_types || [];
    const compatible = supported.length === 0 || supported.includes(serviceType);
    const queued = Object.values(state.users || {}).filter(u => u && u.status === 'waiting' && u.counter_id === counterId).length;
    const remaining = (status === 'serving' && counter.service_started_at)
      ? Math.max(0, ((counter.estimated_free_at || (counter.service_started_at + avg * 60000)) - Date.now()) / 60000)
      : 0;
    const expected = queued * avg + remaining + (compatible ? 0 : 3);
    if (expected < minWait) {
      minWait = expected;
      best = {
        counter_id: counterId,
        counter_label: counter.label || counterId.replace('_', ' '),
        expected_wait: Math.round(expected),
      };
    }
  }
  if (!best) {
    // All counters busy → recommend least-loaded anyway (advisory only).
    const [cid, c] = entries[0];
    return { counter_id: cid, counter_label: c.label || cid.replace('_', ' '), expected_wait: Math.round(minWait === Infinity ? 0 : minWait) };
  }
  return best;
}

// ─── Select next user for a counter ────────────────────────────────────────────
function selectNext(state, counterId) {
  const settings = getSettings(state.meta);
  const waiting = orderWaiting(state.users, settings.urgency_enabled);
  if (waiting.length === 0) return null;
  const counter = state.counters[counterId];
  const supported = (counter && counter.supported_types) || [];
  if (supported.length) {
    const match = waiting.find(u => supported.includes(u.intent_category));
    if (match) return match;
  }
  return waiting[0];
}

// ─── callNext (admin or automation) ─────────────────────────────────────────────
async function callNext(queueId, counterId, io, source) {
  return withQueueLock(queueId, async () => {
    const state = await loadState(queueId);
    if (!state.meta) return { ok: false, reason: 'no_queue' };
    const counter = state.counters[counterId];
    if (!counter) return { ok: false, reason: 'unknown_counter' };
    if (counterStatus(counter) === 'in_service') return { ok: false, reason: 'counter_in_service' };
    if (counter.current_user_id && counterStatus(counter) === 'serving') {
      return { ok: false, reason: 'counter_busy' };
    }

    const next = selectNext(state, counterId);
    if (!next) {
      await db.ref(`queues/${queueId}/counters/${counterId}`).update({
        status: 'idle', current_user_id: null, service_started_at: null,
        expected_finish: null, auto_advance_timeout: null,
      });
      return { ok: false, reason: 'empty' };
    }

    const avg = DEFAULT_SERVICE_TIMES[next.intent_category] || state.stats.avg_service_time || 7;
    const now = Date.now();
    const label = counter.label || counterId.replace('_', ' ');

    await db.ref(`queues/${queueId}/users/${next.id}`).update({
      status: 'called', called_at: now, counter_id: counterId,
    });
    await db.ref(`queues/${queueId}/counters/${counterId}`).update({
      status: 'serving',
      current_user_id: next.id,
      service_started_at: null,
      expected_finish: now + avg * 60000,
      auto_advance_timeout: now + Math.max(avg * 3, 15) * 60000,
    });

    // Update local state so the recompute below sees the counter as holding
    // this user (otherwise it would treat the freshly-called user as orphaned).
    state.users[next.id] = { ...state.users[next.id], status: 'called', counter_id: counterId, called_at: now };
    state.counters[counterId] = {
      ...counter,
      status: 'serving',
      current_user_id: next.id,
      service_started_at: null,
      expected_finish: now + avg * 60000,
      auto_advance_timeout: now + Math.max(avg * 3, 15) * 60000,
    };
    await _recompute(state, io, 'next_called');

    if (io) {
      emitToUser(io, next.id, 'turn_called', {
        userId: next.id, name: next.name, token: next.token,
        counter: counterId, counter_label: label,
      });
      emitToUser(io, next.id, 'flash_message', {
        target_user: next.id,
        message: `YOUR TURN — please go to ${label} now. Token: ${next.token}.`,
        type: 'turn_called', duration: 0,
      });
      io.to(`admin_${queueId}`).emit('user_called', {
        userId: next.id, name: next.name, token: next.token,
        intent: next.intent_category, details: next.intent_details,
        counter: counterId, counter_label: label, urgency_score: next.urgency_score,
      });
    }

    return {
      ok: true,
      called_user: { userId: next.id, name: next.name, token: next.token, phone: next.phone, counter: counterId },
      counter: counterId,
    };
  });
}

// ─── markArrived ──────────────────────────────────────────────────────────────
async function markArrived(queueId, userId, counterId, io) {
  return withQueueLock(queueId, async () => {
    const state = await loadState(queueId);
    const user = state.users[userId];
    if (!user) return { ok: false, reason: 'no_user' };
    if (user.status !== 'called') return { ok: false, reason: 'invalid_state', status: user.status };
    const cid = counterId || user.counter_id || 'counter_1';
    const now = Date.now();
    const avg = DEFAULT_SERVICE_TIMES[user.intent_category] || state.stats.avg_service_time || 7;

    await db.ref(`queues/${queueId}/users/${userId}`).update({ status: 'in_service', attended_at: now });
    await db.ref(`queues/${queueId}/counters/${cid}`).update({
      status: 'in_service', current_user_id: userId, service_started_at: now,
      expected_finish: now + avg * 60000,
      auto_advance_timeout: now + Math.max(avg * 3, 15) * 60000,
    });

    if (io) {
      io.to(`admin_${queueId}`).emit('user_attended', { userId, name: user.name, counter: cid, service_started_at: now });
      io.to(`queue_${queueId}`).emit('queue_update', { action: 'user_in_service', userId, counter: cid });
    }

    return { ok: true, status: 'in_service', counter: cid, user: user.name };
  });
}

// ─── markComplete ──────────────────────────────────────────────────────────────
async function markComplete(queueId, userId, io) {
  return withQueueLock(queueId, async () => {
    const state = await loadState(queueId);
    const user = state.users[userId];
    if (!user) return { ok: false, reason: 'no_user' };
    if (!['called', 'in_service'].includes(user.status)) {
      return { ok: false, reason: 'invalid_state', status: user.status };
    }
    const counterId = user.counter_id || 'counter_1';
    const now = Date.now();
    const actualWait = Math.round((now - (user.join_time || now)) / 60000);
    const serviceStartTime = user.attended_at || user.called_at || user.join_time || now;
    const actualServiceTime = Math.max(1, Math.round((now - serviceStartTime) / 60000));

    await db.ref(`queues/${queueId}/users/${userId}`).update({
      status: 'served', done_at: now, actual_wait: actualWait, actual_service_time: actualServiceTime,
    });
    await db.ref(`queues/${queueId}/counters/${counterId}`).update({
      status: 'idle', current_user_id: null, service_started_at: null,
      expected_finish: null, auto_advance_timeout: null,
    });

    // EMA of avg service time
    const oldAvg = state.stats.avg_service_time || 7;
    const totalServed = state.stats.total_served || 0;
    const newAvg = Math.round(((oldAvg * totalServed + actualServiceTime) / (totalServed + 1)) * 10) / 10;
    await db.ref(`queues/${queueId}/stats`).update({
      avg_service_time: newAvg,
      total_served: totalServed + 1,
      served_last_5min: (state.stats.served_last_5min || 0) + 1,
    });

    state.users[userId] = { ...user, status: 'served' };
    state.stats.avg_service_time = newAvg;
    state.stats.total_served = totalServed + 1;

    logService(user, queueId, {
      done_time: now, actualWait, actualServiceTime,
      predictionError: Math.abs(actualWait - (user.wait_predicted || 0)), counterId,
    }).catch(() => {});

    await _recompute(state, io, 'service_completed');

    if (io) {
      io.to(`admin_${queueId}`).emit('service_completed', {
        userId, name: user.name, actual_wait: actualWait,
        prediction_error: Math.abs(actualWait - (user.wait_predicted || 0)),
      });
    }

    return { ok: true, next_user: null };
  });
}

// ─── markNoShow / cancel ────────────────────────────────────────────────────────
async function markNoShow(queueId, userId, reason, io, source) {
  return withQueueLock(queueId, async () => {
    const state = await loadState(queueId);
    const user = state.users[userId];
    if (!user) return { ok: false, reason: 'no_user' };
    if (['served', 'removed'].includes(user.status)) {
      return { ok: false, reason: 'already_terminal', status: user.status };
    }
    const counterId = user.counter_id || null;
    const now = Date.now();

    await db.ref(`queues/${queueId}/users/${userId}`).update({
      status: 'removed', removed_reason: reason || 'no_show', removed_at: now,
    });
    if (counterId && state.counters[counterId]) {
      await db.ref(`queues/${queueId}/counters/${counterId}`).update({
        status: 'idle', current_user_id: null, service_started_at: null,
        expected_finish: null, auto_advance_timeout: null,
      });
    }

    state.users[userId] = { ...user, status: 'removed' };
    bumpNoShow(user);
    logRemoval(user, queueId, { reason: reason || 'no_show', counterId });

    await _recompute(state, io, 'user_removed');
    if (io) {
      io.to(`admin_${queueId}`).emit('user_removed', { userId, name: user.name, reason: reason || 'no_show', source: source || 'system' });
    }

    return { ok: true, next_user: null };
  });
}

// ─── Auto-advance removed ────────────────────────────────────────────────────────
// The queue only moves when the admin calls the next student. Completing or
// removing a student never auto-calls anyone.

// ─── Status snapshot (used by student + admin) ───────────────────────────────────
async function getStatus(queueId, extra) {
  const state = await loadState(queueId);
  const settings = getSettings(state.meta);
  const open = countersOpen(state);
  const users = Object.values(state.users || {});
  const waiting = users.filter(u => u && u.status === 'waiting').length;
  const called = users.filter(u => u && u.status === 'called').length;
  const inService = users.filter(u => u && u.status === 'in_service').length;
  const counters = Object.entries(state.counters || {}).map(([id, c]) => ({
    id,
    label: c.label || id.replace('_', ' '),
    status: counterStatus(c),
    current_user_id: c.current_user_id || null,
    supported_types: c.supported_types || [],
  }));

  return {
    queue_id: queueId,
    queue_name: (state.meta && state.meta.name) || queueId,
    queue_type: (state.meta && state.meta.type) || queueId,
    status: (state.meta && state.meta.status) || 'open',
    counters_open: open,
    count: waiting + called + inService,
    waiting_count: waiting,
    called_count: called,
    in_service_count: inService,
    avg_wait: state.stats.avg_wait_live || 0,
    avg_service_time: state.stats.avg_service_time || 7,
    congestion: state.stats.congestion_level || 'normal',
    surge_active: state.stats.surge_active === true,
    crowd: state.stats.crowd || null,
    settings,
    counters,
    ...(extra || {}),
  };
}

// ─── Settings update ────────────────────────────────────────────────────────────
async function updateSettings(queueId, patch, io) {
  const current = await db.ref(`queues/${queueId}/meta/settings`).get();
  const merged = { ...(current.exists() ? current.val() : {}), ...patch };
  await db.ref(`queues/${queueId}/meta/settings`).set(merged);
  if (io) io.to(`queue_${queueId}`).emit('queue_update', { action: 'settings_updated' });
  return merged;
}

// ─── Counter management ──────────────────────────────────────────────────────────
async function addCounter(queueId, io, opts = {}) {
  return withQueueLock(queueId, async () => {
    const state = await loadState(queueId);
    if (!state.meta) return { ok: false, reason: 'no_queue' };
    const ids = Object.keys(state.counters || {});
    let n = 1;
    while (ids.includes(`counter_${n}`)) n++;
    const id = `counter_${n}`;
    await db.ref(`queues/${queueId}/counters/${id}`).set({
      label: opts.label || `Counter ${n}`,
      status: 'idle',
      current_user_id: null,
      service_started_at: null,
      expected_finish: null,
      auto_advance_timeout: null,
      supported_types: Array.isArray(opts.supported_types) ? opts.supported_types : [],
    });
    await db.ref(`queues/${queueId}/meta`).update({ counters_open: ids.length + 1 });
    if (io) io.to(`admin_${queueId}`).emit('queue_update', { action: 'counter_added', counter_id: id });
    return { ok: true, counter_id: id };
  });
}

async function removeCounter(queueId, counterId, io) {
  return withQueueLock(queueId, async () => {
    const state = await loadState(queueId);
    const counter = state.counters[counterId];
    if (!counter) return { ok: false, reason: 'unknown_counter' };
    if (Object.keys(state.counters).length <= 1) return { ok: false, reason: 'last_counter' };
    if (counter.current_user_id) return { ok: false, reason: 'counter_busy' };
    await db.ref(`queues/${queueId}/counters/${counterId}`).remove();
    const remaining = Object.keys(state.counters).length - 1;
    await db.ref(`queues/${queueId}/meta`).update({ counters_open: remaining });
    if (io) io.to(`admin_${queueId}`).emit('queue_update', { action: 'counter_removed', counter_id: counterId });
    return { ok: true, counters_open: remaining };
  });
}

async function setQueueStatus(queueId, status, io, opts = {}) {
  await db.ref(`queues/${queueId}/meta`).update({ status });
  if (io) {
    io.to(`queue_${queueId}`).emit('queue_update', { action: status === 'paused' ? 'queue_paused' : status === 'closed' ? 'queue_closed' : 'queue_resumed' });
  }
  if (status === 'paused' && opts.auto) {
    await db.ref(`queues/${queueId}/stats`).update({ auto_paused_at: Date.now(), auto_pause_reason: opts.reason || 'surge' });
  }
  return { status };
}

// ─── Firestore logging helpers (non-blocking at call sites) ─────────────────────
async function logService(user, queueId, info) {
  try {
    await firestore.collection('service_history').add({
      queue_id: queueId,
      user_id: user.userId || user.id,
      service_type: user.intent_category,
      intent_category: user.intent_category,
      join_time: user.join_time,
      call_time: user.called_at,
      attended_time: user.attended_at,
      done_time: info.done_time,
      wait_predicted: user.wait_predicted,
      wait_actual: info.actualWait,
      prediction_error: info.predictionError,
      sentiment_peak: user.sentiment_level,
      attended_or_removed: 'attended',
      counter_id: info.counterId,
      date_key: dateKey(),
      hour_key: new Date().getHours(),
    });
  } catch { /* non-critical */ }
}

async function logRemoval(user, queueId, info) {
  try {
    await firestore.collection('service_history').add({
      queue_id: queueId,
      user_id: user.userId || user.id,
      service_type: user.intent_category,
      intent_category: user.intent_category,
      join_time: user.join_time,
      removed_at: Date.now(),
      attended_or_removed: 'removed',
      removal_reason: info.reason,
      counter_id: info.counterId,
      date_key: dateKey(),
      hour_key: new Date().getHours(),
    });
  } catch { /* non-critical */ }
}

function bumpNoShow(user) {
  try {
    const { hashPhone } = require('../monitors/fraudScanner');
    const phoneHash = hashPhone(user.phone);
    firestore.collection('user_history').doc(phoneHash).get().then((doc) => {
      const existing = doc.exists ? doc.data() : {};
      return firestore.collection('user_history').doc(phoneHash).set({
        phone_hash: phoneHash,
        no_show_count: (existing.no_show_count || 0) + 1,
        removal_count: (existing.removal_count || 0) + 1,
        last_visited: Date.now(),
      }, { merge: true });
    }).catch(() => {});
  } catch { /* non-critical */ }
}

module.exports = {
  withQueueLock,
  getSettings,
  loadState,
  counterStatus,
  countersOpen,
  estimateWait,
  waitBounds,
  confidenceFor,
  orderWaiting,
  DEFAULT_SERVICE_TIMES,
  recomputeQueue,
  enqueueUser,
  selectCounter,
  selectNext,
  callNext,
  markArrived,
  markComplete,
  markNoShow,
  getStatus,
  updateSettings,
  addCounter,
  removeCounter,
  setQueueStatus,
};
