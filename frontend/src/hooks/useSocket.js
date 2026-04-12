import { useEffect, useRef } from 'react';
import io from 'socket.io-client';

// In dev, connect to current origin (Vite proxies /socket.io → backend:5000)
// In production, connect to the deployed backend URL
const SOCKET_URL = import.meta.env.PROD
  ? (import.meta.env.VITE_SOCKET_URL || window.location.origin)
  : window.location.origin;

/**
 * useSocket — manages Socket.io connection lifecycle.
 * Connects on mount, joins the queue room, binds handlers, disconnects on unmount.
 *
 * Uses a ref pattern for handlers to avoid stale closures —
 * handlers always call the LATEST version without reconnecting the socket.
 *
 * @param {string} queueId — queue to join
 * @param {string|null} userId — current user ID (for heartbeats)
 * @param {Object} handlers — { eventName: handlerFn } map
 * @param {boolean} isAdmin — join admin room instead
 */
export function useSocket(queueId, userId, handlers, isAdmin = false) {
  const socketRef = useRef(null);
  const handlersRef = useRef(handlers);

  // Always keep handlersRef up-to-date with the latest handlers
  // This avoids stale closures without triggering socket reconnection
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!queueId) return;

    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('🔌 Socket connected:', socket.id);

      // Join the appropriate room — matches backend socketHandlers.js
      if (isAdmin) {
        socket.emit('join_admin_room', { queueId });
      } else {
        socket.emit('join_queue_room', { queueId, userId });
      }
    });

    // Build stable wrapper functions that delegate to the latest handlers via ref.
    // This means the socket listeners never change, but they always call fresh handlers.
    const boundEvents = {};
    if (handlersRef.current) {
      Object.keys(handlersRef.current).forEach((event) => {
        const wrapper = (...args) => {
          if (handlersRef.current && handlersRef.current[event]) {
            handlersRef.current[event](...args);
          }
        };
        boundEvents[event] = wrapper;
        socket.on(event, wrapper);
      });
    }

    // Heartbeat every 30s (for Ghost Buster)
    let heartbeatInterval;
    if (!isAdmin && userId) {
      heartbeatInterval = setInterval(() => {
        socket.emit('heartbeat', { queueId, userId });
      }, 30000);
    }

    return () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      Object.entries(boundEvents).forEach(([event, fn]) => {
        socket.off(event, fn);
      });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [queueId, userId, isAdmin]);

  return socketRef;
}
