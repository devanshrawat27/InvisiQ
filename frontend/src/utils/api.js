// Use empty string in dev (Vite proxy handles /api/* → localhost:5000)
// In production, set VITE_BACKEND_URL to the deployed backend URL
const BACKEND = import.meta.env.PROD ? (import.meta.env.VITE_BACKEND_URL || '') : '';

/**
 * Generic fetch wrapper with error handling.
 */
async function apiFetch(path, options = {}) {
  const url = `${BACKEND}${path}`;
  const { headers: optHeaders, ...rest } = options;
  const config = {
    headers: { 'Content-Type': 'application/json', ...optHeaders },
    ...rest,
  };

  const res = await fetch(url, config);

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const err = new Error(body.message || 'Request failed');
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return res.json();
}

/* ─── Queue (Student) endpoints ───────────────────────────────────── */

export function getQueueStatus(queueId) {
  return apiFetch(`/api/v1/queue/${queueId}/status`);
}

export function joinQueue(queueId, data) {
  return apiFetch(`/api/v1/queue/${queueId}/join`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getUserPosition(queueId, userId) {
  return apiFetch(`/api/v1/queue/${queueId}/position/${userId}`);
}

export function getQueueUsers(queueId) {
  return apiFetch(`/api/v1/queue/${queueId}/users`);
}

/* ─── Admin endpoints ─────────────────────────────────────────────── */

function adminHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export function markAttended(queueId, userId, token) {
  return apiFetch(`/api/v1/admin/queue/${queueId}/attended/${userId}`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
}

export function markRemoved(queueId, userId, token, reason = 'not_present') {
  return apiFetch(`/api/v1/admin/queue/${queueId}/removed/${userId}`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ reason }),
  });
}

export function markDone(queueId, userId, token) {
  return apiFetch(`/api/v1/admin/queue/${queueId}/done/${userId}`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
}

export function getBriefing(queueId, token) {
  return apiFetch(`/api/v1/admin/queue/${queueId}/briefing`, {
    headers: adminHeaders(token),
  });
}

export function pauseQueue(queueId, token) {
  return apiFetch(`/api/v1/admin/queue/${queueId}/pause`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
}

export function resumeQueue(queueId, token) {
  return apiFetch(`/api/v1/admin/queue/${queueId}/resume`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
}

export function seedQueue(queueId, token) {
  return apiFetch(`/api/v1/admin/queue/${queueId}/seed`, {
    method: 'POST',
    headers: adminHeaders(token),
  });
}

export function callNextUser(queueId, token, counterId = 'counter_1') {
  return apiFetch(`/api/v1/admin/queue/${queueId}/next`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ counter_id: counterId, source: 'admin_manual' }),
  });
}

/* ─── Document Requirements endpoints ────────────────────────────── */

export function getRequirements(queueId) {
  return apiFetch(`/api/v1/queue/${queueId}/requirements`);
}

export function saveRequirements(queueId, requirements, token) {
  return apiFetch(`/api/v1/admin/queue/${queueId}/requirements`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ requirements }),
  });
}

/* ─── Analytics endpoint ─────────────────────────────────────────── */

export function getAnalytics(queueId, token) {
  return apiFetch(`/api/v1/admin/queue/${queueId}/analytics`, {
    headers: adminHeaders(token),
  });
}

/* ─── Counter management ─────────────────────────────────────────── */

export function updateCounters(queueId, action, token) {
  return apiFetch(`/api/v1/admin/queue/${queueId}/counters`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ action }),
  });
}
