/**
 * Queue Helpers — Shared Utility Functions
 * ------------------------------------------
 * Reusable helpers used across routes and monitors.
 */

const { db } = require('../firebase/init');

/**
 * Recalculate positions AND wait times for all active (waiting) users in a queue.
 * Called after any removal, skip, or service completion.
 * Maintains urgency-based ordering (desc) with FIFO tiebreak.
 *
 * Also sends a targeted flash message to the new #1 user to let them know
 * the person ahead was just served.
 *
 * @param {string} queueId
 * @param {object} [io] — Socket.io server instance (optional, for flash messages)
 */
async function recalcPositions(queueId, io) {
  try {
    const usersRef = db.ref(`queues/${queueId}/users`);
    const snapshot = await usersRef.get();

    if (!snapshot.exists()) return;

    const users = snapshot.val();

    // Get avg_service_time from stats
    const statsRef = db.ref(`queues/${queueId}/stats`);
    const statsSnap = await statsRef.get();
    const stats = statsSnap.exists() ? statsSnap.val() : {};
    const avgServiceTime = stats.avg_service_time || 7;

    const metaRef = db.ref(`queues/${queueId}/meta`);
    const metaSnap = await metaRef.get();
    const meta = metaSnap.exists() ? metaSnap.val() : {};
    const countersOpen = meta.counters_open || 1;

    // Collect all waiting users
    const waitingUsers = Object.entries(users)
      .filter(([, u]) => u.status === 'waiting')
      .map(([id, u]) => ({
        userId: id,
        urgencyScore: u.urgency_score || 0,
        joinTime: u.join_time || 0,
        oldPosition: u.position || 999,
      }));

    // Sort by urgency (desc), then join time (asc / FIFO)
    waitingUsers.sort((a, b) => {
      if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
      return a.joinTime - b.joinTime;
    });

    // Assign new positions AND recalculated wait times
    for (let i = 0; i < waitingUsers.length; i++) {
      const newPosition = i + 1;
      const peopleAhead = newPosition - 1;
      const estimatedWait = Math.round((peopleAhead * avgServiceTime) / countersOpen);

      await db.ref(`queues/${queueId}/users/${waitingUsers[i].userId}`).update({
        position: newPosition,
        wait_predicted: estimatedWait,
      });

      waitingUsers[i].newPosition = newPosition;
    }

    // Update stats
    await db.ref(`queues/${queueId}/stats`).update({
      current_count: waitingUsers.length,
      avg_wait_live: waitingUsers.length > 0
        ? Math.round(((waitingUsers.length - 1) * avgServiceTime) / countersOpen)
        : 0,
    });

    // Send targeted flash to the person who is now #1
    // (only if they weren't already #1 — i.e. they just moved up)
    if (io && waitingUsers.length > 0) {
      const newFirst = waitingUsers[0];
      if (newFirst.oldPosition > 1) {
        io.to(`queue_${queueId}`).emit('flash_message', {
          target_user: newFirst.userId,
          message: `The person ahead of you was just served. You are now #1 — please make your way to the counter!`,
          type: 'urgent',
          duration: 12000,
        });
      }

      // Also notify other users who moved up
      for (let i = 1; i < waitingUsers.length; i++) {
        const u = waitingUsers[i];
        if (u.newPosition < u.oldPosition) {
          const newWait = Math.round(((u.newPosition - 1) * avgServiceTime) / countersOpen);
          io.to(`queue_${queueId}`).emit('flash_message', {
            target_user: u.userId,
            message: `You moved up! Now #${u.newPosition} in queue. Estimated wait: ~${newWait} min.`,
            type: 'info',
            duration: 8000,
          });
        }
      }

      // Emit queue_update so all student screens refresh
      io.to(`queue_${queueId}`).emit('queue_update', {
        action: 'positions_recalculated',
        count: waitingUsers.length,
        avg_wait: waitingUsers.length > 0
          ? Math.max(1, Math.round((waitingUsers.length * avgServiceTime) / countersOpen))
          : 0,
      });
    }
  } catch (err) {
    console.error('❌ recalcPositions error:', err.message);
  }
}

module.exports = { recalcPositions };
