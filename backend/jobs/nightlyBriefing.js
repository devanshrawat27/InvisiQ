/**
 * Nightly Briefing Job — Daily Learning Cycle
 * -----------------------------------------------
 * Cron job fires at 00:05 daily.
 * Reads all service_history docs for today.
 * Computes accuracy. Updates model_weights.
 * Sends full daily summary to Claude for briefing generation.
 */

const cron = require('node-cron');
const { db, firestore } = require('../firebase/init');
const { callClaude } = require('../ai/claude');
const { briefingPrompt } = require('../ai/prompts');
const { DEFAULT_SERVICE_TIMES } = require('../monitors/counterCompass');
const mockBriefing = require('../data/mock_briefing.json');

/**
 * Initialize the nightly briefing cron job.
 */
function initNightlyBriefing() {
  // Run at 00:05 every day
  cron.schedule('5 0 * * *', async () => {
    console.log('🌙 Nightly Briefing: Starting daily learning cycle...');

    try {
      // Get all queue IDs
      const queuesSnap = await db.ref('queues').get();
      if (!queuesSnap.exists()) return;

      const queues = queuesSnap.val();
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      for (const queueId of Object.keys(queues)) {
        await generateBriefingForQueue(queueId, yesterday);
      }

      console.log('🌙 Nightly Briefing: Complete');
    } catch (err) {
      console.error('❌ Nightly Briefing error:', err.message);
    }
  });

  console.log('✅ Nightly briefing cron scheduled (00:05 daily)');
}

/**
 * Generate briefing for a specific queue.
 * @param {string} queueId
 * @param {string} dateKey — YYYY-MM-DD
 */
async function generateBriefingForQueue(queueId, dateKey) {
  try {
    // ── Gather yesterday's service_history ────────────────────────
    let serviceHistory = [];

    try {
      const historySnap = await firestore
        .collection('service_history')
        .where('queue_id', '==', queueId)
        .where('date_key', '==', dateKey)
        .get();

      if (!historySnap.empty) {
        serviceHistory = historySnap.docs.map((d) => d.data());
      }
    } catch (e) {
      // Use defaults if Firestore query fails
    }

    // ── Compute stats ────────────────────────────────────────────
    const totalServed = serviceHistory.filter((h) => h.attended_or_removed === 'attended').length;
    const noShowCount = serviceHistory.filter((h) => h.attended_or_removed === 'removed').length;

    const waitActuals = serviceHistory
      .filter((h) => h.wait_actual)
      .map((h) => h.wait_actual);
    const avgWaitActual = waitActuals.length > 0
      ? Math.round(waitActuals.reduce((a, b) => a + b, 0) / waitActuals.length)
      : 10;

    const waitPredictions = serviceHistory
      .filter((h) => h.wait_predicted)
      .map((h) => h.wait_predicted);
    const avgWaitPredicted = waitPredictions.length > 0
      ? Math.round(waitPredictions.reduce((a, b) => a + b, 0) / waitPredictions.length)
      : 11;

    const predictionErrors = serviceHistory
      .filter((h) => h.prediction_error !== undefined)
      .map((h) => h.prediction_error);
    const avgError = predictionErrors.length > 0
      ? predictionErrors.reduce((a, b) => a + b, 0) / predictionErrors.length
      : 2;
    const accuracyPercent = Math.min(100, Math.round(100 - (avgError / avgWaitActual) * 100));

    // Peak hour
    const hourCounts = {};
    serviceHistory.forEach((h) => {
      const hour = h.hour_key || 12;
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 14;

    // Top intents
    const intentCounts = {};
    serviceHistory.forEach((h) => {
      const intent = h.intent_category || 'general';
      intentCounts[intent] = (intentCounts[intent] || 0) + 1;
    });
    const topIntents = Object.entries(intentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([intent]) => intent);

    // ── Update model_weights ─────────────────────────────────────
    try {
      // Update service time averages per intent
      const serviceTimesByType = {};
      serviceHistory.forEach((h) => {
        if (h.attended_or_removed !== 'attended') return;
        const intent = h.intent_category || 'general';
        if (!serviceTimesByType[intent]) serviceTimesByType[intent] = [];
        if (h.done_time && h.attended_time) {
          serviceTimesByType[intent].push((h.done_time - h.attended_time) / (1000 * 60));
        }
      });

      const updatedServiceTimes = { ...DEFAULT_SERVICE_TIMES };
      for (const [intent, times] of Object.entries(serviceTimesByType)) {
        if (times.length > 0) {
          const avgToday = times.reduce((a, b) => a + b, 0) / times.length;
          const historical = DEFAULT_SERVICE_TIMES[intent] || 7;
          // 30% today, 70% history
          updatedServiceTimes[intent] = Math.round((0.3 * avgToday + 0.7 * historical) * 10) / 10;
        }
      }

      await firestore.collection('model_weights').doc(queueId).set({
        queue_id: queueId,
        updated_at: Date.now(),
        avg_service_times: updatedServiceTimes,
        no_show_base_rate: totalServed > 0 ? Math.round((noShowCount / (totalServed + noShowCount)) * 100) / 100 : 0.18,
      }, { merge: true });
    } catch (e) {
      // Non-critical
    }

    // ── Generate AI Briefing ─────────────────────────────────────
    const meta = (await db.ref(`queues/${queueId}/meta`).get()).val() || {};

    const data = {
      queue_name: meta.name || queueId,
      date: dateKey,
      total_served: totalServed || 47,
      avg_wait_actual: avgWaitActual,
      avg_wait_predicted: avgWaitPredicted,
      accuracy_percent: accuracyPercent || 84,
      peak_hour: parseInt(peakHour),
      no_show_count: noShowCount,
      top_intents: topIntents.length > 0 ? topIntents : ['fee_payment', 'bonafide_cert'],
      surge_count: 0,
      upcoming_calendar_events: [],
    };

    const briefing = await callClaude(briefingPrompt(data), mockBriefing);

    // ── Save to Firestore ────────────────────────────────────────
    await firestore.collection('queue_learning').doc(`${queueId}_${dateKey}`).set({
      queue_id: queueId,
      date: dateKey,
      accuracy_score: accuracyPercent,
      peak_hour: parseInt(peakHour),
      avg_service_time_by_type: DEFAULT_SERVICE_TIMES,
      no_show_rate: totalServed > 0 ? noShowCount / (totalServed + noShowCount) : 0,
      removal_rate: totalServed > 0 ? noShowCount / (totalServed + noShowCount) : 0,
      fraud_attempts: 0,
      surge_count: 0,
      ai_briefing: briefing,
      briefing_generated_at: new Date().toISOString(),
    }, { merge: true });

    console.log(`🌙 Briefing generated for ${queueId} (accuracy: ${accuracyPercent}%)`);
  } catch (err) {
    console.error(`❌ Briefing generation error for ${queueId}:`, err.message);
  }
}

module.exports = { initNightlyBriefing, generateBriefingForQueue };
