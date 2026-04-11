/**
 * Ghost Buster — No-Show Detection Monitor
 * -------------------------------------------
 * Detects users likely to abandon the queue.
 * Auto-skips users with bail_probability > 85.
 * Sends flash alert at > 60.
 *
 * Formula:
 *   bail_probability = (inactivity_minutes × 3) + (gps_drift_km × 10)
 *                    + (history_noshows × 20) + (wait_exceeded_ratio × 15)
 *
 * AI Usage: NONE — Pure algorithmic scoring.
 */

const { db } = require('../firebase/init');

/**
 * Run Ghost Buster scan on all waiting users in a queue.
 * @param {string} queueId
 * @param {object} io — Socket.io server instance
 * @returns {object} { scanned, flagged, removed, alerts[] }
 */
async function runGhostBuster(queueId, io) {
  const result = { scanned: 0, flagged: 0, removed: 0, alerts: [] };

  try {
    const usersRef = db.ref(`queues/${queueId}/users`);
    const snapshot = await usersRef.get();

    if (!snapshot.exists()) return result;

    const users = snapshot.val();
    const now = Date.now();

    for (const [userId, user] of Object.entries(users)) {
      if (user.status !== 'waiting') continue;
      result.scanned++;

      // ── Calculate bail probability ──────────────────────────────
      const lastActive = user.last_active || user.join_time || now;
      const inactivityMinutes = (now - lastActive) / (1000 * 60);

      // GPS drift (if available)
      const gpsDriftKm = 0; // Default: no GPS data available

      // Historical no-shows (from user profile if available)
      const historyNoshows = user.history_noshows || 0;

      // Wait exceeded ratio
      const expectedWait = user.wait_predicted || 10;
      const actualWait = (now - (user.join_time || now)) / (1000 * 60);
      const waitExceededRatio = expectedWait > 0 ? actualWait / expectedWait : 0;

      // ── Score formula ───────────────────────────────────────────
      const bailProbability = Math.min(100, Math.round(
        (inactivityMinutes * 3) +
        (gpsDriftKm * 10) +
        (historyNoshows * 20) +
        (waitExceededRatio * 15)
      ));

      // Update user's bail_probability in DB
      await db.ref(`queues/${queueId}/users/${userId}`).update({
        bail_probability: bailProbability,
      });

      // ── Flash Alert: Score 60–85 ────────────────────────────────
      if (bailProbability > 60 && bailProbability <= 85) {
        result.flagged++;

        // Throttle: only send if last flash was > 2 min ago
        const lastFlash = user.last_flash_sent || 0;
        if (now - lastFlash > 2 * 60 * 1000) {
          const alert = {
            type: 'ghost_warning',
            userId,
            userName: user.name,
            bail_probability: bailProbability,
            flash_message: `We noticed you may have stepped away. Your spot is held for 2 more minutes.`,
          };

          result.alerts.push(alert);

          // Emit flash message to that user's session
          if (io) {
            io.to(`queue_${queueId}`).emit('flash_message', {
              target_user: userId,
              message: alert.flash_message,
              type: 'warning',
              duration: 8000,
            });

            // Notify admin
            io.to(`admin_${queueId}`).emit('ghost_flag', {
              userId,
              userName: user.name,
              bail_probability: bailProbability,
            });
          }

          await db.ref(`queues/${queueId}/users/${userId}`).update({
            last_flash_sent: now,
          });
        }
      }

      // ── Auto-Remove: Score > 85 ─────────────────────────────────
      if (bailProbability > 85) {
        result.removed++;

        const alert = {
          type: 'ghost_removed',
          userId,
          userName: user.name,
          bail_probability: bailProbability,
        };
        result.alerts.push(alert);

        // Remove user from queue
        await db.ref(`queues/${queueId}/users/${userId}`).update({
          status: 'removed',
          removed_reason: 'ghost_buster_auto',
          removed_at: now,
        });

        // Emit to all clients
        if (io) {
          io.to(`queue_${queueId}`).emit('queue_update', {
            action: 'user_removed',
            userId,
            reason: 'no_show_detected',
          });

          io.to(`admin_${queueId}`).emit('ghost_flag', {
            userId,
            userName: user.name,
            bail_probability: bailProbability,
            action: 'auto_removed',
          });
        }

        console.log(`👻 Ghost Buster: Removed ${user.name} (bail: ${bailProbability}%)`);
      }
    }
  } catch (err) {
    console.error('❌ Ghost Buster error:', err.message);
  }

  return result;
}

module.exports = { runGhostBuster };
