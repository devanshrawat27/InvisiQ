require('dotenv').config();
const { db } = require('./firebase/init');

async function clearQueue() {
  try {
    const queueId = 'fee_cell'; // Default queue
    console.log(`Clearing dummy data from queue: ${queueId}...`);

    // Remove users
    await db.ref(`queues/${queueId}/users`).remove();
    console.log('✅ Users cleared');

    // Remove stats
    await db.ref(`queues/${queueId}/stats`).remove();
    console.log('✅ Stats cleared');

    // Reset counters to idle
    const countersSnap = await db.ref(`queues/${queueId}/counters`).get();
    if (countersSnap.exists()) {
        const counters = countersSnap.val();
        for (const [counterId, counterData] of Object.entries(counters)) {
            await db.ref(`queues/${queueId}/counters/${counterId}`).update({
                current_user_id: null,
                queue_length: 0,
                service_started_at: null,
                expected_finish: null,
            });
        }
    }
    console.log('✅ Counters reset');

    console.log('🎉 Queue completely cleared!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error clearing queue:', err);
    process.exit(1);
  }
}

clearQueue();
