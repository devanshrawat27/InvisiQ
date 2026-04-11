/**
 * Congestion Oracle — Surge Detection Monitor
 * ----------------------------------------------
 * Monitors join rate. Fires surge alert when queue fills
 * faster than 2.5× historical baseline.
 *
 * AI Usage: NONE — Threshold logic only.
 */

const { db } = require('../firebase/init');

/**
 * Run Congestion Oracle check on a queue.
 * @param {string} queueId
 * @param {object} io — Socket.io server instance
 * @returns {object} { surge_detected, joins_last_5min, baseline, alerts[] }
 */
async function runCongestionOracle(queueId, io) {
  const result = { surge_detected: false, joins_last_5min: 0, baseline: 0, alerts: [] };

  try {
    const statsRef = db.ref(`queues/${queueId}/stats`);
    const statsSnap = await statsRef.get();
    const stats = statsSnap.exists() ? statsSnap.val() : {};

    const currentHour = new Date().getHours();

    // Get joins in last 5 minutes
    const joinsLast5Min = stats.joins_last_5min || 0;

    // Historical baseline (default: 3 joins per 5 min)
    const baselineByHour = {
      8: 2, 9: 4, 10: 6, 11: 5, 12: 3, 13: 4, 14: 8, 15: 10, 16: 6, 17: 3,
    };
    const baseline = baselineByHour[currentHour] || 3;

    result.joins_last_5min = joinsLast5Min;
    result.baseline = baseline;

    // ── Surge Detection: joins/5min > 2.5× baseline ──────────────
    const surgeThreshold = baseline * 2.5;
    const wasSurging = stats.surge_active || false;

    if (joinsLast5Min > surgeThreshold) {
      result.surge_detected = true;

      // Update stats
      await statsRef.update({
        congestion_level: 'surge',
        surge_active: true,
      });

      // Only alert if not already surging (avoid spam)
      if (!wasSurging) {
        const alert = {
          type: 'surge_alert',
          joins_last_5min: joinsLast5Min,
          threshold: surgeThreshold,
          flash_message: 'Queue surge detected — the office is experiencing higher than usual traffic right now.',
        };
        result.alerts.push(alert);

        if (io) {
          // Flash alert to ALL waiting students
          io.to(`queue_${queueId}`).emit('surge_alert', {
            message: alert.flash_message,
            congestion_level: 'surge',
            joins_last_5min: joinsLast5Min,
          });

          io.to(`queue_${queueId}`).emit('flash_message', {
            target_user: 'all',
            message: 'High traffic detected. Your wait may be slightly longer than predicted.',
            type: 'warning',
            duration: 10000,
          });

          // Admin alert — flashing orange banner
          io.to(`admin_${queueId}`).emit('surge_alert', {
            message: `⚡ SURGE: ${joinsLast5Min} joins in last 5 min (baseline: ${baseline})`,
            severity: 'high',
          });
        }

        console.log(`⚡ Congestion Oracle: SURGE detected in ${queueId} — ${joinsLast5Min} joins (baseline: ${baseline})`);
      }
    } else if (wasSurging && joinsLast5Min <= baseline * 1.5) {
      // Surge resolved
      await statsRef.update({
        congestion_level: joinsLast5Min > baseline ? 'high' : 'normal',
        surge_active: false,
      });

      if (io) {
        io.to(`admin_${queueId}`).emit('surge_resolved', {
          message: 'Surge has subsided. Queue returning to normal.',
        });
      }
    }
  } catch (err) {
    console.error('❌ Congestion Oracle error:', err.message);
  }

  return result;
}

module.exports = { runCongestionOracle };
