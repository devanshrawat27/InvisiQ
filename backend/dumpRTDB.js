require('dotenv').config();
const { db } = require('./firebase/init');

async function dump() {
  try {
    const snap = await db.ref('queues').get();
    if (!snap.exists()) {
      console.log('No data found in RTDB');
      process.exit(0);
    }
    const data = snap.val();
    console.log('=== REALTIME DATABASE STATE ===');
    for (const [queueId, queueData] of Object.entries(data)) {
      console.log(`\nQueue: ${queueId}`);
      if (queueData.meta) {
        console.log(`  Meta: ${JSON.stringify(queueData.meta)}`);
      }
      if (queueData.stats) {
        console.log(`  Stats: ${JSON.stringify(queueData.stats)}`);
      }
      if (queueData.users) {
        console.log(`  Users:`);
        for (const [userId, user] of Object.entries(queueData.users)) {
          console.log(`    - [${userId}] Name: ${user.name}, Token: ${user.token}, Status: ${user.status}, Position: ${user.position}`);
        }
      } else {
        console.log(`  Users: (none)`);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error('Error dumping data:', err);
    process.exit(1);
  }
}

dump();
