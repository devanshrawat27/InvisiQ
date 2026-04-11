/**
 * Socket.io Handlers
 * --------------------
 * Manages WebSocket connections for real-time queue updates.
 * Events: queue_update, surge_alert, ghost_flag, turn_called, fraud_alert, flash_message
 */

/**
 * Initialize Socket.io event handlers.
 * @param {object} io — Socket.io server instance
 */
function initSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // ── Student joins a queue room ───────────────────────────────
    socket.on('join_queue_room', ({ queueId, userId }) => {
      const roomName = `queue_${queueId}`;
      socket.join(roomName);
      socket.queueId = queueId;
      socket.userId = userId;
      console.log(`📱 User ${userId || 'anonymous'} joined room: ${roomName}`);
    });

    // ── Admin joins admin room ───────────────────────────────────
    socket.on('join_admin_room', ({ queueId }) => {
      const roomName = `admin_${queueId}`;
      socket.join(roomName);
      socket.queueId = queueId;
      socket.isAdmin = true;
      console.log(`🛡️  Admin joined room: ${roomName}`);
    });

    // ── Student heartbeat (updates last_active for Ghost Buster) ─
    socket.on('heartbeat', ({ queueId, userId }) => {
      // This will be picked up by the Ghost Buster to update last_active
      if (queueId && userId) {
        const { db } = require('../firebase/init');
        db.ref(`queues/${queueId}/users/${userId}`).update({
          last_active: Date.now(),
        }).catch(() => {}); // Silent fail — non-critical
      }
    });

    // ── Student updates GPS location ─────────────────────────────
    socket.on('update_location', ({ queueId, userId, lat, lng }) => {
      if (queueId && userId) {
        const { db } = require('../firebase/init');
        db.ref(`queues/${queueId}/users/${userId}`).update({
          gps_lat: lat,
          gps_lng: lng,
          last_active: Date.now(),
        }).catch(() => {});
      }
    });

    // ── Disconnect ───────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`🔌 Socket disconnected: ${socket.id} (${reason})`);
    });
  });

  console.log('✅ Socket.io handlers initialised');
}

module.exports = { initSocketHandlers };
