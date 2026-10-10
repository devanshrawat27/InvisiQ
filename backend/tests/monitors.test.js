/**
 * Unit tests — queue service & monitors (in-memory, no server / no network)
 * Run: node tests/monitors.test.js   (or: npm run test:unit)
 */

process.env.MOCK_MODE = 'true';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.FIREBASE_PROJECT_ID = 'x';
process.env.FIREBASE_DATABASE_URL = 'https://x.firebaseio.com';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----invalid-----END PRIVATE KEY-----';
process.env.FIREBASE_CLIENT_EMAIL = 'x@x.iam.gserviceaccount.com';

const { db } = require('../firebase/init');
const queueService = require('../services/queueService');
const { runGhostBuster } = require('../monitors/ghostBuster');
const { runCongestionOracle } = require('../monitors/congestionOracle');
const { runUrgencyEngine } = require('../monitors/urgencyEngine');
const { runFraudScanner } = require('../monitors/fraudScanner');
const { runCounterCompass } = require('../monitors/counterCompass');

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`   ✅ ${name}`); }
  else { failed++; console.log(`   ❌ ${name} ${extra}`); }
}

async function makeQueue(id, settings = {}) {
  await db.ref(`queues/${id}/meta`).set({ name: id, type: id, status: 'open', counters_open: 1, settings });
  await db.ref(`queues/${id}/stats`).set({ avg_service_time: 7, total_served: 0, joins_last_5min: 0, token_seq: 0, waiting_count: 0 });
  await db.ref(`queues/${id}/counters/counter_1`).set({ label: 'Counter 1', status: 'idle', current_user_id: null, supported_types: [] });
}

function prepared(phone, over = {}) {
  return {
    name: `U${phone.slice(-3)}`, phone, visit_reason: 'fee payment', intent_category: 'fee_payment',
    intent_details: 'fee', intent_urgency: 'low', urgency_score: 10, priority: 'normal',
    counter_id: 'counter_1', counter_type: 'cashier', submitted_documents: [], required_documents: [], ...over,
  };
}

async function run() {
  console.log('\n🧪 Queue Service & Monitors — unit tests\n');

  // 1. Concurrent joins => unique tokens & positions
  await makeQueue('unit_c');
  const phones = Array.from({ length: 8 }, (_, i) => `90000000${String(i).padStart(2, '0')}`);
  const enq = await Promise.all(phones.map(p => queueService.enqueueUser('unit_c', prepared(p))));
  const okEnq = enq.filter(e => e.ok);
  check('concurrent joins all succeed', okEnq.length === 8, `(${okEnq.length}/8)`);
  check('tokens unique', new Set(okEnq.map(e => e.token)).size === 8);
  check('positions unique 1..8', new Set(okEnq.map(e => e.position)).size === 8);

  // 2. Priority ordering (emergency first)
  await makeQueue('unit_p');
  const a = await queueService.enqueueUser('unit_p', prepared('9111111111', { priority: 'normal' }));
  const b = await queueService.enqueueUser('unit_p', prepared('9222222222', { priority: 'emergency' }));
  const c = await queueService.enqueueUser('unit_p', prepared('9333333333', { priority: 'elderly' }));
  const pUsersSnap = await db.ref('queues/unit_p/users').get();
  const first = Object.values(pUsersSnap.val()).find(u => u.position === 1);
  check('emergency user gets position 1', first.phone === '9222222222', `(got ${first.phone})`);
  check('positions assigned', [a.position, b.position, c.position].every(p => p >= 1));

  // 3. Counter busy lifecycle
  await makeQueue('unit_l');
  const u1 = await queueService.enqueueUser('unit_l', prepared('9444444444'));
  const call1 = await queueService.callNext('unit_l', 'counter_1', null, 'test');
  check('callNext succeeds', call1.ok === true);
  const call2 = await queueService.callNext('unit_l', 'counter_1', null, 'test');
  check('second callNext blocked (busy)', call2.ok === false && ['counter_busy', 'counter_in_service'].includes(call2.reason), `(${call2.reason})`);
  const callUnknown = await queueService.callNext('unit_l', 'nope', null, 'test');
  check('unknown counter rejected', callUnknown.ok === false && callUnknown.reason === 'unknown_counter');
  const arr = await queueService.markArrived('unit_l', u1.userId, null, null);
  check('markArrived works', arr.ok === true);
  const done = await queueService.markComplete('unit_l', u1.userId, null);
  check('markComplete works', done.ok === true);
  const cSnap = await db.ref('queues/unit_l/counters/counter_1').get();
  check('counter idle after complete', queueService.counterStatus(cSnap.val()) === 'idle');
  const statsSnap = await db.ref('queues/unit_l/stats').get();
  check('total_served incremented', statsSnap.val().total_served === 1);

  // 4. Ghost Buster — advisory default, removal only when opted in
  await makeQueue('unit_g', { auto_remove_ghosts: false, ghost_grace_minutes: 15 });
  const g1 = await queueService.enqueueUser('unit_g', prepared('9555555555'));
  await db.ref(`queues/unit_g/users/${g1.userId}/last_seen`).set(Date.now() - 13 * 60 * 1000); // 13 min ago
  const ghostOff = await runGhostBuster('unit_g', null);
  check('ghost flagged when disconnected', ghostOff.flagged >= 1, `(flagged ${ghostOff.flagged})`);
  check('ghost NOT removed by default', ghostOff.removed === 0, `(removed ${ghostOff.removed})`);
  const stillThere = await db.ref(`queues/unit_g/users/${g1.userId}`).get();
  check('student still waiting (not silently removed)', stillThere.val().status === 'waiting');

  await db.ref(`queues/unit_g/users/${g1.userId}/last_seen`).set(Date.now() - 60 * 60 * 1000); // 60 min ago
  await db.ref('queues/unit_g/meta/settings').update({ auto_remove_ghosts: true });
  const ghostOn = await runGhostBuster('unit_g', null);
  check('ghost removed when automation enabled', ghostOn.removed >= 1, `(removed ${ghostOn.removed})`);

  // 5. Crowd / surge analysis produces recommendations
  await makeQueue('unit_s');
  await db.ref('queues/unit_s/stats').update({ joins_last_5min: 50, avg_wait_live: 90 });
  await queueService.enqueueUser('unit_s', prepared('9666666666'));
  const crowd = await runCongestionOracle('unit_s', null);
  check('surge detected', crowd.surge_detected === true);
  check('recommendations produced', Array.isArray(crowd.recommendations) && crowd.recommendations.length > 0, `(${crowd.recommendations.length})`);
  const crowdSnap = await db.ref('queues/unit_s/stats/crowd').get();
  check('crowd stored on stats', crowdSnap.exists());

  // 6. Full queue / last counter protection
  await makeQueue('unit_r');
  const rem = await queueService.removeCounter('unit_r', 'counter_1', null);
  check('cannot remove last counter', rem.ok === false && rem.reason === 'last_counter');

  // 7. enqueue on paused queue rejected by service
  await makeQueue('unit_x');
  await queueService.setQueueStatus('unit_x', 'paused', null);
  const pausedJoin = await queueService.enqueueUser('unit_x', prepared('9777777777'));
  check('paused queue rejects enqueue', pausedJoin.ok === false && pausedJoin.reason === 'paused', `(${pausedJoin.reason})`);

  // 8. Safety net: a 'called' student with no counter is NEVER auto-removed
  await makeQueue('unit_o');
  const o1 = await queueService.enqueueUser('unit_o', prepared('9888888888'));
  await db.ref(`queues/unit_o/users/${o1.userId}`).update({ status: 'called', counter_id: null });
  await queueService.recomputeQueue('unit_o', null, 'test');
  const afterOrphan = (await db.ref(`queues/unit_o/users/${o1.userId}`).get()).val();
  check('called-without-counter put back to waiting (never removed)', afterOrphan.status === 'waiting', `(got ${afterOrphan.status})`);

  // 9. All monitors run without error + status shape
  await makeQueue('unit_m');
  await queueService.enqueueUser('unit_m', prepared('9111110001'));
  await queueService.enqueueUser('unit_m', prepared('9111110002'));
  const u = await runUrgencyEngine('unit_m', null);
  const f = await runFraudScanner('unit_m', null);
  const cc = await runCounterCompass('unit_m', null);
  check('urgencyEngine runs', u && typeof u.rescored === 'number');
  check('fraudScanner runs', f && typeof f.scanned === 'number');
  check('counterCompass runs', cc && typeof cc.counters_checked === 'number');
  const st = await queueService.getStatus('unit_m');
  check('getStatus returns counters + counts', Array.isArray(st.counters) && typeof st.waiting_count === 'number');
  check('getStatus waiting_count correct', st.waiting_count === 2, `(got ${st.waiting_count})`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🏁 Unit results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════\n');
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
