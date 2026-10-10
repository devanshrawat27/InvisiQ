/**
 * Ghost Buster — abandoned-student detection (advisory by default)
 * -----------------------------------------------------------------
 * Uses real socket presence (registry) plus last_seen instead of fragile
 * client JS timers, so a backgrounded mobile tab is NOT removed.
 *
 * Default behaviour: FLAG only (admin sees a warning).
 * Auto-removal happens ONLY when the queue sets settings.auto_remove_ghosts.
 */

const { db } = require('../firebase/init');
const { isUserConnected } = require('../socket/registry');
const queueService = require('../services/queueService');

async function runGhostBuster(queueId, io) {
  const result = { scanned: 0, flagged: 0, removed: 0, alerts: [] };

  try {
    const state = await queueService.loadState(queueId);
    if (!state.meta) return result;
    if (state.meta.status === 'paused' || state.meta.status === 'closed') return result;

    const settings = queueService.getSettings(state.meta);
    const grace = Math.max(5, settings.ghost_grace_minutes || 15);
    const now = Date.now();

    for (const [userId, user] of Object.entries(state.users || {})) {
      if (!user || user.status !== 'waiting') continue;
      if (userId.startsWith('demo_')) continue;

      result.scanned++;

      const connected = isUserConnected(userId);
      const last = user.last_seen || user.last_active || user.join_time || now;
      const awayMinutes = (now - last) / 60000;
      const history = user.history_noshows || 0;

      let bail;
      if (connected) {
        bail = 0;
      } else {
        const ratio = awayMinutes / grace;
        bail = Math.min(100, Math.round(ratio * 70) + history * 20);
      }

      await db.ref(`queues/${queueId}/users/${userId}`).update({ bail_probability: bail });

      // Advisory flag
      if (bail > 60 && bail <= 85) {
        result.flagged++;
        const lastFlash = user.last_flash_sent || 0;
        if (now - lastFlash > 2 * 60 * 1000) {
          result.alerts.push({ type: 'ghost_warning', userId, userName: user.name, bail_probability: bail });
          if (io) {
            io.to(`admin_${queueId}`).emit('ghost_flag', { userId, userName: user.name, bail_probability: bail });
          }
          await db.ref(`queues/${queueId}/users/${userId}`).update({ last_flash_sent: now });
        }
      }

      // Auto-removal (opt-in only)
      if (settings.auto_remove_ghosts && bail > 85) {
        await queueService.markNoShow(queueId, userId, 'ghost_buster_auto', io, 'ghost');
        result.removed++;
      }
    }
  } catch (err) {
    console.error('❌ Ghost Buster error:', err.message);
  }

  return result;
}

module.exports = { runGhostBuster };
