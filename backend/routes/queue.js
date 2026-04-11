/**
 * Queue Routes — /api/v1/queue/:id/*
 * -------------------------------------
 * All student-facing queue endpoints.
 *
 * Endpoints:
 *   POST /queue/:id/join   — Student joins queue
 *   GET  /queue/:id/status — Live queue snapshot
 *   POST /queue/:id/skip/:userId — Ghost Buster skip
 */

const express = require('express');
const router = express.Router();

const { db, firestore } = require('../firebase/init');
const { callClaude } = require('../ai/claude');
const { intentPrompt, waitPrompt } = require('../ai/prompts');
const { scanForFraud, hashPhone } = require('../monitors/fraudScanner');
const { assignCounter } = require('../monitors/counterCompass');
const { joinLimiter } = require('../middleware/rateLimit');
const calendar = require('../data/college_calendar.json');
const mockResponses = require('../data/mock_responses.json');

/**
 * POST /queue/:id/join
 * Student joins queue. Triggers Intent Classifier + Wait Predictor.
 */
router.post('/:id/join', joinLimiter, async (req, res) => {
  try {
    const queueId = req.params.id;
    const { name, phone, visit_reason, priority, page_load_time } = req.body;

    // ── Validation ───────────────────────────────────────────────
    if (!name || !phone || !visit_reason) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'name, phone, and visit_reason are required.',
      });
    }

    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Phone must be a 10-digit number.',
      });
    }

    // ── Get Socket.io instance ───────────────────────────────────
    const io = req.app.get('io');

    // ── Fraud Check ──────────────────────────────────────────────
    const fraudResult = await scanForFraud(queueId, {
      phone,
      join_timestamp: Date.now(),
      page_load_time: page_load_time || 0,
    }, io);

    if (fraudResult.fraud_flag) {
      return res.status(403).json({
        error: 'Join blocked',
        reason: fraudResult.reason,
        message: fraudResult.details[0] || 'Suspicious activity detected.',
        fraud_confidence: fraudResult.confidence,
      });
    }

    // ── Generate token number ────────────────────────────────────
    const statsRef = db.ref(`queues/${queueId}/stats`);
    const statsSnap = await statsRef.get();
    const stats = statsSnap.exists() ? statsSnap.val() : { current_count: 0 };

    const tokenNum = (stats.current_count || 0) + 1;
    const tokenPrefix = queueId.toUpperCase().slice(0, 3);
    const token = `Q-${tokenPrefix}-${String(tokenNum).padStart(4, '0')}`;

    // ── Get queue meta for context ───────────────────────────────
    const metaRef = db.ref(`queues/${queueId}/meta`);
    const metaSnap = await metaRef.get();
    const meta = metaSnap.exists() ? metaSnap.val() : { name: queueId, type: queueId };

    // ── AI Calls: Intent Classifier + Wait Predictor (parallel) ──
    const currentCount = stats.current_count || 0;
    const now = new Date();

    const [intentResult, waitResult] = await Promise.all([
      callClaude(
        intentPrompt(visit_reason, meta.type || queueId, calendar),
        mockResponses.intent_classifier
      ),
      callClaude(
        waitPrompt({
          people_ahead: currentCount,
          service_type: 'general', // Will be updated after intent classification
          avg_service_time_historical: 7,
          time_of_day: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`,
          day_of_week: now.toLocaleDateString('en', { weekday: 'long' }),
          is_fee_deadline_today: calendar.fee_deadlines.includes(now.toISOString().slice(0, 10)),
          is_exam_result_day: calendar.exam_result_days.includes(now.toISOString().slice(0, 10)),
          current_counter_count: meta.counters_open || 1,
          surge_active: stats.surge_active || false,
        }),
        mockResponses.wait_predictor
      ),
    ]);

    // ── Counter Assignment ───────────────────────────────────────
    const counterAssignment = await assignCounter(queueId, intentResult.category);

    // ── Save user to Firebase RT DB ──────────────────────────────
    const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const position = currentCount + 1;

    const userData = {
      name,
      phone,
      token,
      position,
      join_time: Date.now(),
      visit_reason,
      intent_category: intentResult.category,
      intent_details: intentResult.details,
      intent_urgency: intentResult.urgency,
      urgency_score: intentResult.urgency === 'critical' ? 80 : intentResult.urgency === 'high' ? 60 : intentResult.urgency === 'medium' ? 30 : 10,
      wait_predicted: waitResult.wait_minutes,
      wait_confidence: waitResult.confidence,
      bail_probability: 0,
      sentiment_level: 0,
      last_active: Date.now(),
      gps_lat: null,
      gps_lng: null,
      status: 'waiting',
      priority: priority || 'normal',
      counter_id: counterAssignment.counter_id,
      last_flash_sent: 0,
      history_noshows: 0,
    };

    await db.ref(`queues/${queueId}/users/${userId}`).set(userData);

    // ── Update queue stats ───────────────────────────────────────
    await statsRef.update({
      current_count: position,
      avg_wait_live: waitResult.wait_minutes,
      joins_last_5min: (stats.joins_last_5min || 0) + 1,
    });

    // ── Update user history in Firestore ─────────────────────────
    try {
      const phoneHash = hashPhone(phone);
      await firestore.collection('user_history').doc(phoneHash).set({
        phone_hash: phoneHash,
        visit_count: 1, // Will be incremented on future visits
        last_visited: Date.now(),
        avg_service_type: intentResult.category,
      }, { merge: true });
    } catch (e) {
      // Non-critical — don't block join
    }

    // ── Socket.io: Broadcast queue update ────────────────────────
    const flashMessage = `You're #${position} in queue — estimated wait ${waitResult.wait_minutes} min. Head to ${counterAssignment.counter_label} when called.`;

    if (io) {
      io.to(`queue_${queueId}`).emit('queue_update', {
        action: 'user_joined',
        position,
        count: position,
        avg_wait: waitResult.wait_minutes,
      });

      io.to(`queue_${queueId}`).emit('flash_message', {
        target_user: userId,
        message: flashMessage,
        type: 'info',
        duration: 8000,
      });
    }

    // ── Response ─────────────────────────────────────────────────
    return res.status(201).json({
      userId,
      position,
      token,
      wait_minutes: waitResult.wait_minutes,
      lower_bound: waitResult.lower_bound,
      upper_bound: waitResult.upper_bound,
      confidence: waitResult.confidence,
      intent_category: intentResult.category,
      intent_details: intentResult.details,
      counter_id: counterAssignment.counter_id,
      counter_label: counterAssignment.counter_label,
      flash_message: flashMessage,
    });
  } catch (err) {
    console.error('❌ Join error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  }
});

/**
 * GET /queue/:id/status
 * Returns live queue snapshot for the join/waiting screen.
 */
router.get('/:id/status', async (req, res) => {
  try {
    const queueId = req.params.id;

    const metaRef = db.ref(`queues/${queueId}/meta`);
    const statsRef = db.ref(`queues/${queueId}/stats`);

    const [metaSnap, statsSnap] = await Promise.all([
      metaRef.get(),
      statsRef.get(),
    ]);

    const meta = metaSnap.exists() ? metaSnap.val() : {
      name: queueId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      type: queueId,
      counters_open: 1,
      status: 'open',
    };

    const stats = statsSnap.exists() ? statsSnap.val() : {
      current_count: 0,
      avg_wait_live: 0,
      congestion_level: 'normal',
    };

    // Count only active users (waiting + called)
    const usersRef = db.ref(`queues/${queueId}/users`);
    const usersSnap = await usersRef.get();
    let activeCount = 0;

    if (usersSnap.exists()) {
      const users = usersSnap.val();
      for (const user of Object.values(users)) {
        if (['waiting', 'called', 'in_service'].includes(user.status)) {
          activeCount++;
        }
      }
    }

    return res.json({
      queue_id: queueId,
      queue_name: meta.name,
      queue_type: meta.type,
      count: activeCount,
      avg_wait: stats.avg_wait_live || 0,
      congestion: stats.congestion_level || 'normal',
      counters_open: meta.counters_open || 1,
      status: meta.status || 'open',
      surge_active: stats.surge_active || false,
    });
  } catch (err) {
    console.error('❌ Status error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /queue/:id/position/:userId
 * Returns the current position and wait estimate for a specific user.
 */
router.get('/:id/position/:userId', async (req, res) => {
  try {
    const { id: queueId, userId } = req.params;

    const userRef = db.ref(`queues/${queueId}/users/${userId}`);
    const userSnap = await userRef.get();

    if (!userSnap.exists()) {
      return res.status(404).json({ error: 'User not found in queue' });
    }

    const user = userSnap.val();

    return res.json({
      userId,
      name: user.name,
      token: user.token,
      position: user.position,
      status: user.status,
      wait_predicted: user.wait_predicted,
      wait_confidence: user.wait_confidence,
      counter_id: user.counter_id,
      intent_category: user.intent_category,
      bail_probability: user.bail_probability,
      sentiment_level: user.sentiment_level,
      join_time: user.join_time,
    });
  } catch (err) {
    console.error('❌ Position check error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /queue/:id/skip/:userId
 * Skip a user — triggered by Ghost Buster or admin.
 */
router.post('/:id/skip/:userId', async (req, res) => {
  try {
    const { id: queueId, userId } = req.params;
    const { reason, source } = req.body;
    const io = req.app.get('io');

    const userRef = db.ref(`queues/${queueId}/users/${userId}`);
    const userSnap = await userRef.get();

    if (!userSnap.exists()) {
      return res.status(404).json({ error: 'User not found in queue' });
    }

    const user = userSnap.val();

    await userRef.update({
      status: 'removed',
      removed_reason: reason || 'no_show',
      removed_at: Date.now(),
    });

    // Emit update
    if (io) {
      io.to(`queue_${queueId}`).emit('queue_update', {
        action: 'user_skipped',
        userId,
        reason: reason || 'no_show',
      });
    }

    // Get updated count
    const usersSnap = await db.ref(`queues/${queueId}/users`).get();
    let activeCount = 0;
    if (usersSnap.exists()) {
      for (const u of Object.values(usersSnap.val())) {
        if (['waiting', 'called'].includes(u.status)) activeCount++;
      }
    }

    return res.json({
      skipped_user: user.name,
      reason: reason || 'no_show',
      source: source || 'system',
      new_queue_count: activeCount,
    });
  } catch (err) {
    console.error('❌ Skip error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /queue/:id/users
 * Returns all active users in the queue (for admin dashboard).
 */
router.get('/:id/users', async (req, res) => {
  try {
    const queueId = req.params.id;
    const usersRef = db.ref(`queues/${queueId}/users`);
    const snapshot = await usersRef.get();

    if (!snapshot.exists()) {
      return res.json({ users: [] });
    }

    const users = snapshot.val();
    const activeUsers = Object.entries(users)
      .filter(([, u]) => ['waiting', 'called', 'in_service'].includes(u.status))
      .map(([id, u]) => ({
        userId: id,
        name: u.name,
        token: u.token,
        position: u.position,
        status: u.status,
        intent_category: u.intent_category,
        intent_details: u.intent_details,
        urgency_score: u.urgency_score,
        bail_probability: u.bail_probability,
        sentiment_level: u.sentiment_level,
        wait_predicted: u.wait_predicted,
        counter_id: u.counter_id,
        priority: u.priority,
        join_time: u.join_time,
      }))
      .sort((a, b) => (a.position || 999) - (b.position || 999));

    return res.json({ users: activeUsers, count: activeUsers.length });
  } catch (err) {
    console.error('❌ Users list error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

module.exports = router;
