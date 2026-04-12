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
 *   POST /admin/queue/:id/seed              — Seed demo users
 */

const express = require('express');
const router = express.Router();

const { db, firestore } = require('../firebase/init');
const { requireAdmin } = require('../middleware/auth');
const { advanceQueue } = require('../monitors/autoAdvance');
const { callGemini } = require('../ai/gemini');
const { briefingPrompt } = require('../ai/prompts');
const { DEFAULT_SERVICE_TIMES } = require('../monitors/counterCompass');
const { startMonitorLoop } = require('../jobs/monitorLoop');
const { recalcPositions } = require('../utils/queueHelpers');
const mockBriefing = require('../data/mock_briefing.json');

// ─── Apply admin auth middleware to ALL routes in this router ────────────────
router.use(requireAdmin);

/**
 * POST /admin/queue/:id/attended/:userId
 * Admin marks called user as physically present. Starts service timer.
 */
router.post('/queue/:id/attended/:userId', async (req, res) => {
  try {
    const { id: queueId, userId } = req.params;
    const { counter_id } = req.body;
    const io = req.app.get('io');
    const now = Date.now();

    const userRef = db.ref(`queues/${queueId}/users/${userId}`);
    const userSnap = await userRef.get();

    if (!userSnap.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userSnap.val();

    if (user.status !== 'called') {
      return res.status(400).json({
        error: 'Invalid state',
        message: `User status is '${user.status}', expected 'called'.`,
      });
    }

    const counterId = counter_id || user.counter_id || 'counter_1';
    const avgServiceTime = DEFAULT_SERVICE_TIMES[user.intent_category] || 7;

    // Update user status
    await userRef.update({
      status: 'in_service',
      attended_at: now,
    });

    // Update counter — start service timer
    await db.ref(`queues/${queueId}/counters/${counterId}`).update({
      service_started_at: now,
      expected_finish: now + (avgServiceTime * 60 * 1000),
      auto_advance_timeout: now + (avgServiceTime * 3 * 60 * 1000), // Reset timeout
    });

    // Emit admin update
    if (io) {
      io.to(`admin_${queueId}`).emit('user_attended', {
        userId,
        name: user.name,
        counter: counterId,
        service_started_at: now,
      });

      io.to(`queue_${queueId}`).emit('queue_update', {
        action: 'user_in_service',
        userId,
        counter: counterId,
      });
    }

    console.log(`✅ Attended: ${user.name} at ${counterId}`);

    return res.json({
      status: 'in_service',
      service_started_at: now,
      user: user.name,
      counter: counterId,
    });
  } catch (err) {
    console.error('❌ Attended error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/queue/:id/removed/:userId
 * Admin marks called user as not physically present. Removes from queue.
 * Triggers auto-advance.
 */
router.post('/queue/:id/removed/:userId', async (req, res) => {
  try {
    const { id: queueId, userId } = req.params;
    const { reason } = req.body;
    const io = req.app.get('io');
    const now = Date.now();

    const userRef = db.ref(`queues/${queueId}/users/${userId}`);
    const userSnap = await userRef.get();

    if (!userSnap.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userSnap.val();
    const counterId = user.counter_id || 'counter_1';

    // Mark as removed
    await userRef.update({
      status: 'removed',
      removed_reason: reason || 'not_present',
      removed_at: now,
    });

    // Increment no-show count in user_history
    try {
      const { hashPhone } = require('../monitors/fraudScanner');
      const phoneHash = hashPhone(user.phone);
      const historyDoc = await firestore.collection('user_history').doc(phoneHash).get();
      const existing = historyDoc.exists ? historyDoc.data() : {};
      await firestore.collection('user_history').doc(phoneHash).set({
        phone_hash: phoneHash,
        no_show_count: (existing.no_show_count || 0) + 1,
        removal_count: (existing.removal_count || 0) + 1,
        last_visited: now,
      }, { merge: true });
    } catch (e) {
      // Non-critical
    }

    // Recalculate positions for remaining users
    await recalcPositions(queueId, io);

    // Log to service_history
    try {
      await firestore.collection('service_history').add({
        queue_id: queueId,
        user_id: userId,
        service_type: user.intent_category,
        intent_category: user.intent_category,
        join_time: user.join_time,
        removed_at: now,
        attended_or_removed: 'removed',
        removal_reason: reason || 'not_present',
        counter_id: counterId,
        date_key: new Date().toISOString().slice(0, 10),
        hour_key: new Date().getHours(),
      });
    } catch (e) {
      // Non-critical
    }

    // Emit updates
    if (io) {
      io.to(`queue_${queueId}`).emit('queue_update', {
        action: 'user_removed',
        userId,
        reason: reason || 'not_present',
      });

      io.to(`admin_${queueId}`).emit('user_removed', {
        userId,
        name: user.name,
        reason: reason || 'not_present',
      });
    }

    // SMS notification
    sendRemovalSMS(user, queueId);

    // Auto-advance to next user
    const advanceResult = await advanceQueue(queueId, counterId, 'admin_removed', io);

    console.log(`❌ Removed: ${user.name} — reason: ${reason || 'not_present'}`);

    return res.json({
      removed_user: user.name,
      reason: reason || 'not_present',
      sms_sent: true,
      auto_advance_triggered: true,
      next_user: advanceResult.called_user ? advanceResult.called_user.name : null,
    });
  } catch (err) {
    console.error('❌ Removed error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/queue/:id/done/:userId
 * Admin marks service as complete. Logs actual wait time. Triggers auto-advance.
 */
router.post('/queue/:id/done/:userId', async (req, res) => {
  try {
    const { id: queueId, userId } = req.params;
    const { counter_id } = req.body;
    const io = req.app.get('io');
    const now = Date.now();

    const userRef = db.ref(`queues/${queueId}/users/${userId}`);
    const userSnap = await userRef.get();

    if (!userSnap.exists()) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userSnap.val();
    const counterId = counter_id || user.counter_id || 'counter_1';

    // Calculate actual wait (total time from join to done)
    const actualWait = Math.round((now - (user.join_time || now)) / (1000 * 60));
    const predictionError = Math.abs(actualWait - (user.wait_predicted || 0));

    // Calculate actual service time (time from attended/called to done)
    const serviceStartTime = user.attended_at || user.called_at || user.join_time || now;
    const actualServiceTime = Math.max(1, Math.round((now - serviceStartTime) / (1000 * 60)));

    // Update user status
    await userRef.update({
      status: 'served',
      done_at: now,
      actual_wait: actualWait,
      actual_service_time: actualServiceTime,
    });

    // ── Update running average service time in RT DB stats ────────
    // new_avg = (old_avg × total_served + actual_service_time) / (total_served + 1)
    try {
      const statsRef = db.ref(`queues/${queueId}/stats`);
      const statsSnap = await statsRef.get();
      const stats = statsSnap.exists() ? statsSnap.val() : {};
      const oldAvg = stats.avg_service_time || 7;
      const totalServed = stats.total_served || 0;
      const newAvg = Math.round(((oldAvg * totalServed + actualServiceTime) / (totalServed + 1)) * 10) / 10;

      await statsRef.update({
        avg_service_time: newAvg,
        total_served: totalServed + 1,
      });

      console.log(`📊 Updated avg_service_time: ${oldAvg} → ${newAvg} (served: ${totalServed + 1})`);
    } catch (e) {
      console.warn('⚠️  Stats update failed (non-blocking):', e.message);
    }

    // Recalculate positions for remaining users
    await recalcPositions(queueId, io);

    // Log to service_history in Firestore
    try {
      await firestore.collection('service_history').add({
        queue_id: queueId,
        user_id: userId,
        service_type: user.intent_category,
        intent_category: user.intent_category,
        join_time: user.join_time,
        call_time: user.called_at,
        attended_time: user.attended_at,
        done_time: now,
        wait_predicted: user.wait_predicted,
        wait_actual: actualWait,
        prediction_error: predictionError,
        sentiment_peak: user.sentiment_level,
        flash_messages_sent: 0,
        attended_or_removed: 'attended',
        counter_id: counterId,
        date_key: new Date().toISOString().slice(0, 10),
        hour_key: new Date().getHours(),
      });
    } catch (e) {
      console.warn('⚠️  Firestore log failed (non-blocking):', e.message);
    }

    // Update model_weights — rolling weighted average (30% today, 70% history)
    try {
      const weightsDoc = await firestore.collection('model_weights').doc(queueId).get();
      const weights = weightsDoc.exists ? weightsDoc.data() : {};
      const serviceTimes = weights.avg_service_times || {};
      const currentAvg = serviceTimes[user.intent_category] || DEFAULT_SERVICE_TIMES[user.intent_category] || 7;
      const serviceTime = user.attended_at ? (now - user.attended_at) / (1000 * 60) : currentAvg;
      const newAvg = (0.3 * serviceTime) + (0.7 * currentAvg);

      await firestore.collection('model_weights').doc(queueId).set({
        queue_id: queueId,
        updated_at: now,
        avg_service_times: {
          ...serviceTimes,
          [user.intent_category]: Math.round(newAvg * 10) / 10,
        },
      }, { merge: true });
    } catch (e) {
      // Non-critical
    }

    // Emit update
    if (io) {
      io.to(`queue_${queueId}`).emit('queue_update', {
        action: 'service_completed',
        userId,
        actual_wait: actualWait,
      });

      io.to(`admin_${queueId}`).emit('service_completed', {
        userId,
        name: user.name,
        actual_wait: actualWait,
        prediction_error: predictionError,
      });
    }

    // Auto-advance to next user
    const advanceResult = await advanceQueue(queueId, counterId, 'auto_advance', io);

    console.log(`✅ Done: ${user.name} — actual wait: ${actualWait}min, error: ${predictionError}min`);

    return res.json({
      logged: true,
      actual_wait_minutes: actualWait,
      prediction_error: predictionError,
      auto_advance_triggered: true,
      next_user: advanceResult.called_user ? advanceResult.called_user.name : null,
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
    const today = new Date().toISOString().slice(0, 10);

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
    const today = new Date().toISOString().slice(0, 10);

    // Gather yesterday's data (or use mock for demo)
    const data = {
      queue_name: queueId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      date: today,
      total_served: 47,
      avg_wait_actual: 12,
      avg_wait_predicted: 11,
      accuracy_percent: 84,
      peak_hour: 14,
      no_show_count: 5,
      top_intents: ['fee_payment', 'bonafide_cert', 'tc_mc_request'],
      surge_count: 2,
      upcoming_calendar_events: ['Fee deadline today at 5pm'],
    };

    const briefing = await callGemini(briefingPrompt(data), mockBriefing);

    // Save to Firestore
    try {
      await firestore.collection('queue_learning').doc(`${queueId}_${today}`).set({
        queue_id: queueId,
        date: today,
        ai_briefing: briefing,
        briefing_generated_at: new Date().toISOString(),
      }, { merge: true });
    } catch (e) {
      // Non-critical
    }

    return res.json({
      ...briefing,
      generated_at: new Date().toISOString(),
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
      admin_uid: 'admin',
    });

    // Initialize stats
    await db.ref(`queues/${queueId}/stats`).set({
      current_count: 0,
      avg_wait_live: 0,
      congestion_level: 'normal',
      joins_last_5min: 0,
      surge_active: false,
      avg_service_time: 7,
      total_served: 0,
    });

    // Initialize counters
    const numCounters = counters_open || 1;
    for (let i = 1; i <= numCounters; i++) {
      await db.ref(`queues/${queueId}/counters/counter_${i}`).set({
        label: `Counter ${i}`,
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
 * POST /admin/queue/:id/seed
 * Seed demo users for hackathon demo.
 */
router.post('/queue/:id/seed', async (req, res) => {
  try {
    const queueId = req.params.id;
    const io = req.app.get('io');
    const now = Date.now();

    // ── Ensure queue meta exists (create if missing) ──────────
    const metaRef = db.ref(`queues/${queueId}/meta`);
    const metaSnap = await metaRef.get();
    if (!metaSnap.exists()) {
      await metaRef.set({
        name: queueId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        type: queueId,
        counters_open: 1,
        status: 'open',
        created_at: now,
        admin_uid: 'admin',
      });
      console.log(`📋 Auto-created queue meta for ${queueId}`);
    }

    // ── Ensure at least one counter exists ─────────────────────
    const countersRef = db.ref(`queues/${queueId}/counters`);
    const countersSnap = await countersRef.get();
    if (!countersSnap.exists()) {
      await db.ref(`queues/${queueId}/counters/counter_1`).set({
        label: 'Counter 1',
        current_user_id: null,
        service_started_at: null,
        expected_finish: null,
        queue_length: 0,
        auto_advance_timeout: null,
      });
      console.log(`📋 Auto-created counter_1 for ${queueId}`);
    }

    // ── Clear existing demo users to avoid duplicates ──────────
    const existingUsersSnap = await db.ref(`queues/${queueId}/users`).get();
    if (existingUsersSnap.exists()) {
      const existing = existingUsersSnap.val();
      for (const uid of Object.keys(existing)) {
        if (uid.startsWith('demo_')) {
          await db.ref(`queues/${queueId}/users/${uid}`).remove();
        }
      }
    }

    // Demo users from handoff doc
    const demoUsers = [
      {
        name: 'Rahul Sharma', phone: '9876543210', token: 'Q-FEE-0001',
        position: 1, intent_category: 'fee_payment', intent_details: 'Fee payment — deadline today',
        urgency_score: 80, bail_probability: 12, sentiment_level: 1, priority: 'normal',
        intent_urgency: 'critical', status: 'waiting',
      },
      {
        name: 'Priya Mehta', phone: '9876543211', token: 'Q-FEE-0002',
        position: 2, intent_category: 'bonafide_cert', intent_details: 'Bonafide certificate request',
        urgency_score: 30, bail_probability: 8, sentiment_level: 1, priority: 'normal',
        intent_urgency: 'medium', status: 'waiting',
      },
      {
        name: 'Amit Singh', phone: '9876543212', token: 'Q-FEE-0003',
        position: 3, intent_category: 'scholarship', intent_details: 'Scholarship application inquiry',
        urgency_score: 60, bail_probability: 5, sentiment_level: 2, priority: 'elderly',
        intent_urgency: 'high', status: 'waiting',
      },
      {
        name: 'Sneha Rao', phone: '9876543213', token: 'Q-FEE-0004',
        position: 4, intent_category: 'tc_mc_request', intent_details: 'TC/MC request for transfer',
        urgency_score: 60, bail_probability: 71, sentiment_level: 3, priority: 'normal',
        intent_urgency: 'high', status: 'waiting',
      },
      {
        name: 'Vikram Nair', phone: '9876543214', token: 'Q-FEE-0005',
        position: 5, intent_category: 'exam_query', intent_details: 'Exam result query',
        urgency_score: 10, bail_probability: 22, sentiment_level: 1, priority: 'normal',
        intent_urgency: 'low', status: 'waiting',
      },
    ];

    for (const user of demoUsers) {
      const userId = `demo_${user.name.toLowerCase().replace(/\s/g, '_')}`;
      await db.ref(`queues/${queueId}/users/${userId}`).set({
        ...user,
        join_time: now - (user.position * 2 * 60 * 1000), // Stagger join times
        last_active: now, // Set to now so Ghost Buster doesn't immediately flag them
        wait_predicted: 12,
        wait_confidence: 87,
        counter_id: 'counter_1',
        gps_lat: null,
        gps_lng: null,
        last_flash_sent: 0,
        history_noshows: 0,
        visit_reason: user.intent_details,
      });
    }

    // Update stats
    await db.ref(`queues/${queueId}/stats`).update({
      current_count: demoUsers.length,
      avg_wait_live: 12,
      congestion_level: 'normal',
      joins_last_5min: 0,
      surge_active: false,
      avg_service_time: 7,
      total_served: 0,
    });

    // ── Auto-advance: call the first user immediately ─────────
    // Reset counter so advanceQueue picks up the idle counter
    await db.ref(`queues/${queueId}/counters/counter_1`).update({
      current_user_id: null,
      auto_advance_timeout: null,
    });
    const advanceResult = await advanceQueue(queueId, 'counter_1', 'seed', io);

    if (io) {
      io.to(`queue_${queueId}`).emit('queue_update', {
        action: 'queue_seeded',
        count: demoUsers.length,
      });
    }

    console.log(`🌱 Seeded ${demoUsers.length} demo users in ${queueId}`);

    return res.json({
      seeded: true,
      first_called: advanceResult.called_user ? advanceResult.called_user.name : null,
      users: demoUsers.map(u => ({ name: u.name, position: u.position, intent: u.intent_category })),
    });
  } catch (err) {
    console.error('❌ Seed error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /admin/queue/:id/next (Internal Auto-Advance)
 * AI auto-advance system calls next user. Called INTERNALLY by the system.
 * Not intended for admin use — admin only clicks Attended/Removed.
 */
router.post('/queue/:id/next', async (req, res) => {
  try {
    const queueId = req.params.id;
    const { counter_id, source } = req.body;
    const io = req.app.get('io');
    const counterId = counter_id || 'counter_1';

    const result = await advanceQueue(queueId, counterId, source || 'auto_advance', io);

    return res.json(result);
  } catch (err) {
    console.error('❌ Auto-advance error:', err);
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

    await db.ref(`queues/${queueId}/meta`).update({ status: 'paused' });

    if (io) {
      io.to(`queue_${queueId}`).emit('queue_update', { action: 'queue_paused' });
      io.to(`admin_${queueId}`).emit('queue_paused', { queue_id: queueId });
    }

    console.log(`⏸️  Queue paused: ${queueId}`);
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

    await db.ref(`queues/${queueId}/meta`).update({ status: 'open' });

    if (io) {
      io.to(`queue_${queueId}`).emit('queue_update', { action: 'queue_resumed' });
      io.to(`admin_${queueId}`).emit('queue_resumed', { queue_id: queueId });
    }

    console.log(`▶️  Queue resumed: ${queueId}`);
    return res.json({ status: 'open', queue_id: queueId });
  } catch (err) {
    console.error('❌ Resume error:', err);
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
 * Send SMS when a user is removed.
 * Wrapped in try-catch — SMS failure must NOT break queue flow.
 */
function sendRemovalSMS(user, queueId) {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromPhone || accountSid === 'your-account-sid') {
      return;
    }

    const twilio = require('twilio');
    const client = twilio(accountSid, authToken);

    client.messages.create({
      body: `You were removed from the queue. Please rejoin if needed.`,
      from: fromPhone,
      to: `+91${user.phone}`,
    }).catch(() => {});
  } catch (err) {
    // Silent fail — non-critical
  }
}

/**
 * POST /admin/queue/:id/counters
 * Add or remove a counter dynamically.
 * Body: { action: 'add' | 'remove' }
 */
router.post('/queue/:id/counters', async (req, res) => {
  try {
    const queueId = req.params.id;
    const { action } = req.body;
    const io = req.app.get('io');

    if (!['add', 'remove'].includes(action)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: "action must be 'add' or 'remove'.",
      });
    }

    const metaRef = db.ref(`queues/${queueId}/meta`);
    const metaSnap = await metaRef.get();
    const meta = metaSnap.exists() ? metaSnap.val() : { counters_open: 1 };
    const currentCount = meta.counters_open || 1;

    if (action === 'add') {
      const newCount = currentCount + 1;
      const newCounterId = `counter_${newCount}`;

      // Create the new counter entry
      await db.ref(`queues/${queueId}/counters/${newCounterId}`).set({
        label: `Counter ${newCount}`,
        current_user_id: null,
        service_started_at: null,
        expected_finish: null,
        queue_length: 0,
        auto_advance_timeout: null,
      });

      await metaRef.update({ counters_open: newCount });

      if (io) {
        io.to(`admin_${queueId}`).emit('queue_update', {
          action: 'counter_added',
          counters_open: newCount,
        });
        io.to(`queue_${queueId}`).emit('queue_update', {
          action: 'counter_added',
          counters_open: newCount,
        });
      }

      console.log(`➕ Counter added: ${newCounterId} in ${queueId} (total: ${newCount})`);

      return res.json({
        counters_open: newCount,
        added: newCounterId,
        action: 'add',
      });
    } else {
      // Remove — minimum 1 counter
      if (currentCount <= 1) {
        return res.status(400).json({
          error: 'Cannot remove',
          message: 'At least 1 counter must remain open.',
        });
      }

      const removeCounterId = `counter_${currentCount}`;
      const newCount = currentCount - 1;

      // Check if counter is currently serving someone
      const counterSnap = await db.ref(`queues/${queueId}/counters/${removeCounterId}`).get();
      if (counterSnap.exists()) {
        const counter = counterSnap.val();
        if (counter.current_user_id) {
          return res.status(400).json({
            error: 'Counter busy',
            message: `${removeCounterId} is currently serving a student. Complete service first.`,
          });
        }
      }

      // Remove counter entry
      await db.ref(`queues/${queueId}/counters/${removeCounterId}`).remove();
      await metaRef.update({ counters_open: newCount });

      if (io) {
        io.to(`admin_${queueId}`).emit('queue_update', {
          action: 'counter_removed',
          counters_open: newCount,
        });
        io.to(`queue_${queueId}`).emit('queue_update', {
          action: 'counter_removed',
          counters_open: newCount,
        });
      }

      console.log(`➖ Counter removed: ${removeCounterId} in ${queueId} (total: ${newCount})`);

      return res.json({
        counters_open: newCount,
        removed: removeCounterId,
        action: 'remove',
      });
    }
  } catch (err) {
    console.error('❌ Counter update error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /admin/queue/:id/analytics
 * Returns real analytics data: total served, no-show rate, hourly traffic,
 * wait time accuracy (predicted vs actual), intent breakdown, and efficiency score.
 */
router.get('/queue/:id/analytics', async (req, res) => {
  try {
    const queueId = req.params.id;
    const today = new Date().toISOString().slice(0, 10);

    // ── 1. Fetch RT DB stats ──────────────────────────────────────
    const statsSnap = await db.ref(`queues/${queueId}/stats`).get();
    const stats = statsSnap.exists() ? statsSnap.val() : {};

    // ── 2. Count active users from RT DB ──────────────────────────
    const usersSnap = await db.ref(`queues/${queueId}/users`).get();
    let activeCount = 0;
    let waitingCount = 0;
    let calledCount = 0;
    const intentCounts = {};
    const activeUsers = [];

    if (usersSnap.exists()) {
      const usersObj = usersSnap.val();
      for (const [uid, u] of Object.entries(usersObj)) {
        if (['waiting', 'called', 'in_service'].includes(u.status)) {
          activeCount++;
          if (u.status === 'waiting') waitingCount++;
          if (u.status === 'called' || u.status === 'in_service') calledCount++;
          activeUsers.push(u);
        }
        // Count intents across ALL users (including served/removed) for breakdown
        if (u.intent_category) {
          intentCounts[u.intent_category] = (intentCounts[u.intent_category] || 0) + 1;
        }
      }
    }

    // ── 3. Fetch service_history from Firestore (last 7 days) ─────
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

    let serviceRecords = [];
    try {
      const historySnap = await firestore.collection('service_history')
        .where('queue_id', '==', queueId)
        .where('date_key', '>=', sevenDaysAgoStr)
        .orderBy('date_key', 'desc')
        .limit(500)
        .get();

      serviceRecords = historySnap.docs.map(doc => doc.data());
    } catch (e) {
      // Firestore might not have the index — fall back gracefully
      try {
        const historySnap = await firestore.collection('service_history')
          .where('queue_id', '==', queueId)
          .limit(200)
          .get();
        serviceRecords = historySnap.docs.map(doc => doc.data());
      } catch (e2) {
        // Completely unavailable — use empty
      }
    }

    // ── 4. Compute total served + removed today ───────────────────
    const todayRecords = serviceRecords.filter(r => r.date_key === today);
    const totalServedToday = todayRecords.filter(r => r.attended_or_removed === 'attended').length;
    const totalRemovedToday = todayRecords.filter(r => r.attended_or_removed === 'removed').length;
    const noShowRate = (totalServedToday + totalRemovedToday) > 0
      ? Math.round((totalRemovedToday / (totalServedToday + totalRemovedToday)) * 100)
      : 0;

    // Also count from stats.total_served if no firestore records yet
    const totalServedFallback = stats.total_served || 0;
    const totalServedDisplay = totalServedToday > 0 ? totalServedToday : totalServedFallback;

    // ── 5. Hourly traffic heatmap (today) ─────────────────────────
    const hourlyTraffic = {};
    for (let h = 8; h <= 20; h++) hourlyTraffic[h] = 0;

    todayRecords.forEach(r => {
      const hour = r.hour_key;
      if (hour !== undefined) hourlyTraffic[hour] = (hourlyTraffic[hour] || 0) + 1;
    });

    // Also count active user join times for today's traffic
    if (usersSnap.exists()) {
      for (const u of Object.values(usersSnap.val())) {
        if (u.join_time) {
          const joinDate = new Date(u.join_time);
          if (joinDate.toISOString().slice(0, 10) === today) {
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

    // ── 6. Wait time accuracy — daily predicted vs actual (last 7 days) ─
    const dailyAccuracy = {};
    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    serviceRecords.forEach(r => {
      if (r.date_key && r.wait_actual !== undefined) {
        if (!dailyAccuracy[r.date_key]) {
          dailyAccuracy[r.date_key] = { predicted: [], actual: [] };
        }
        dailyAccuracy[r.date_key].actual.push(r.wait_actual);
        if (r.wait_predicted !== undefined) {
          dailyAccuracy[r.date_key].predicted.push(r.wait_predicted);
        }
      }
    });

    const accuracyData = Object.entries(dailyAccuracy)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([dateKey, vals]) => {
        const d = new Date(dateKey);
        const avgPredicted = vals.predicted.length > 0
          ? Math.round(vals.predicted.reduce((s, v) => s + v, 0) / vals.predicted.length)
          : 0;
        const avgActual = vals.actual.length > 0
          ? Math.round(vals.actual.reduce((s, v) => s + v, 0) / vals.actual.length)
          : 0;
        return {
          day: dayNames[d.getDay()] || dateKey.slice(5),
          date: dateKey,
          predicted: avgPredicted,
          actual: avgActual,
          count: vals.actual.length,
        };
      });

    // ── 7. Efficiency score ───────────────────────────────────────
    // Based on: low wait times, low no-show rate, high throughput
    let totalPredictionError = 0;
    let predictionCount = 0;
    serviceRecords.forEach(r => {
      if (r.prediction_error !== undefined) {
        totalPredictionError += r.prediction_error;
        predictionCount++;
      }
    });
    const avgPredictionError = predictionCount > 0 ? totalPredictionError / predictionCount : 5;
    const predictionAccuracy = Math.max(0, 100 - (avgPredictionError * 5)); // 5 points per minute error
    const noShowPenalty = noShowRate * 0.5;
    const efficiencyScore = Math.round(Math.max(0, Math.min(100,
      (predictionAccuracy * 0.6) + ((100 - noShowPenalty) * 0.4)
    )));

    // ── 8. Intent breakdown for analytics ─────────────────────────
    // Also count from service history for served intent distribution
    const servedIntents = {};
    serviceRecords.forEach(r => {
      if (r.intent_category) {
        servedIntents[r.intent_category] = (servedIntents[r.intent_category] || 0) + 1;
      }
    });

    // Merge active + served intents
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

    return res.json({
      queue_id: queueId,
      date: today,
      total_served_today: totalServedDisplay,
      total_removed_today: totalRemovedToday,
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
