import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getQueueStatus, getUserPosition } from '../utils/api';
import { useSocket } from './useSocket';

/**
 * useQueueState — single source for a student's live queue view.
 * Merges the REST snapshot(s) with targeted socket events, and exposes a
 * derived `phase` for the waiting-room UI:
 *   waiting → almost → next → called → in_service → served | removed
 */
export function useQueueState(queueId, userId) {
  const [status, setStatus] = useState(null);
  const [me, setMe] = useState(null);
  const [flash, setFlash] = useState(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const flashTimer = useRef(null);
  const lastRefresh = useRef(0);
  const markLoadedUser = useRef(false);

  const refresh = useCallback(async () => {
    if (!queueId) return;
    lastRefresh.current = Date.now();
    // Fetch independently: a queue-status hiccup must NEVER mark the student removed.
    const [qRes, uRes] = await Promise.allSettled([
      getQueueStatus(queueId),
      userId ? getUserPosition(queueId, userId) : Promise.resolve(null),
    ]);

    if (qRes.status === 'fulfilled') {
      setStatus(qRes.value);
      setError(null);
    } else if (!qRes.reason?.status || qRes.reason.status >= 500) {
      setError(qRes.reason?.message || 'Unable to load queue');
    }

    if (uRes.status === 'fulfilled' && uRes.value) {
      setMe(uRes.value);
      markLoadedUser.current = true;
    } else if (uRes.status === 'rejected' && uRes.reason?.status === 404 && userId) {
      // Only the student's OWN record being missing means they left the queue.
      setMe((p) => ({ ...(p || {}), status: 'removed' }));
    }

    setLoading(false);
  }, [queueId, userId]);

  // Throttled refresh for socket chatter (max once per 2.5s)
  const refreshThrottled = useCallback(() => {
    if (Date.now() - lastRefresh.current > 2500) refresh();
  }, [refresh]);

  const showFlash = useCallback((data) => {
    if (data?.target_user && data.target_user !== 'all' && userId && data.target_user !== userId) return;
    setFlash({ message: data.message, type: data.type || 'info' });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), data.duration || 6000);
  }, [userId]);

  const handlers = useMemo(() => ({
    connect: () => setConnected(true),
    disconnect: () => setConnected(false),
    queue_update: refreshThrottled,
    queue_state: refreshThrottled,
    flash_message: showFlash,
    turn_called: (d) => {
      if (!userId || d.userId === userId || d.token === (me && me.token)) {
        setMe((p) => ({ ...(p || {}), status: 'called', counter_id: d.counter || p?.counter_id, counter_label: d.counter_label || p?.counter_label }));
        setFlash({ message: `Your turn! Please go to ${d.counter_label || d.counter}.`, type: 'turn_called' });
      }
    },
    turn_approaching: (d) => {
      if (!userId || d.userId === userId) {
        setFlash({ message: "You're almost next — please head to the office.", type: 'warning' });
      }
    },
    surge_alert: () => setFlash({ message: 'High traffic right now — your wait may be a little longer.', type: 'warning' }),
  }), [refreshThrottled, showFlash, userId, me]);

  useSocket(queueId, userId, handlers);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 15000);
    return () => clearInterval(iv);
  }, [refresh]);

  const phase = useMemo(() => {
    const s = me?.status;
    if (!s) return 'loading';
    if (s === 'served' || s === 'removed') return s;
    if (s === 'called' || s === 'in_service') return s;
    const ahead = me.ahead ?? Math.max(0, (me.position || 1) - 1);
    if (ahead === 0) return 'next';
    if (ahead <= 2) return 'almost';
    return 'waiting';
  }, [me]);

  return { status, me, phase, flash, connected, error, loading, refresh };
}
