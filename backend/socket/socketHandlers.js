/**
 * Socket.io Handlers
 * --------------------
 * Manages WebSocket connections for real-time queue updates.
 * Events emitted to clients: queue_update, queue_state, turn_called,
 * turn_approaching, flash_message, surge_alert, crowd_alert, ghost_flag,
 * fraud_alert, user_called, service_completed, user_removed.
 *
 * Targeted events are delivered per-user via the socket registry, so a
 * student never receives another student's alerts.
 */

const { registerUserSocket, unregisterSocket } = require('./registry');

function initSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // ── Student joins a queue room ───────────────────────────────
    socket.on('join_queue_room', ({ queueId, userId } = {}) => {
      if (!queueId) return;
      const roomName = `queue_${queueId}`;
      socket.join(roomName);
      socket.queueId = queueId;
      socket.userId = userId;
      if (userId) {
        registerUserSocket(socket.id, userId, queueId);
        touchLastSeen(queueId, userId);
      }
      console.log(`📱 User ${userId || 'anonymous'} joined room: ${roomName}`);
    });

    // ── Admin joins admin room + queue room ─────────────────────
    socket.on('join_admin_room', ({ queueId } = {}) => {
      if (!queueId) return;
      socket.join(`admin_${queueId}`);
      socket.join(`queue_${queueId}`);
      socket.queueId = queueId;
      socket.isAdmin = true;
      console.log(`🛡️  Admin joined rooms: admin_${queueId} + queue_${queueId}`);
    });

    // ── Student heartbeat ────────────────────────────────────────
    socket.on('heartbeat', ({ queueId, userId } = {}) => {
      if (queueId && userId) touchLastSeen(queueId, userId);
    });

    // ── Student updates GPS location ─────────────────────────────
    socket.on('update_location', ({ queueId, userId, lat, lng } = {}) => {
      if (queueId && userId) {
        const { db } = require('../firebase/init');
        db.ref(`queues/${queueId}/users/${userId}`).update({
          gps_lat: lat, gps_lng: lng, last_seen: Date.now(),
        }).catch(() => {});
      }
    });

    // ── Disconnect ───────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      const info = unregisterSocket(socket.id);
      if (info && info.userId && info.queueId) {
        const { db } = require('../firebase/init');
        db.ref(`queues/${info.queueId}/users/${info.userId}`).update({
          last_seen: Date.now(),
        }).catch(() => {});
      }
      console.log(`🔌 Socket disconnected: ${socket.id} (${reason})`);
    });
  });

  console.log('✅ Socket.io handlers initialised');
}

function touchLastSeen(queueId, userId) {
  const { db } = require('../firebase/init');
  db.ref(`queues/${queueId}/users/${userId}`).update({
    last_seen: Date.now(), last_active: Date.now(),
  }).catch(() => {});
}

module.exports = { initSocketHandlers };
