/**
 * Socket Registry — maps app users to their live socket connections.
 * ----------------------------------------------------------------
 * Enables TARGETED emits (only the relevant student receives their flash /
 * turn-call) and lets monitors know whether a student is currently connected
 * (used for reliable ghost detection instead of client JS timers).
 */

const userSockets = new Map(); // userId -> Set<socketId>
const socketUsers = new Map(); // socketId -> { userId, queueId }

function registerUserSocket(socketId, userId, queueId) {
  if (!socketId || !userId) return;
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socketId);
  socketUsers.set(socketId, { userId, queueId });
}

function unregisterSocket(socketId) {
  const info = socketUsers.get(socketId);
  if (info && info.userId) {
    const set = userSockets.get(info.userId);
    if (set) {
      set.delete(socketId);
      if (set.size === 0) userSockets.delete(info.userId);
    }
  }
  const result = info || null;
  socketUsers.delete(socketId);
  return result;
}

function isUserConnected(userId) {
  const set = userSockets.get(userId);
  return !!(set && set.size > 0);
}

/** Emit an event to all live sockets of a specific user. Returns count sent. */
function emitToUser(io, userId, event, payload) {
  if (!io || !userId) return 0;
  const set = userSockets.get(userId);
  if (!set) return 0;
  let n = 0;
  for (const sid of set) {
    io.to(sid).emit(event, payload);
    n++;
  }
  return n;
}

module.exports = { registerUserSocket, unregisterSocket, isUserConnected, emitToUser };
