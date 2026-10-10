/**
 * Queue Routes — /api/v1/queue/:id/*
 * -------------------------------------
 * Student-facing queue endpoints + admin removal alias.
 *
 *   POST /queue/:id/join              — Student joins queue
 *   POST /queue/:id/documents/:userId — Attach uploaded documents
 *   GET  /queue/:id/status            — Live queue snapshot
 *   GET  /queue/:id/position/:userId  — Student's live status
 *   POST /queue/:id/no-show/:userId   — Remove a user (admin only)
 *   GET  /queue/:id/users             — Active users (admin only)
 *   GET  /queue/:id/requirements      — Document requirements
 */

const express = require('express');
const router = express.Router();

const { db, firestore } = require('../firebase/init');
const { callGemini, MOCK_MODE } = require('../ai/gemini');
const { intentPrompt } = require('../ai/prompts');
const { scanForFraud, hashPhone } = require('../monitors/fraudScanner');
const { assignCounter, DEFAULT_SERVICE_TIMES } = require('../monitors/counterCompass');
const { joinLimiter } = require('../middleware/rateLimit');
const { requireAdmin } = require('../middleware/auth');
const { checkCellAccess } = require('../middleware/jwtAuth');
const queueService = require('../services/queueService');
const calendar = require('../data/college_calendar.json');
const mockResponses = require('../data/mock_responses.json');

const DEFAULT_QUEUE_REQUIREMENTS = {
  fee_cell: ['Original fee challan / receipt', 'College ID card', 'Admission letter'],
  admission_cell: ['10th and 12th marksheet', 'Transfer certificate', '4 passport size photos', 'Aadhar card'],
  admin_cell: ['College ID card', 'Application form', 'Supporting documents related to your request'],
  exam_cell: ['College ID card', 'Exam admit card', 'Previous marksheet if required'],
  registration_cell: ['College ID card', 'Admission proof', 'Recent passport-size photo'],
  general: ['College ID card'],
};

const INTENT_REQUIREMENTS = {
  fee_payment: ['Original fee challan / receipt', 'Fee payment proof (if available)', 'College ID card'],
  bonafide_cert: ['College ID card', 'Filled application form', '1 passport size photo'],
  tc_mc_request: ['Original College ID card', 'No dues certificate', 'Application written on plain paper'],
  scholarship: ['Income certificate', 'Marksheet of previous year', 'Bank passbook copy', 'Caste certificate (if applicable)'],
  admission: ['10th and 12th marksheet', 'Transfer certificate', '4 passport size photos', 'Aadhar card'],
  exam_query: ['College ID card', 'Exam admit card'],
  document_verification: ['Original documents for verification', 'College ID card', 'Photocopies of all documents'],
  general: ['College ID card'],
};

const COUNTER_REQUIREMENTS = {
  cashier: ['Fee challan / payment proof', 'College ID card'],
  document: ['College ID card', 'Application form', 'Relevant supporting documents'],
  information: ['College ID card'],
  fast_track: ['Token / appointment slip', 'College ID card'],
};

function getDefaultRequirements(queueId, queueType) {
  const key = (queueType || queueId || 'general').toLowerCase().replace(/\s+/g, '_');
  return DEFAULT_QUEUE_REQUIREMENTS[key] || DEFAULT_QUEUE_REQUIREMENTS.general;
}

function dedupeDocuments(documents) {
  const seen = new Set();
  return (documents || []).filter((doc) => {
    const key = String(doc).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTailoredRequirements(queueId, queueType, intentCategory, counterId, counterType) {
  const intentDocs = INTENT_REQUIREMENTS[intentCategory];
  if (intentDocs && intentCategory !== 'general') return dedupeDocuments([...intentDocs]);

  const queueDocs = getDefaultRequirements(queueId, queueType);
  const counterDocs = [];
  const normalizedCounter = (counterType || counterId || '').toLowerCase();
  if (COUNTER_REQUIREMENTS[normalizedCounter]) counterDocs.push(...COUNTER_REQUIREMENTS[normalizedCounter]);
  else {
    if (normalizedCounter.includes('fee')) counterDocs.push('Fee receipt / payment proof');
    if (normalizedCounter.includes('admission')) counterDocs.push('Admission letter');
    if (normalizedCounter.includes('exam')) counterDocs.push('Exam hall ticket / admit card');
    if (normalizedCounter.includes('admin')) counterDocs.push('College ID card');
  }
  return dedupeDocuments([...queueDocs, ...counterDocs]);
}

function normalizeUploadedDocuments(documents) {
  if (!Array.isArray(documents)) return [];
  return documents.slice(0, 20).map((doc, index) => ({
    name: (doc?.name || doc?.file_name || `Document ${index + 1}`).toString().trim().slice(0, 120),
    url: doc?.url || doc?.download_url || doc?.photo_url || null,
    mime_type: doc?.mime_type || doc?.type || null,
    size: Number.isFinite(Number(doc?.size)) ? Number(doc.size) : null,
  })).filter((doc) => doc.name.length > 0 || doc.url);
}

function classifyByKeywords(reasonLower) {
  if (/scholar|stipend|freeship/.test(reasonLower)) return 'scholarship';
  if (/bonafide|bona fide|character cert|certificate/.test(reasonLower)) return 'bonafide_cert';
  if (/transfer cert|tc |migration|leaving cert|mc /.test(reasonLower)) return 'tc_mc_request';
  if (/admission|enroll|new student|branch change|course change/.test(reasonLower)) return 'admission';
  if (/exam|result|re.?eval|backlog|hall ticket|admit card/.test(reasonLower)) return 'exam_query';
  if (/fee|payment|challan|receipt|refund|dues|hostel fee/.test(reasonLower)) return 'fee_payment';
  return 'general';
}

/**
 * GET /queue/list
 */
router.get('/list', async (req, res) => {
  try {
    const snap = await db.ref('queues').get();
    if (!snap.exists()) return res.json({ queues: [] });
    const queuesList = Object.entries(snap.val()).map(([key, value]) => ({
      id: key,
      name: (value.meta && value.meta.name) || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      type: (value.meta && value.meta.type) || key,
      status: (value.meta && value.meta.status) || 'open',
      counters_open: (value.meta && value.meta.counters_open) || 1,
    }));
    return res.json({ queues: queuesList });
  } catch (err) {
    console.error('❌ Failed to fetch queue list:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /queue/:id/join
 */
router.post('/:id/join', joinLimiter, async (req, res) => {
  try {
    const queueId = req.params.id;
    const { name, phone, visit_reason, priority, page_load_time, form_fill_ms, submitted_documents } = req.body;

    if (!name || !phone || !visit_reason) {
      return res.status(400).json({ error: 'Validation failed', message: 'name, phone, and visit_reason are required.' });
    }
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ error: 'Validation failed', message: 'Phone must be a 10-digit number.' });
    }

    const metaSnap = await db.ref(`queues/${queueId}/meta`).get();
    if (!metaSnap.exists()) {
      return res.status(404).json({ error: 'Queue not found', message: `No queue exists with id '${queueId}'.` });
    }
    const meta = metaSnap.val();
    if (meta.status === 'paused' || meta.status === 'closed') {
      return res.status(403).json({ error: 'Queue unavailable', message: `This queue is currently ${meta.status}. Please try again later.` });
    }

    const io = req.app.get('io');
    const settings = queueService.getSettings(meta);

    // Optional join limiting during a surge.
    if (settings.limit_joins_on_surge) {
      const statsSnap = await db.ref(`queues/${queueId}/stats`).get();
      const st = statsSnap.exists() ? statsSnap.val() : {};
      if (st.surge_active) {
        return res.status(503).json({
          error: 'Queue busy',
          message: 'New joins are temporarily limited due to high demand. Please try again in a few minutes.',
        });
      }
    }

    // Fraud check
    const fraudResult = await scanForFraud(queueId, {
      phone, join_timestamp: Date.now(), page_load_time: page_load_time || 0, form_fill_ms,
    }, io);
    if (fraudResult.fraud_flag) {
      return res.status(403).json({
        error: 'Join blocked', reason: fraudResult.reason,
        message: fraudResult.details[0] || 'Suspicious activity detected.',
        fraud_confidence: fraudResult.confidence,
      });
    }

    // Intent classification
    let intentResult = await callGemini(intentPrompt(visit_reason, meta.type || queueId, calendar), null);
    let isFallback = false;
    if (!intentResult) { isFallback = true; intentResult = { ...mockResponses.intent_classifier }; }
    if (MOCK_MODE || isFallback || !intentResult.category || intentResult.category === 'general') {
      const detected = classifyByKeywords(visit_reason.toLowerCase());
      if (detected) { intentResult.category = detected; intentResult.details = visit_reason; }
    }

    // Counter recommendation (advisory; assignment happens when called)
    const counterRec = await assignCounter(queueId, intentResult.category);

    const safePriority = ['normal', 'elderly', 'emergency'].includes(priority) ? priority : 'normal';

    const prepared = {
      name: String(name).trim().slice(0, 80),
      phone,
      visit_reason: String(visit_reason).trim().slice(0, 300),
      intent_category: intentResult.category || 'general',
      intent_details: intentResult.details || visit_reason,
      intent_urgency: intentResult.urgency || 'low',
      urgency_score: intentResult.urgency === 'critical' ? 80 : intentResult.urgency === 'high' ? 60 : intentResult.urgency === 'medium' ? 30 : 10,
      priority: safePriority,
      counter_id: counterRec.counter_id,
      counter_type: intentResult.counter_type || 'information',
      submitted_documents: normalizeUploadedDocuments(submitted_documents),
      required_documents: getTailoredRequirements(queueId, meta.type || queueId, intentResult.category, counterRec.counter_id, intentResult.counter_type),
    };

    const enq = await queueService.enqueueUser(queueId, prepared);
    if (!enq.ok) {
      const code = enq.reason === 'paused' ? 403 : enq.reason === 'closed' ? 403 : 404;
      return res.status(code).json({ error: 'Join failed', message: `Queue is ${enq.reason || 'unavailable'}.` });
    }

    // Visit history (non-blocking)
    try {
      const phoneHash = hashPhone(phone);
      const historyRef = firestore.collection('user_history').doc(phoneHash);
      const historyDoc = await historyRef.get();
      const prev = historyDoc.exists ? historyDoc.data() : {};
      await historyRef.set({
        phone_hash: phoneHash,
        visit_count: (prev.visit_count || 0) + 1,
        last_visited: Date.now(),
        avg_service_type: prepared.intent_category,
      }, { merge: true });
    } catch { /* non-critical */ }

    const bounds = queueService.waitBounds(enq.wait_minutes);
    const flashMessage = `You're #${enq.position} in queue — estimated wait ${enq.wait_minutes} min. Head to ${counterRec.counter_label} when called.`;

    if (io) {
      io.to(`queue_${queueId}`).emit('queue_update', { action: 'user_joined', count: enq.waitingCount, avg_wait: enq.wait_minutes });
      io.to(`admin_${queueId}`).emit('queue_update', { action: 'user_joined' });
      require('../socket/registry').emitToUser(io, enq.userId, 'flash_message', {
        target_user: enq.userId, message: flashMessage, type: 'info', duration: 8000,
      });
    }

    sendJoinSMS({ token: enq.token, phone }, enq.position, enq.wait_minutes, counterRec.counter_label);

    return res.status(201).json({
      userId: enq.userId,
      position: enq.position,
      token: enq.token,
      wait_minutes: enq.wait_minutes,
      lower_bound: bounds.lower,
      upper_bound: bounds.upper,
      confidence: enq.confidence,
      intent_category: prepared.intent_category,
      intent_details: prepared.intent_details,
      counter_id: counterRec.counter_id,
      counter_label: counterRec.counter_label,
      counter_type: prepared.counter_type,
      flash_message: flashMessage,
      submitted_documents: prepared.submitted_documents,
      required_documents: prepared.required_documents,
    });
  } catch (err) {
    console.error('❌ Join error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /queue/:id/documents/:userId
 */
router.post('/:id/documents/:userId', async (req, res) => {
  try {
    const { id: queueId, userId } = req.params;
    const { documents } = req.body;
    const io = req.app.get('io');

    const userRef = db.ref(`queues/${queueId}/users/${userId}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists()) return res.status(404).json({ error: 'User not found in queue' });

    const normalized = normalizeUploadedDocuments(documents);
    await userRef.update({ submitted_documents: normalized, documents_uploaded_at: Date.now() });

    if (io) {
      io.to(`queue_${queueId}`).emit('queue_update', { action: 'documents_attached', userId, count: normalized.length });
      io.to(`admin_${queueId}`).emit('queue_update', { action: 'documents_attached', userId, count: normalized.length });
    }
    return res.json({ saved: true, queue_id: queueId, userId, count: normalized.length, submitted_documents: normalized });
  } catch (err) {
    console.error('❌ Document attach error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /queue/:id/status
 */
router.get('/:id/status', async (req, res) => {
  try {
    const queueId = req.params.id;
    const metaSnap = await db.ref(`queues/${queueId}/meta`).get();
    if (!metaSnap.exists()) return res.status(404).json({ error: 'Queue not found' });
    const meta = metaSnap.val();

    const reqSnap = await db.ref(`queues/${queueId}/meta/requirements`).get();
    const saved = reqSnap.exists() ? reqSnap.val() : null;
    const requirementsList = Array.isArray(saved) && saved.length > 0
      ? saved : getDefaultRequirements(queueId, meta.type || queueId);

    const status = await queueService.getStatus(queueId);
    return res.json({ ...status, requirements: requirementsList });
  } catch (err) {
    console.error('❌ Status error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /queue/:id/position/:userId
 */
router.get('/:id/position/:userId', async (req, res) => {
  try {
    const { id: queueId, userId } = req.params;
    const userSnap = await db.ref(`queues/${queueId}/users/${userId}`).get();
    if (!userSnap.exists()) return res.status(404).json({ error: 'User not found in queue' });
    const user = userSnap.val();

    const metaSnap = await db.ref(`queues/${queueId}/meta`).get();
    const queueType = metaSnap.exists() ? (metaSnap.val().type || queueId) : queueId;

    const ahead = Math.max(0, (user.position || 1) - 1);
    const phase = user.status === 'waiting'
      ? (ahead === 0 ? 'next' : ahead <= 2 ? 'almost' : 'waiting')
      : user.status;

    return res.json({
      userId,
      name: user.name,
      token: user.token,
      position: user.position,
      ahead,
      phase,
      status: user.status,
      wait_predicted: user.wait_predicted,
      wait_confidence: user.wait_confidence,
      counter_id: user.counter_id,
      counter_type: user.counter_type,
      intent_category: user.intent_category,
      bail_probability: user.bail_probability,
      sentiment_level: user.sentiment_level,
      join_time: user.join_time,
      called_at: user.called_at || null,
      attended_at: user.attended_at || null,
      removed_reason: user.removed_reason || null,
      removed_at: user.removed_at || null,
      submitted_documents: Array.isArray(user.submitted_documents) ? user.submitted_documents : [],
      required_documents: Array.isArray(user.required_documents) && user.required_documents.length
        ? user.required_documents
        : getTailoredRequirements(queueId, queueType, user.intent_category, user.counter_id, user.counter_type),
    });
  } catch (err) {
    console.error('❌ Position check error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * POST /queue/:id/no-show/:userId  (admin) — remove a student
 */
router.post('/:id/no-show/:userId', requireAdmin, checkCellAccess, async (req, res) => {
  try {
    const { id: queueId, userId } = req.params;
    const { reason } = req.body;
    const io = req.app.get('io');
    const result = await queueService.markNoShow(queueId, userId, reason || 'no_show', io, 'admin');
    if (!result.ok) return res.status(result.reason === 'no_user' ? 404 : 400).json({ error: result.reason, status: result.status });
    const status = await queueService.getStatus(queueId);
    return res.json({ skipped_user: userId, reason: reason || 'no_show', new_queue_count: status.waiting_count, next_user: result.next_user ? result.next_user.name : null });
  } catch (err) {
    console.error('❌ No-show error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/** Backward-compatible alias for older clients/admin tooling. */
router.post('/:id/skip/:userId', requireAdmin, checkCellAccess, async (req, res) => {
  try {
    const { id: queueId, userId } = req.params;
    const { reason, source } = req.body;
    const io = req.app.get('io');
    const result = await queueService.markNoShow(queueId, userId, reason || 'no_show', io, source || 'admin');
    if (!result.ok) return res.status(result.reason === 'no_user' ? 404 : 400).json({ error: result.reason, status: result.status });
    const status = await queueService.getStatus(queueId);
    return res.json({ skipped_user: userId, reason: reason || 'no_show', source: source || 'system', new_queue_count: status.waiting_count });
  } catch (err) {
    console.error('❌ Skip error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /queue/:id/users (admin)
 */
router.get('/:id/users', requireAdmin, checkCellAccess, async (req, res) => {
  try {
    const queueId = req.params.id;
    const snapshot = await db.ref(`queues/${queueId}/users`).get();
    if (!snapshot.exists()) return res.json({ users: [], count: 0 });

    const activeUsers = Object.entries(snapshot.val())
      .filter(([, u]) => ['waiting', 'called', 'in_service'].includes(u.status))
      .map(([id, u]) => ({
        userId: id, name: u.name, token: u.token, position: u.position, status: u.status,
        intent_category: u.intent_category, intent_details: u.intent_details,
        urgency_score: u.urgency_score, bail_probability: u.bail_probability, sentiment_level: u.sentiment_level,
        wait_predicted: u.wait_predicted, counter_id: u.counter_id, priority: u.priority, join_time: u.join_time,
        submitted_documents: Array.isArray(u.submitted_documents) ? u.submitted_documents : [],
      }))
      .sort((a, b) => {
        const rank = { called: 0, in_service: 1, waiting: 2 };
        const ra = rank[a.status] ?? 3, rb = rank[b.status] ?? 3;
        if (ra !== rb) return ra - rb;
        return (a.position || 999) - (b.position || 999);
      });

    return res.json({ users: activeUsers, count: activeUsers.length });
  } catch (err) {
    console.error('❌ Users list error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

/**
 * GET /queue/:id/requirements
 */
router.get('/:id/requirements', async (req, res) => {
  try {
    const queueId = req.params.id;
    const metaSnap = await db.ref(`queues/${queueId}/meta`).get();
    const meta = metaSnap.exists() ? metaSnap.val() : { type: queueId };

    const reqSnap = await db.ref(`queues/${queueId}/meta/requirements`).get();
    if (!reqSnap.exists()) return res.json({ requirements: getDefaultRequirements(queueId, meta.type || queueId), source: 'default' });

    const requirements = reqSnap.val();
    const list = Array.isArray(requirements) ? requirements : Object.values(requirements);
    if (!list.length) return res.json({ requirements: getDefaultRequirements(queueId, meta.type || queueId), source: 'default' });
    return res.json({ requirements: list, source: 'saved' });
  } catch (err) {
    console.error('❌ Requirements fetch error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

module.exports = router;

function sendJoinSMS(user, position, waitMinutes, counterLabel) {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;
    if (!accountSid || !authToken || !fromPhone || accountSid === 'your-account-sid') return;

    const twilio = require('twilio');
    twilio(accountSid, authToken).messages.create({
      body: `Invisible Queue: You are #${position} in line. Token: ${user.token}. Est. wait ~${waitMinutes} min. Go to ${counterLabel} when called.`,
      from: fromPhone,
      to: `+91${user.phone}`,
    }).catch(() => {});
  } catch { /* non-critical */ }
}
