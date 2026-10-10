/**
 * Monitor Loop — background intelligence (orchestrated)
 * -----------------------------------------------------
 * Runs every 60s per queue. Monitors run SEQUENTIALLY against a shared view so
 * they never race each other. All mutations route through queueService.
 *
 *  1. Congestion Oracle  — surge analysis + admin recommendations (advisory)
 *  2. Ghost Buster       — abandoned-student detection (advisory by default)
 *  3. Urgency Engine     — re-scoring (re-order only if opt-in)
 *  4. Fraud Scanner      — periodic duplicate re-check (advisory)
 *  5. Counter Compass    — counter availability snapshot (advisory)
 *  + Auto-timeout / idle auto-advance  (only if settings.auto_advance)
 *  + Sentiment flash & periodic updates (targeted per-user)
 */

const { db } = require('../firebase/init');
const { runGhostBuster } = require('../monitors/ghostBuster');
const { runUrgencyEngine } = require('../monitors/urgencyEngine');
const { runCongestionOracle } = require('../monitors/congestionOracle');
const { runFraudScanner } = require('../monitors/fraudScanner');
const { runCounterCompass } = require('../monitors/counterCompass');
const { callGemini } = require('../ai/gemini');
const { sentimentPrompt } = require('../ai/prompts');
const { emitToUser } = require('../socket/registry');
const queueService = require('../services/queueService');
const mockResponses = require('../data/mock_responses.json');

const activeIntervals = {};
const cycleCounters = {};

function startMonitorLoop(queueId, io) {
  if (activeIntervals[queueId]) return;
  console.log(`🔄 Starting monitor loop for queue: ${queueId} (60s interval)`);
  const interval = setInterval(() => {
    runCycle(queueId, io).catch((err) => console.error(`❌ Monitor loop error [${queueId}]:`, err.message));
  }, 60000);
  activeIntervals[queueId] = interval;
}

function stopMonitorLoop(queueId) {
  if (activeIntervals[queueId]) {
    clearInterval(activeIntervals[queueId]);
    delete activeIntervals[queueId];
  }
}

async function startAllMonitorLoops(io) {
  try {
    const queuesSnap = await db.ref('queues').get();
    if (!queuesSnap.exists()) {
      console.log('📋 No queues found — loops start when queues are created');
      return;
    }
    for (const queueId of Object.keys(queuesSnap.val())) startMonitorLoop(queueId, io);
    console.log(`✅ Monitor loops started for ${Object.keys(queuesSnap.val()).length} queue(s)`);
  } catch (err) {
    console.error('❌ Failed to start monitor loops:', err.message);
  }
}

async function runCycle(queueId, io) {
  const start = Date.now();
  const state = await queueService.loadState(queueId);
  if (!state.meta) return;

  // 1. Crowd / congestion (advisory only — never pauses/moves students)
  const congestion = await runCongestionOracle(queueId, io);

  // 2. Ghost detection (advisory only — never removes unless opt-in)
  const ghost = await runGhostBuster(queueId, io);

  // 3. Urgency re-scoring (advisory only — re-orders only if opt-in)
  const urgency = await runUrgencyEngine(queueId, io);

  // 4. Fraud periodic re-check
  const fraud = await runFraudScanner(queueId, io);

  // 5. Counter snapshot
  const counter = await runCounterCompass(queueId, io);

  // Keep positions/waits/stats fresh. This NEVER calls or removes students —
  // the queue only moves when the admin acts.
  await queueService.recomputeQueue(queueId, io, 'periodic_refresh');

  if (!cycleCounters[queueId]) cycleCounters[queueId] = 0;
  cycleCounters[queueId]++;

  // Sentiment + periodic updates every cycle (targeted, throttled)
  await triggerSentimentFlash(queueId, io);
  if (cycleCounters[queueId] % 3 === 0) await sendPeriodicUpdates(queueId, io);

  // Decay 5-minute rate counters
  await decayRates(queueId);

  const elapsed = Date.now() - start;
  if (ghost.flagged || ghost.removed || urgency.reordered || congestion.surge_detected || fraud.flagged) {
    console.log(`🔄 [${queueId}] ${elapsed}ms | ghost ${ghost.flagged}F/${ghost.removed}R | urgency ${urgency.reordered ? '✓' : '—'} | ${congestion.level} | fraud ${fraud.flagged}F | counters ${counter.idle}idle/${counter.busy}busy`);
  }
}

async function triggerSentimentFlash(queueId, io) {
  try {
    const state = await queueService.loadState(queueId);
    const now = Date.now();
    for (const [userId, user] of Object.entries(state.users || {})) {
      if (!user || user.status !== 'waiting') continue;
      if (now - (user.last_flash_sent || 0) < 3 * 60 * 1000) continue;

      const expected = user.wait_predicted || 10;
      const actual = (now - (user.join_time || now)) / 60000;
      const ratio = expected > 0 ? actual / expected : 0;
      const shouldTrigger = (user.bail_probability > 60) || (ratio > 1.4) ||
        (user.urgency_score > 50 && actual > expected);
      if (!shouldTrigger) continue;

      const context = {
        name: user.name, position: user.position,
        wait_remaining: Math.max(1, Math.round(expected - actual)),
        queue_name: (state.meta && state.meta.name) || queueId,
        bail_probability: user.bail_probability,
        wait_exceeded_percent: Math.round(Math.max(0, (ratio - 1) * 100)),
      };
      const mockResponse = user.bail_probability > 60
        ? mockResponses.sentiment_flash_high : mockResponses.sentiment_flash_normal;
      const sentiment = await callGemini(sentimentPrompt(context), mockResponse);

      await db.ref(`queues/${queueId}/users/${userId}`).update({
        sentiment_level: sentiment.frustration_level, last_flash_sent: now,
      });
      if (io) {
        emitToUser(io, userId, 'flash_message', {
          target_user: userId, message: sentiment.flash_message,
          type: sentiment.frustration_level >= 4 ? 'urgent' : 'empathy', duration: 8000,
        });
        if (sentiment.admin_alert || sentiment.frustration_level >= 4) {
          io.to(`admin_${queueId}`).emit('sentiment_alert', {
            userId, userName: user.name, frustration_level: sentiment.frustration_level, message: sentiment.flash_message,
          });
        }
      }
    }
  } catch (err) {
    console.error('❌ Sentiment flash error:', err.message);
  }
}

async function sendPeriodicUpdates(queueId, io) {
  if (!io) return;
  try {
    const state = await queueService.loadState(queueId);
    for (const [userId, user] of Object.entries(state.users || {})) {
      if (!user || user.status !== 'waiting') continue;
      emitToUser(io, userId, 'flash_message', {
        target_user: userId,
        message: `Still #${user.position || '?'} in queue · ~${user.wait_predicted ?? '?'} min left.`,
        type: 'info', duration: 6000,
      });
    }
  } catch (err) {
    console.error('❌ sendPeriodicUpdates error:', err.message);
  }
}

async function decayRates(queueId) {
  try {
    const snap = await db.ref(`queues/${queueId}/stats`).get();
    if (!snap.exists()) return;
    const s = snap.val();
    const patch = {};
    if ((s.joins_last_5min || 0) > 0) patch.joins_last_5min = Math.max(0, Math.floor(s.joins_last_5min * 0.8));
    if ((s.served_last_5min || 0) > 0) patch.served_last_5min = Math.max(0, Math.floor(s.served_last_5min * 0.8));
    if (Object.keys(patch).length) await db.ref(`queues/${queueId}/stats`).update(patch);
  } catch { /* non-critical */ }
}

module.exports = { startMonitorLoop, stopMonitorLoop, startAllMonitorLoops };
