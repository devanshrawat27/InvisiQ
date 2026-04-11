/**
 * Auto-Advance — AI Auto-Queue Movement (NEW)
 * -----------------------------------------------
 * Replaces the manual "Call Next" button.
 * AI-driven queue advancement system.
 *
 * Triggers:
 *   1. Admin clicks Attended or Removed
 *   2. AI auto-times out after 3× avg service time for current user
 *
 * AI Usage: NONE for auto-advance logic itself.
 *           Intent data was already classified at join time.
 */

const { db, firestore } = require('../firebase/init');
const { DEFAULT_SERVICE_TIMES } = require('./counterCompass');

/**
 * Auto-advance: Call the next user in the queue.
 * @param {string} queueId
 * @param {string} counterId — Which counter to advance
 * @param {string} source — 'auto_advance' | 'timeout' | 'admin_attended' | 'admin_removed'
 * @param {object} io — Socket.io server instance
 * @returns {object} { called_user, counter, next_in_line }
 */
async function advanceQueue(queueId, counterId, source, io) {
  const result = { called_user: null, counter: counterId, next_in_line: null };

  try {
    const usersRef = db.ref(`queues/${queueId}/users`);
    const snapshot = await usersRef.get();

    if (!snapshot.exists()) return result;

    const users = snapshot.val();
    const now = Date.now();

    // ── Get sorted waiting users by urgency_score (desc) + join_time (asc) ──
    const waitingUsers = Object.entries(users)
      .filter(([, u]) => u.status === 'waiting')
      .map(([id, u]) => ({ userId: id, ...u }))
      .sort((a, b) => {
        const scoreA = a.urgency_score || 0;
        const scoreB = b.urgency_score || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return (a.join_time || 0) - (b.join_time || 0);
      });

    if (waitingUsers.length === 0) {
      console.log(`📋 Auto-Advance: No waiting users in ${queueId}`);

      // Clear counter
      await db.ref(`queues/${queueId}/counters/${counterId}`).update({
        current_user_id: null,
        service_started_at: null,
        expected_finish: null,
        auto_advance_timeout: null,
      });

      return result;
    }

    // ── Call the top user ────────────────────────────────────────
    const nextUser = waitingUsers[0];
    const avgServiceTime = DEFAULT_SERVICE_TIMES[nextUser.intent_category] || 7;

    // Update user status to 'called'
    await db.ref(`queues/${queueId}/users/${nextUser.userId}`).update({
      status: 'called',
      called_at: now,
      counter_id: counterId,
    });

    // Update counter
    await db.ref(`queues/${queueId}/counters/${counterId}`).update({
      current_user_id: nextUser.userId,
      service_started_at: null, // Not started until admin marks Attended
      expected_finish: null,
      auto_advance_timeout: now + (avgServiceTime * 3 * 60 * 1000), // 3× timeout
    });

    result.called_user = {
      userId: nextUser.userId,
      name: nextUser.name,
      token: nextUser.token,
      phone: nextUser.phone,
      intent: nextUser.intent_category,
      details: nextUser.intent_details,
      urgency_score: nextUser.urgency_score,
      counter: counterId,
    };

    // ── Next in line info ────────────────────────────────────────
    if (waitingUsers.length > 1) {
      result.next_in_line = {
        name: waitingUsers[1].name,
        urgency: waitingUsers[1].urgency_score > 40 ? 'high' : 'normal',
      };
    }

    // ── Socket.io Emissions ──────────────────────────────────────
    if (io) {
      // Notify the called user — YOUR TURN!
      io.to(`queue_${queueId}`).emit('turn_called', {
        userId: nextUser.userId,
        name: nextUser.name,
        token: nextUser.token,
        counter: counterId,
        counter_label: counterId.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
      });

      // Flash alert on the called user's screen
      io.to(`queue_${queueId}`).emit('flash_message', {
        target_user: nextUser.userId,
        message: `YOUR TURN — Please go to ${counterId.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} now. Token: ${nextUser.token}.`,
        type: 'turn_called',
        duration: 0, // Persistent — don't auto-clear
      });

      // Queue update for all users
      io.to(`queue_${queueId}`).emit('queue_update', {
        action: 'next_called',
        called_user: nextUser.name,
        counter: counterId,
        source,
      });

      // Admin event
      io.to(`admin_${queueId}`).emit('user_called', {
        userId: nextUser.userId,
        name: nextUser.name,
        token: nextUser.token,
        intent: nextUser.intent_category,
        details: nextUser.intent_details,
        counter: counterId,
        urgency_score: nextUser.urgency_score,
      });
    }

    console.log(`📢 Auto-Advance: Called ${nextUser.name} (${nextUser.token}) to ${counterId} [source: ${source}]`);

    // ── SMS Notification via Twilio ──────────────────────────────
    await sendTurnSMS(nextUser, queueId, counterId);

  } catch (err) {
    console.error('❌ Auto-Advance error:', err.message);
  }

  return result;
}

/**
 * Check for auto-timeout: if admin hasn't clicked Attended/Removed
 * within 3× avg_service_time, auto-remove the user.
 * @param {string} queueId
 * @param {object} io
 */
async function checkAutoTimeout(queueId, io) {
  try {
    const countersRef = db.ref(`queues/${queueId}/counters`);
    const snapshot = await countersRef.get();

    if (!snapshot.exists()) return;

    const counters = snapshot.val();
    const now = Date.now();

    for (const [counterId, counter] of Object.entries(counters)) {
      if (!counter.current_user_id) continue;
      if (!counter.auto_advance_timeout) continue;

      // Check if timeout has passed
      if (now > counter.auto_advance_timeout) {
        const userId = counter.current_user_id;

        console.log(`⏰ Auto-Timeout: User at ${counterId} timed out — auto-removing`);

        // Mark as removed
        await db.ref(`queues/${queueId}/users/${userId}`).update({
          status: 'removed',
          removed_reason: 'auto_timeout',
          removed_at: now,
        });

        // Auto-advance to next user
        await advanceQueue(queueId, counterId, 'timeout', io);
      }
    }
  } catch (err) {
    console.error('❌ Auto-Timeout check error:', err.message);
  }
}

/**
 * Send SMS notification via Twilio when it's the user's turn.
 * Wrapped in try-catch — SMS failure must NOT break queue flow.
 */
async function sendTurnSMS(user, queueId, counterId) {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromPhone || accountSid === 'your-account-sid') {
      console.log('📱 SMS skipped — Twilio not configured');
      return;
    }

    const twilio = require('twilio');
    const client = twilio(accountSid, authToken);

    const counterLabel = counterId.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

    await client.messages.create({
      body: `Your turn at the queue! Please go to ${counterLabel} now. Token: ${user.token}.`,
      from: fromPhone,
      to: `+91${user.phone}`, // Indian phone numbers
    });

    console.log(`📱 SMS sent to ${user.phone.slice(-4)}`);
  } catch (err) {
    // SMS failure must NOT break queue flow
    console.warn('⚠️  SMS send failed (non-blocking):', err.message);
  }
}

module.exports = { advanceQueue, checkAutoTimeout };
