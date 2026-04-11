/**
 * Monitor Loop — Background AI Monitors
 * -----------------------------------------
 * Runs every 60 seconds per queue.
 * Executes all 5 monitors + auto-timeout check + sentiment trigger.
 *
 * Monitors executed:
 *   1. Ghost Buster — no-show detection
 *   2. Urgency Engine — dynamic re-ordering
 *   3. Congestion Oracle — surge detection
 *   4. Fraud Scanner — periodic recheck
 *   5. Counter Compass — load rebalancing
 *   + Auto-Timeout check
 *   + Sentiment Flash trigger (Claude API)
 */

const { db } = require('../firebase/init');
const { runGhostBuster } = require('../monitors/ghostBuster');
const { runUrgencyEngine } = require('../monitors/urgencyEngine');
const { runCongestionOracle } = require('../monitors/congestionOracle');
const { runFraudScanner } = require('../monitors/fraudScanner');
const { runCounterCompass } = require('../monitors/counterCompass');
const { checkAutoTimeout } = require('../monitors/autoAdvance');
const { callClaude } = require('../ai/claude');
const { sentimentPrompt } = require('../ai/prompts');
const mockResponses = require('../data/mock_responses.json');

// Track active monitor intervals
const activeIntervals = {};

/**
 * Start the monitor loop for a specific queue.
 * @param {string} queueId
 * @param {object} io — Socket.io server instance
 */
function startMonitorLoop(queueId, io) {
  if (activeIntervals[queueId]) {
    console.log(`⚠️  Monitor loop already running for ${queueId}`);
    return;
  }

  console.log(`🔄 Starting monitor loop for queue: ${queueId} (60s interval)`);

  const interval = setInterval(async () => {
    try {
      const startTime = Date.now();

      // ── Run all 5 monitors in parallel ─────────────────────────
      const [ghostResult, urgencyResult, congestionResult, fraudResult, counterResult] =
        await Promise.all([
          runGhostBuster(queueId, io),
          runUrgencyEngine(queueId, io),
          runCongestionOracle(queueId, io),
          runFraudScanner(queueId, io),
          runCounterCompass(queueId, io),
        ]);

      // ── Check auto-timeout ─────────────────────────────────────
      await checkAutoTimeout(queueId, io);

      // ── Sentiment Flash Trigger ────────────────────────────────
      // Check if any users need sentiment-based flash messages
      await triggerSentimentFlash(queueId, io);

      // ── Reset joins_last_5min counter periodically ─────────────
      // Decrement by ~20% each cycle to naturally decay
      try {
        const statsRef = db.ref(`queues/${queueId}/stats`);
        const statsSnap = await statsRef.get();
        if (statsSnap.exists()) {
          const stats = statsSnap.val();
          const currentJoins = stats.joins_last_5min || 0;
          if (currentJoins > 0) {
            await statsRef.update({
              joins_last_5min: Math.max(0, Math.floor(currentJoins * 0.8)),
            });
          }
        }
      } catch (e) {
        // Non-critical
      }

      const elapsed = Date.now() - startTime;

      // Log only if something interesting happened
      if (
        ghostResult.flagged > 0 || ghostResult.removed > 0 ||
        urgencyResult.reordered ||
        congestionResult.surge_detected ||
        fraudResult.flagged > 0
      ) {
        console.log(`🔄 Monitor cycle [${queueId}] — ${elapsed}ms | Ghost: ${ghostResult.flagged}F/${ghostResult.removed}R | Urgency: ${urgencyResult.reordered ? '✓' : '—'} | Surge: ${congestionResult.surge_detected ? '⚡' : '—'} | Fraud: ${fraudResult.flagged}F`);
      }
    } catch (err) {
      console.error(`❌ Monitor loop error [${queueId}]:`, err.message);
    }
  }, 60000); // 60 seconds

  activeIntervals[queueId] = interval;
}

/**
 * Stop the monitor loop for a specific queue.
 */
function stopMonitorLoop(queueId) {
  if (activeIntervals[queueId]) {
    clearInterval(activeIntervals[queueId]);
    delete activeIntervals[queueId];
    console.log(`⏹️  Monitor loop stopped for ${queueId}`);
  }
}

/**
 * Start monitor loops for all existing queues.
 * Called on server startup.
 */
async function startAllMonitorLoops(io) {
  try {
    const queuesSnap = await db.ref('queues').get();
    if (!queuesSnap.exists()) {
      console.log('📋 No queues found — monitor loops will start when queues are created');
      return;
    }

    const queues = queuesSnap.val();
    for (const queueId of Object.keys(queues)) {
      startMonitorLoop(queueId, io);
    }

    console.log(`✅ Monitor loops started for ${Object.keys(queues).length} queue(s)`);
  } catch (err) {
    console.error('❌ Failed to start monitor loops:', err.message);
  }
}

/**
 * Trigger sentiment-based flash messages for users who meet the criteria.
 * Criteria (from handoff doc):
 *   - bail_probability > 60
 *   - wait_exceeded_ratio > 1.3
 *   - urgency_score rising rapidly
 */
async function triggerSentimentFlash(queueId, io) {
  try {
    const usersRef = db.ref(`queues/${queueId}/users`);
    const snapshot = await usersRef.get();

    if (!snapshot.exists()) return;

    const users = snapshot.val();
    const now = Date.now();

    const metaRef = db.ref(`queues/${queueId}/meta`);
    const metaSnap = await metaRef.get();
    const meta = metaSnap.exists() ? metaSnap.val() : { name: queueId };

    for (const [userId, user] of Object.entries(users)) {
      if (user.status !== 'waiting') continue;

      // Check if cooldown has passed (2 min between flash messages)
      const lastFlash = user.last_flash_sent || 0;
      if (now - lastFlash < 2 * 60 * 1000) continue;

      const expectedWait = user.wait_predicted || 10;
      const actualWait = (now - (user.join_time || now)) / (1000 * 60);
      const waitExceededRatio = expectedWait > 0 ? actualWait / expectedWait : 0;
      const waitExceededPercent = Math.round(Math.max(0, (waitExceededRatio - 1) * 100));

      // Check trigger conditions
      const shouldTrigger =
        user.bail_probability > 60 ||
        waitExceededRatio > 1.3 ||
        (user.urgency_score > 50 && actualWait > expectedWait);

      if (!shouldTrigger) continue;

      // ── Claude API: Sentiment Flash Message ─────────────────
      const context = {
        name: user.name,
        position: user.position,
        wait_remaining: Math.max(1, Math.round(expectedWait - actualWait)),
        queue_name: meta.name || queueId,
        bail_probability: user.bail_probability,
        wait_exceeded_percent: waitExceededPercent,
      };

      // Choose mock based on severity
      const mockResponse = user.bail_probability > 60
        ? mockResponses.sentiment_flash_high
        : mockResponses.sentiment_flash_normal;

      const sentimentResult = await callClaude(
        sentimentPrompt(context),
        mockResponse
      );

      // Update user's sentiment_level
      await db.ref(`queues/${queueId}/users/${userId}`).update({
        sentiment_level: sentimentResult.frustration_level,
        last_flash_sent: now,
      });

      // Send flash message to student
      if (io) {
        io.to(`queue_${queueId}`).emit('flash_message', {
          target_user: userId,
          message: sentimentResult.flash_message,
          type: sentimentResult.frustration_level >= 4 ? 'urgent' : 'empathy',
          duration: 8000,
        });

        // Admin alert if frustration >= 4
        if (sentimentResult.admin_alert || sentimentResult.frustration_level >= 4) {
          io.to(`admin_${queueId}`).emit('sentiment_alert', {
            userId,
            userName: user.name,
            frustration_level: sentimentResult.frustration_level,
            message: sentimentResult.flash_message,
          });
        }
      }

      console.log(`💬 Sentiment Flash: ${user.name} (level: ${sentimentResult.frustration_level})`);
    }
  } catch (err) {
    console.error('❌ Sentiment flash trigger error:', err.message);
  }
}

module.exports = { startMonitorLoop, stopMonitorLoop, startAllMonitorLoops };
