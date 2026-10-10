/**
 * Admin Routes — /api/v1/admin/*
 * ---------------------------------
 * All admin-facing endpoints.
 *
 * Endpoints:
 *   POST /admin/queue/:id/attended/:userId  — Mark user as physically present
 *   POST /admin/queue/:id/removed/:userId   — Mark user as not present
 *   POST /admin/queue/:id/done/:userId      — Service completed
 *   GET  /admin/queue/:id/briefing          — Get AI morning briefing
 *   POST /admin/briefing/trigger            — Manually trigger briefing
 *   POST /admin/queue/create                — Create a new queue
 */

const express = require('express');
const router = express.Router();

const { db, firestore } = require('../firebase/init');
const { requireAdmin } = require('../middleware/auth');
const { checkCellAccess } = require('../middleware/jwtAuth');
const queueService = require('../services/queueService');
const { startMonitorLoop } = require('../jobs/monitorLoop');
const { generateBriefingForQueue } = require('../jobs/nightlyBriefing');
const { dateKey, parseDateKey } = require('../utils/dates');

// ─── Apply admin auth middleware to ALL routes in this router ────────────────
router.use(requireAdmin);

// ─── Enforce per-cell authorization on every route that targets a queue ──────
// cell_admin accounts may only manage their assigned cells; super_admin sees all.
router.param('id', (req, res, next) => checkCellAccess(req, res, next));

/**
 * POST /admin/queue/:id/attended/:userId
 * Admin marks a called user as physically present (starts service).
 */
router.post('/queue/:id/attended/:userId', async (req, res) => {
  try {
    const { id: queueId, userId } = req.params;
    const { counter_id } = req.body;
    const io = req.app.get('io');

    const result = await queueService.markArrived(queueId, userId, counter_id, io);
    if (!result.ok) {
      const code = result.reason === 'no_user' ? 404 : 400;
      return res.status(code).json({ error: result.reason, status: result.status });
    }
    return res.json({ status: 'in_service', user: result.user, counter: result.counter, service_started_at: Date.now() });
  } catch (err) {
    console.error('❌ Attended error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/queue/:id/removed/:userId
 * Admin marks a user as not present (no-show). Optionally auto-advances.
 */
router.post('/queue/:id/removed/:userId', async (req, res) => {
  try {
    const { id: queueId, userId } = req.params;
    const { reason } = req.body;
    const io = req.app.get('io');

    const result = await queueService.markNoShow(queueId, userId, reason || 'not_present', io, 'admin');
    if (!result.ok) {
      const code = result.reason === 'no_user' ? 404 : 400;
      return res.status(code).json({ error: result.reason, status: result.status });
    }
    const status = await queueService.getStatus(queueId);
    return res.json({
      removed_user: userId,
      reason: reason || 'not_present',
      auto_advance_triggered: !!result.next_user,
      next_user: result.next_user ? result.next_user.name : null,
      waiting_count: status.waiting_count,
    });
  } catch (err) {
    console.error('❌ Removed error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/queue/:id/done/:userId
 * Admin marks service as complete. Optionally auto-advances.
 */
router.post('/queue/:id/done/:userId', async (req, res) => {
  try {
    const { id: queueId, userId } = req.params;
    const io = req.app.get('io');

    const result = await queueService.markComplete(queueId, userId, io);
    if (!result.ok) {
      const code = result.reason === 'no_user' ? 404 : 400;
      return res.status(code).json({ error: result.reason, status: result.status });
    }
    return res.json({
      logged: true,
      auto_advance_triggered: !!result.next_user,
      next_user: result.next_user ? result.next_user.name : null,
    });
  } catch (err) {
    console.error('❌ Done error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /admin/queue/:id/briefing
 * Fetch today's AI-generated morning briefing.
 */
router.get('/queue/:id/briefing', async (req, res) => {
  try {
    const queueId = req.params.id;
    const today = dateKey();

    // Try to get from Firestore
    try {
      const briefingDoc = await firestore
        .collection('queue_learning')
        .doc(`${queueId}_${today}`)
        .get();

      if (briefingDoc.exists) {
        const data = briefingDoc.data();
        if (data.ai_briefing) {
          return res.json({
            ...data.ai_briefing,
            generated_at: data.briefing_generated_at || data.ai_briefing.generated_at,
            source: 'firestore',
          });
        }
      }
    } catch (e) {
      // Fall through to mock
    }

    // Return null if no AI briefing exists yet (no dummy data)
    return res.json(null);
  } catch (err) {
    console.error('❌ Briefing error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/briefing/trigger
 * Manually trigger AI briefing generation.
 */
router.post('/briefing/trigger', async (req, res) => {
  try {
    const queueId = req.body.queue_id || 'fee_cell';
    const today = dateKey();

    // Cell admins may only trigger briefings for cells they own.
    const isSuper = req.user.role === 'super_admin' || (req.user.cells || []).includes('*');
    if (!isSuper && !(req.user.cells || []).includes(queueId)) {
      return res.status(403).json({ error: 'Access Denied', message: `You don't have access to ${queueId}.` });
    }

    // Generate the briefing from real recorded service history for today.
    await generateBriefingForQueue(queueId, today);

    const doc = await firestore
      .collection('queue_learning')
      .doc(`${queueId}_${today}`)
      .get();

    if (!doc.exists || !doc.data().ai_briefing) {
      return res.status(422).json({
        error: 'No data',
        message: 'No service history is available to generate a briefing yet.',
      });
    }

    const saved = doc.data();
    return res.json({
      ...saved.ai_briefing,
      generated_at: saved.briefing_generated_at || new Date().toISOString(),
      source: 'ai_generated',
    });
  } catch (err) {
    console.error('❌ Briefing trigger error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/queue/create
 * Create a new queue with initial configuration.
 */
router.post('/queue/create', async (req, res) => {
  try {
    const { queue_id, name, type, counters_open } = req.body;

    if (req.user.role !== 'super_admin' && !(req.user.cells || []).includes('*')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only super admins can create new queues.',
      });
    }

    if (!queue_id || !name) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'queue_id and name are required.',
      });
    }

    const queueId = queue_id;
    const now = Date.now();

    // Create queue metadata
    await db.ref(`queues/${queueId}/meta`).set({
      name,
      type: type || queueId,
      counters_open: counters_open || 1,
      status: 'open',
      created_at: now,
      admin_uid: req.user.username,
      settings: {
        auto_advance: false,
        urgency_enabled: false,
        auto_remove_ghosts: false,
        auto_pause_on_surge: false,
        limit_joins_on_surge: false,
        ghost_grace_minutes: 15,
        surge_multiplier: 2.5,
        max_wait_minutes: 45,
      },
    });

    // Initialize stats
    await db.ref(`queues/${queueId}/stats`).set({
      current_count: 0,
      waiting_count: 0,
      in_service_count: 0,
      avg_wait_live: 0,
      congestion_level: 'normal',
      joins_last_5min: 0,
      served_last_5min: 0,
      surge_active: false,
      avg_service_time: 7,
      total_served: 0,
      total_joined: 0,
      token_seq: 0,
    });

    // Initialize counters
    const numCounters = counters_open || 1;
    for (let i = 1; i <= numCounters; i++) {
      await db.ref(`queues/${queueId}/counters/counter_${i}`).set({
        label: `Counter ${i}`,
        status: 'idle',
        supported_types: [],
        current_user_id: null,
        service_started_at: null,
        expected_finish: null,
        queue_length: 0,
        auto_advance_timeout: null,
      });
    }

    console.log(`📋 Queue created: ${name} (${queueId})`);

    // Start monitor loop for the new queue
    const io = req.app.get('io');
    if (io) {
      startMonitorLoop(queueId, io);
    }

    return res.status(201).json({
      queue_id: queueId,
      name,
      type: type || queueId,
      counters_open: numCounters,
      status: 'open',
    });
  } catch (err) {
    console.error('❌ Queue create error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/queue/:id/call-next
 * Call the next student to a counter (manual queue movement).
 * Body: { counter_id, source? }
 */
router.post('/queue/:id/call-next', async (req, res) => {
  try {
    const queueId = req.params.id;
    const { counter_id, source } = req.body;
    const io = req.app.get('io');
    const counterId = counter_id || 'counter_1';

    const result = await queueService.callNext(queueId, counterId, io, source || 'admin_manual');
    if (!result.ok) {
      const messages = {
        unknown_counter: 'That counter does not exist.',
        counter_in_service: 'That counter is currently serving a student.',
        counter_busy: 'That counter already has a student called.',
        empty: 'No students are waiting.',
      };
      return res.status(409).json({ error: result.reason, message: messages[result.reason] || 'Unable to call next.' });
    }
    return res.json(result);
  } catch (err) {
    console.error('❌ Call-next error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/** Internal auto-advance (kept for tooling/tests). */
router.post('/queue/:id/next', async (req, res) => {
  try {
    const queueId = req.params.id;
    const { counter_id, source } = req.body;
    const io = req.app.get('io');
    const counterId = counter_id || 'counter_1';
    const result = await queueService.callNext(queueId, counterId, io, source || 'auto_advance');
    return res.json(result);
  } catch (err) {
    console.error('❌ Auto-advance error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /admin/queue/:id/settings  — read queue settings
 * POST /admin/queue/:id/settings — update queue settings / crowd automation toggles
 */
router.get('/queue/:id/settings', async (req, res) => {
  try {
    const queueId = req.params.id;
    const snap = await db.ref(`queues/${queueId}/meta/settings`).get();
    return res.json({ settings: queueService.getSettings({ settings: snap.exists() ? snap.val() : {} }) });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

router.post('/queue/:id/settings', async (req, res) => {
  try {
    const queueId = req.params.id;
    const io = req.app.get('io');
    const body = req.body || {};
    const allowed = ['auto_advance', 'urgency_enabled', 'auto_remove_ghosts', 'auto_pause_on_surge', 'limit_joins_on_surge'];
    const numeric = ['ghost_grace_minutes', 'surge_multiplier', 'max_wait_minutes'];
    const patch = {};
    for (const k of allowed) if (k in body) patch[k] = body[k] === true;
    for (const k of numeric) if (Number.isFinite(body[k])) patch[k] = body[k];
    const merged = await queueService.updateSettings(queueId, patch, io);
    return res.json({ settings: queueService.getSettings({ settings: merged }) });
  } catch (err) {
    console.error('❌ Settings update error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/queue/:id/pause
 * Pause a queue — no new joins accepted.
 */
router.post('/queue/:id/pause', async (req, res) => {
  try {
    const queueId = req.params.id;
    const io = req.app.get('io');
    await queueService.setQueueStatus(queueId, 'paused', io);
    return res.json({ status: 'paused', queue_id: queueId });
  } catch (err) {
    console.error('❌ Pause error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/queue/:id/resume
 * Resume a paused queue.
 */
router.post('/queue/:id/resume', async (req, res) => {
  try {
    const queueId = req.params.id;
    const io = req.app.get('io');
    await queueService.setQueueStatus(queueId, 'open', io);
    return res.json({ status: 'open', queue_id: queueId });
  } catch (err) {
    console.error('❌ Resume error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/queue/:id/close
 * Close a queue entirely — no new joins accepted.
 */
router.post('/queue/:id/close', async (req, res) => {
  try {
    const queueId = req.params.id;
    const io = req.app.get('io');
    await queueService.setQueueStatus(queueId, 'closed', io);
    return res.json({ status: 'closed', queue_id: queueId });
  } catch (err) {
    console.error('❌ Close error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/queue/:id/requirements
 * Save document requirements for a queue.
 * Body: { requirements: [{ name: "Fee Receipt", photo_url: "..." }, ...] }
 */
router.post('/queue/:id/requirements', async (req, res) => {
  try {
    const queueId = req.params.id;
    const { requirements } = req.body;

    if (!Array.isArray(requirements)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'requirements must be an array of { name, photo_url } objects.',
      });
    }

    // Validate each requirement
    const cleanReqs = requirements.map((r, i) => ({
      name: (r.name || '').trim().slice(0, 100),
      photo_url: r.photo_url || null,
    })).filter(r => r.name.length > 0);

    // Save to Firebase RT DB under queue meta
    await db.ref(`queues/${queueId}/meta/requirements`).set(cleanReqs);

    console.log(`📋 Requirements updated for ${queueId}: ${cleanReqs.length} items`);

    return res.json({
      saved: true,
      queue_id: queueId,
      count: cleanReqs.length,
      requirements: cleanReqs,
    });
  } catch (err) {
    console.error('❌ Requirements save error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/queue/:id/counters
 * Add or remove a counter dynamically.
 * Body: { action: 'add' | 'remove', counter_id?, label?, supported_types? }
 */
router.post('/queue/:id/counters', async (req, res) => {
  try {
    const queueId = req.params.id;
    const { action, counter_id, label, supported_types } = req.body;
    const io = req.app.get('io');

    if (!['add', 'remove', 'update'].includes(action)) {
      return res.status(400).json({ error: 'Validation failed', message: "action must be 'add', 'remove', or 'update'." });
    }

    if (action === 'add') {
      const r = await queueService.addCounter(queueId, io, { label, supported_types });
      if (!r.ok) return res.status(400).json({ error: r.reason });
      return res.json({ action: 'add', added: r.counter_id });
    }

    if (action === 'update') {
      if (!counter_id) return res.status(400).json({ error: 'counter_id is required for update' });
      const patch = {};
      if (typeof label === 'string') patch.label = label.trim().slice(0, 40);
      if (Array.isArray(supported_types)) patch.supported_types = supported_types.map(s => String(s).trim().toLowerCase()).filter(Boolean);
      await db.ref(`queues/${queueId}/counters/${counter_id}`).update(patch);
      if (io) io.to(`admin_${queueId}`).emit('queue_update', { action: 'counter_updated', counter_id });
      return res.json({ action: 'update', counter_id, ...patch });
    }

    // remove
    if (!counter_id) return res.status(400).json({ error: 'counter_id is required for remove' });
    const r = await queueService.removeCounter(queueId, counter_id, io);
    if (!r.ok) {
      const msg = r.reason === 'last_counter'
        ? 'At least one counter must remain open.'
        : r.reason === 'counter_busy' ? 'Counter is currently serving a student.' : r.reason;
      return res.status(400).json({ error: 'Cannot remove', message: msg });
    }
    return res.json({ action: 'remove', removed: counter_id, counters_open: r.counters_open });
  } catch (err) {
    console.error('❌ Counter update error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /admin/queue/:id/analytics?range=today|week|month
 * Returns real analytics data: total served, no-show rate, hourly traffic,
 * wait time accuracy (predicted vs actual), intent breakdown, and efficiency score.
 * Supports historical ranges via the `range` query parameter.
 */
router.get('/queue/:id/analytics', async (req, res) => {
  try {
    const queueId = req.params.id;
    const range = req.query.range || 'today'; // today | week | month
    const today = dateKey();
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Compute date range based on range param
    let lookbackDays = 1;
    let rangeLabel = 'Today';
    if (range === 'week') { lookbackDays = 7; rangeLabel = 'This Week'; }
    else if (range === 'month') { lookbackDays = 30; rangeLabel = 'This Month'; }

    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - lookbackDays + 1);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeStartStr = dateKey(rangeStart);

    // ── 1. Fetch RT DB stats ──────────────────────────────────────
    const statsSnap = await db.ref(`queues/${queueId}/stats`).get();
    const stats = statsSnap.exists() ? statsSnap.val() : {};

    // ── 2. Count active users from RT DB ──────────────────────────
    const usersSnap = await db.ref(`queues/${queueId}/users`).get();
    let activeCount = 0;
    let waitingCount = 0;
    let calledCount = 0;
    const intentCounts = {};

    if (usersSnap.exists()) {
      const usersObj = usersSnap.val();
      for (const [uid, u] of Object.entries(usersObj)) {
        if (['waiting', 'called', 'in_service'].includes(u.status)) {
          activeCount++;
          if (u.status === 'waiting') waitingCount++;
          if (u.status === 'called' || u.status === 'in_service') calledCount++;
        }
        if (u.intent_category) {
          intentCounts[u.intent_category] = (intentCounts[u.intent_category] || 0) + 1;
        }
      }
    }

    // ── 3. Fetch service_history from Firestore ───────────────────
    // Always fetch broader range for chart data (max 30 days)
    const broadRangeStart = new Date();
    broadRangeStart.setDate(broadRangeStart.getDate() - 30);
    const broadRangeStr = dateKey(broadRangeStart);

    let serviceRecords = [];
    try {
      const historySnap = await firestore.collection('service_history')
        .where('queue_id', '==', queueId)
        .where('date_key', '>=', broadRangeStr)
        .orderBy('date_key', 'desc')
        .limit(2000)
        .get();
      serviceRecords = historySnap.docs.map(doc => doc.data());
    } catch (e) {
      try {
        const historySnap = await firestore.collection('service_history')
          .where('queue_id', '==', queueId)
          .limit(500)
          .get();
        serviceRecords = historySnap.docs.map(doc => doc.data());
      } catch (e2) {
        // Completely unavailable
      }
    }

    // Filter records to the selected range
    const rangeRecords = serviceRecords.filter(r => r.date_key && r.date_key >= rangeStartStr);

    // ── 4. Compute total served + removed in selected range ───────
    const totalServedRange = rangeRecords.filter(r => r.attended_or_removed === 'attended').length;
    const totalRemovedRange = rangeRecords.filter(r => r.attended_or_removed === 'removed').length;
    const totalRange = totalServedRange + totalRemovedRange;
    const noShowRate = totalRange > 0
      ? Math.round((totalRemovedRange / totalRange) * 100)
      : 0;

    // Fallback for today view if no firestore records yet
    const totalServedFallback = range === 'today' ? (stats.total_served || 0) : 0;
    const totalServedDisplay = totalServedRange > 0 ? totalServedRange : totalServedFallback;

    // ── 5. Hourly traffic heatmap ─────────────────────────────────
    // For today: show today's hours. For week/month: aggregate all hours.
    const hourlyTraffic = {};
    for (let h = 8; h <= 20; h++) hourlyTraffic[h] = 0;

    rangeRecords.forEach(r => {
      const hour = r.hour_key;
      if (hour !== undefined) hourlyTraffic[hour] = (hourlyTraffic[hour] || 0) + 1;
    });

    // Also count active user join times for today's traffic (only for today view)
    if (range === 'today' && usersSnap.exists()) {
      for (const u of Object.values(usersSnap.val())) {
        if (u.join_time) {
          const joinDate = new Date(u.join_time);
          if (dateKey(joinDate) === today) {
            const h = joinDate.getHours();
            hourlyTraffic[h] = (hourlyTraffic[h] || 0) + 1;
          }
        }
      }
    }

    const maxHourlyCount = Math.max(1, ...Object.values(hourlyTraffic));
    const heatmapData = Object.entries(hourlyTraffic)
      .map(([hour, count]) => ({
        hour: parseInt(hour),
        hourLabel: `${parseInt(hour) > 12 ? parseInt(hour) - 12 : parseInt(hour)}:00 ${parseInt(hour) >= 12 ? 'PM' : 'AM'}`,
        count,
        load: Math.round((count / maxHourlyCount) * 100),
      }))
      .filter(h => h.hour >= 8 && h.hour <= 18)
      .sort((a, b) => a.hour - b.hour);

    // ── 6. Wait time accuracy chart ───────────────────────────────
    // For 'today': show hourly breakdown
    // For 'week': show daily breakdown (7 days)
    // For 'month': show daily breakdown (30 days)
    const accuracyBuckets = {};

    if (range === 'today') {
      // Group by hour for today
      const todayRecords = serviceRecords.filter(r => r.date_key === today);
      todayRecords.forEach(r => {
        if (r.wait_actual !== undefined) {
          const hour = r.hour_key || 12;
          const hourLabel = `${hour > 12 ? hour - 12 : hour}${hour >= 12 ? 'PM' : 'AM'}`;
          if (!accuracyBuckets[hour]) accuracyBuckets[hour] = { label: hourLabel, predicted: [], actual: [] };
          accuracyBuckets[hour].actual.push(r.wait_actual);
          if (r.wait_predicted !== undefined) accuracyBuckets[hour].predicted.push(r.wait_predicted);
        }
      });
    } else {
      // Group by date for week/month
      rangeRecords.forEach(r => {
        if (r.date_key && r.wait_actual !== undefined) {
          if (!accuracyBuckets[r.date_key]) {
            const d = parseDateKey(r.date_key);
            const label = range === 'week'
              ? dayNames[d.getDay()]
              : `${d.getDate()} ${monthNames[d.getMonth()]}`;
            accuracyBuckets[r.date_key] = { label, predicted: [], actual: [] };
          }
          accuracyBuckets[r.date_key].actual.push(r.wait_actual);
          if (r.wait_predicted !== undefined) accuracyBuckets[r.date_key].predicted.push(r.wait_predicted);
        }
      });
    }

    const accuracyData = Object.entries(accuracyBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, vals]) => {
        const avgPredicted = vals.predicted.length > 0
          ? Math.round(vals.predicted.reduce((s, v) => s + v, 0) / vals.predicted.length)
          : 0;
        const avgActual = vals.actual.length > 0
          ? Math.round(vals.actual.reduce((s, v) => s + v, 0) / vals.actual.length)
          : 0;
        return {
          day: vals.label,
          date: key,
          predicted: avgPredicted,
          actual: avgActual,
          count: vals.actual.length,
        };
      });

    // ── 7. Efficiency score ───────────────────────────────────────
    let totalPredictionError = 0;
    let predictionCount = 0;
    rangeRecords.forEach(r => {
      if (r.prediction_error !== undefined) {
        totalPredictionError += r.prediction_error;
        predictionCount++;
      }
    });
    const avgPredictionError = predictionCount > 0 ? totalPredictionError / predictionCount : 5;
    const predictionAccuracy = Math.max(0, 100 - (avgPredictionError * 5));
    const noShowPenalty = noShowRate * 0.5;
    const efficiencyScore = Math.round(Math.max(0, Math.min(100,
      (predictionAccuracy * 0.6) + ((100 - noShowPenalty) * 0.4)
    )));

    // ── 8. Intent breakdown ───────────────────────────────────────
    const servedIntents = {};
    rangeRecords.forEach(r => {
      if (r.intent_category) {
        servedIntents[r.intent_category] = (servedIntents[r.intent_category] || 0) + 1;
      }
    });

    const allIntents = { ...servedIntents };
    for (const [k, v] of Object.entries(intentCounts)) {
      allIntents[k] = (allIntents[k] || 0) + v;
    }

    const intentBreakdown = Object.entries(allIntents)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    // ── 9. Peak hour calculation ──────────────────────────────────
    let peakHour = null;
    let peakCount = 0;
    for (const [h, count] of Object.entries(hourlyTraffic)) {
      if (count > peakCount) { peakCount = count; peakHour = parseInt(h); }
    }

    // ── 10. Daily served trend (for week/month sparkline) ─────────
    const dailyServedTrend = [];
    if (range !== 'today') {
      const dailyCounts = {};
      rangeRecords.forEach(r => {
        if (r.date_key && r.attended_or_removed === 'attended') {
          dailyCounts[r.date_key] = (dailyCounts[r.date_key] || 0) + 1;
        }
      });
      // Fill in zeros for days with no data
      for (let d = new Date(rangeStart); d <= new Date(); d.setDate(d.getDate() + 1)) {
        const dk = dateKey(d);
        const dateObj = parseDateKey(dk);
        dailyServedTrend.push({
          date: dk,
          label: range === 'week'
            ? dayNames[dateObj.getDay()]
            : `${dateObj.getDate()} ${monthNames[dateObj.getMonth()]}`,
          served: dailyCounts[dk] || 0,
        });
      }
    }

    return res.json({
      queue_id: queueId,
      date: today,
      range,
      range_label: rangeLabel,
      range_start: rangeStartStr,
      total_served_today: totalServedDisplay,
      total_removed_today: totalRemovedRange,
      no_show_rate: noShowRate,
      active_in_queue: activeCount,
      waiting_count: waitingCount,
      called_count: calledCount,
      avg_wait: stats.avg_wait_live || 0,
      avg_service_time: stats.avg_service_time || 7,
      efficiency_score: efficiencyScore,
      prediction_accuracy: Math.round(predictionAccuracy),
      heatmap_data: heatmapData,
      accuracy_data: accuracyData,
      intent_breakdown: intentBreakdown,
      daily_served_trend: dailyServedTrend,
      peak_hour: peakHour,
      peak_hour_label: peakHour !== null
        ? `${peakHour > 12 ? peakHour - 12 : peakHour}:00 ${peakHour >= 12 ? 'PM' : 'AM'}`
        : null,
      congestion: stats.congestion_level || 'normal',
      counters_open: (await db.ref(`queues/${queueId}/meta/counters_open`).get()).val() || 1,
    });
  } catch (err) {
    console.error('❌ Analytics error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

module.exports = router;
