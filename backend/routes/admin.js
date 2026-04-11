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
const { callClaude } = require('../ai/claude');
const { briefingPrompt } = require('../ai/prompts');
const { DEFAULT_SERVICE_TIMES } = require('../monitors/counterCompass');
const mockBriefing = require('../data/mock_briefing.json');

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

    // Calculate actual wait
    const actualWait = Math.round((now - (user.join_time || now)) / (1000 * 60));
    const predictionError = Math.abs(actualWait - (user.wait_predicted || 0));

    // Update user status
    await userRef.update({
      status: 'served',
      done_at: now,
      actual_wait: actualWait,
    });

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

    // Return mock briefing
    return res.json({
      ...mockBriefing,
      generated_at: new Date().toISOString(),
      source: 'mock',
    });
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

    const briefing = await callClaude(briefingPrompt(data), mockBriefing);

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
        last_active: now - (user.bail_probability * 1000), // Vary last_active based on bail prob
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
    });

    if (io) {
      io.to(`queue_${queueId}`).emit('queue_update', {
        action: 'queue_seeded',
        count: demoUsers.length,
      });
    }

    console.log(`🌱 Seeded ${demoUsers.length} demo users in ${queueId}`);

    return res.json({
      seeded: true,
      users: demoUsers.map(u => ({ name: u.name, position: u.position, intent: u.intent_category })),
    });
  } catch (err) {
    console.error('❌ Seed error:', err);
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

module.exports = router;
