import { useState, useEffect, useCallback } from 'react';
import { getQueueStatus } from '../utils/api';

/**
 * useQueue — fetches and caches queue status.
 * Re-fetches every 30 seconds as a safety net alongside Socket.io.
 */
export function useQueue(queueId) {
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStatus = useCallback(async () => {
    if (!queueId) return;
    try {
      const data = await getQueueStatus(queueId);
      setQueue(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [queueId]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return { queue, loading, error, refetch: fetchStatus, setQueue };
}
