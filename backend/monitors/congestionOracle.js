/**
 * Congestion Oracle / Crowd Manager
 * ----------------------------------
 * Analyses queue length, wait time, arrival rate, service rate and counter
 * availability, then produces RECOMMENDATIONS for the admin (and stores them
 * for the UI). It never reorders or removes students, and never assigns a
 * counter itself. Optional automation (auto-pause on surge) is opt-in via
 * settings.auto_pause_on_surge.
 */

const { db } = require('../firebase/init');
const queueService = require('../services/queueService');

const BASELINE_BY_HOUR = { 8: 2, 9: 4, 10: 6, 11: 5, 12: 3, 13: 4, 14: 8, 15: 10, 16: 6, 17: 3 };

async function runCongestionOracle(queueId, io) {
  const result = { surge_detected: false, joins_last_5min: 0, baseline: 0, level: 'normal', recommendations: [] };

  try {
    const state = await queueService.loadState(queueId);
    if (!state.meta) return result;
    const settings = queueService.getSettings(state.meta);
    const stats = state.stats;

    const hour = new Date().getHours();
    const baseline = BASELINE_BY_HOUR[hour] || 3;
    const joinsLast5Min = stats.joins_last_5min || 0;
    const servedLast5Min = stats.served_last_5min || 0;

    const waitingCount = Object.values(state.users || {}).filter(u => u && u.status === 'waiting').length;
    const counters = Object.values(state.counters || {});
    const idleCounters = counters.filter(c => queueService.counterStatus(c) === 'idle').length;
    const busyCounters = counters.length - idleCounters;
    const openCounters = queueService.countersOpen(state);
    const avgWait = stats.avg_wait_live || 0;

    const surgeThreshold = baseline * settings.surge_multiplier;
    const wasSurging = stats.surge_active === true;
    const surge = joinsLast5Min > surgeThreshold && waitingCount > 0;

    // ── Recommendations (never mutate student order) ─────────────
    const recommendations = [];

    if (waitingCount > 0 && idleCounters > 0) {
      recommendations.push({
        id: 'open_idle_counters', severity: 'info',
        title: `${idleCounters} counter${idleCounters > 1 ? 's' : ''} idle`,
        detail: `${waitingCount} student(s) waiting while ${idleCounters} counter(s) are free. Call the next student.`,
        action: 'call_next',
      });
    }

    if (avgWait > settings.max_wait_minutes && busyCounters > 0 && idleCounters === 0) {
      recommendations.push({
        id: 'add_counter', severity: 'warning',
        title: 'Open an additional counter',
        detail: `Average wait is ~${avgWait} min (target ${settings.max_wait_minutes} min) and all ${busyCounters} counter(s) are busy.`,
        action: 'add_counter',
      });
    }

    if (surge) {
      recommendations.push({
        id: 'limit_joins', severity: 'high',
        title: 'Arrival surge detected',
        detail: `${joinsLast5Min} joins in the last 5 min vs baseline ${baseline}. Consider temporarily limiting new joins or opening counters.`,
        action: 'limit_joins',
      });
    }

    const level = surge ? 'surge' : (avgWait > settings.max_wait_minutes || (waitingCount > openCounters * 4) ? 'busy' : 'normal');

    result.surge_detected = surge;
    result.joins_last_5min = joinsLast5Min;
    result.baseline = baseline;
    result.level = level;
    result.recommendations = recommendations;

    const crowd = {
      level,
      updated_at: Date.now(),
      metrics: {
        waiting_count: waitingCount,
        open_counters: openCounters,
        idle_counters: idleCounters,
        busy_counters: busyCounters,
        avg_wait: avgWait,
        avg_service_time: stats.avg_service_time || 7,
        joins_last_5min: joinsLast5Min,
        served_last_5min: servedLast5Min,
        arrival_baseline: baseline,
      },
      recommendations,
    };

    await db.ref(`queues/${queueId}/stats`).update({
      congestion_level: level,
      surge_active: surge,
      crowd,
    });

    if (io) {
      io.to(`admin_${queueId}`).emit('crowd_alert', crowd);
      if (surge && !wasSurging) {
        io.to(`queue_${queueId}`).emit('surge_alert', {
          message: 'High traffic right now — your wait may be a little longer than predicted.',
          congestion_level: 'surge', joins_last_5min: joinsLast5Min,
        });
      }
    }

    // Optional automation: auto-pause on surge.
    if (surge && settings.auto_pause_on_surge && state.meta.status === 'open') {
      await queueService.setQueueStatus(queueId, 'paused', io, { auto: true, reason: 'surge' });
      console.log(`⏸️  Auto-paused ${queueId} due to surge`);
    }
  } catch (err) {
    console.error('❌ Congestion Oracle error:', err.message);
  }

  return result;
}

module.exports = { runCongestionOracle };
