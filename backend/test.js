/**
 * Test Script — Invisible Queue System Backend
 * ------------------------------------------------
 * Runs through all major API endpoints to verify functionality.
 *
 * Start the server first (fresh data recommended): npm run dev
 * Then run: node test.js
 *
 * Requires the seeded super-admin account (default: superadmin / Super@123).
 * Override with ADMIN_USERNAME / ADMIN_PASSWORD env vars.
 */

const http = require('http');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'superadmin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Super@123';

let adminToken = null;

function makeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: process.env.PORT || 5000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   🧪 INVISIBLE QUEUE SYSTEM — Backend Test Suite         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  let passed = 0;
  let failed = 0;

  async function test(label, fn) {
    try {
      await fn();
      passed++;
      console.log('   ✅ PASS\n');
    } catch (err) {
      failed++;
      console.log(`   ❌ FAIL: ${err.message}\n`);
    }
  }

  // 0. Admin Login (obtains a real JWT — no bypass tokens)
  await test('0️⃣  Admin Login', async () => {
    console.log('0️⃣  Admin Login');
    const login = await makeRequest('POST', '/api/v1/auth/login', {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    });
    console.log(`   Status: ${login.status} | Role: ${login.data.user?.role}`);
    if (login.status !== 200 || !login.data.token) throw new Error('Login failed');
    adminToken = login.data.token;
  });

  // 1. Health Check
  await test('1️⃣  Health Check', async () => {
    console.log('1️⃣  Health Check');
    const health = await makeRequest('GET', '/api/health');
    console.log(`   Status: ${health.status} | Mock Mode: ${health.data.mock_mode}`);
    if (health.status !== 200) throw new Error('Health check failed');
  });

  // 2. Root Info
  await test('2️⃣  Root API Info', async () => {
    console.log('2️⃣  Root API Info');
    const root = await makeRequest('GET', '/');
    console.log(`   Status: ${root.status} | Endpoints: ${Object.keys(root.data.endpoints || {}).length}`);
    if (root.status !== 200) throw new Error('Root info failed');
  });

  // 3. Create Queue
  await test('3️⃣  Create Queue (fee_cell)', async () => {
    console.log('3️⃣  Create Queue (fee_cell)');
    const createQ = await makeRequest('POST', '/api/v1/admin/queue/create', {
      queue_id: 'fee_cell',
      name: 'Fee Cell',
      type: 'fee_cell',
      counters_open: 1,
    });
    console.log(`   Status: ${createQ.status} | Queue: ${createQ.data.name} | Counters: ${createQ.data.counters_open}`);
    if (createQ.status !== 201) throw new Error('Queue creation failed');
  });

  // 4. Get Queue Status
  await test('4️⃣  Queue Status', async () => {
    console.log('4️⃣  Queue Status');
    const status = await makeRequest('GET', '/api/v1/queue/fee_cell/status');
    console.log(`   Status: ${status.status} | Count: ${status.data.count} | Name: ${status.data.queue_name}`);
    if (status.status !== 200) throw new Error('Queue status failed');
  });

  const randomPhone = `9999${Math.floor(100000 + Math.random() * 900000)}`;

  // 6. Join Queue (new user)
  await test('6️⃣  Join Queue (new student)', async () => {
    console.log('6️⃣  Join Queue (new student)');
    const join = await makeRequest('POST', '/api/v1/queue/fee_cell/join', {
      name: 'Test Student',
      phone: randomPhone,
      visit_reason: 'need to pay my semester fees urgently',
      form_fill_ms: 8000,
    });
    console.log(`   Status: ${join.status} | Token: ${join.data.token} | Position: ${join.data.position}`);
    console.log(`   Intent: ${join.data.intent_category} | Wait: ${join.data.wait_minutes}min (${join.data.confidence}% confidence)`);
    console.log(`   Counter: ${join.data.counter_label}`);
    if (join.status !== 201) throw new Error('Join failed');
  });

  // 7. Fraud Detection (duplicate phone)
  await test('7️⃣  Fraud Detection (duplicate phone)', async () => {
    console.log('7️⃣  Fraud Detection (duplicate phone)');
    const fraud = await makeRequest('POST', '/api/v1/queue/fee_cell/join', {
      name: 'Fraud User',
      phone: randomPhone,
      visit_reason: 'testing duplicate',
      form_fill_ms: 8000,
    });
    console.log(`   Status: ${fraud.status} | Blocked: ${fraud.status === 403}`);
    console.log(`   Reason: ${fraud.data.reason} — ${fraud.data.message}`);
    if (fraud.status !== 403) throw new Error('Fraud detection failed');
  });

  // 7b. Fast form fill is advisory (should NOT block a real user)
  await test('7️⃣b Fast fill is advisory (not blocked)', async () => {
    console.log('7️⃣b Fast fill is advisory (not blocked)');
    const fastPhone = `9997${Math.floor(100000 + Math.random() * 900000)}`;
    const fast = await makeRequest('POST', '/api/v1/queue/fee_cell/join', {
      name: 'Fast User',
      phone: fastPhone,
      visit_reason: 'need fee payment details urgently',
      form_fill_ms: 120,
    });
    console.log(`   Status: ${fast.status} (expected 201 — advisory only)`);
    if (fast.status !== 201) throw new Error('Fast fill wrongly blocked a real user');
  });

  // 8. Get Queue Users (admin-only)
  await test('8️⃣  Get Queue Users (admin)', async () => {
    console.log('8️⃣  Get Queue Users (admin)');
    const users = await makeRequest('GET', '/api/v1/queue/fee_cell/users');
    console.log(`   Active Users: ${users.data.count}`);
    if (users.status !== 200) throw new Error('Users list failed');
  });

  // 8b. Users endpoint rejects anonymous access
  await test('8️⃣b Users endpoint requires auth', async () => {
    console.log('8️⃣b Users endpoint requires auth');
    const saved = adminToken;
    adminToken = null;
    const anon = await makeRequest('GET', '/api/v1/queue/fee_cell/users');
    adminToken = saved;
    console.log(`   Status: ${anon.status} (expected 401/403)`);
    if (anon.status !== 401 && anon.status !== 403) throw new Error('Auth not enforced');
  });

  // 9. User Position Check
  await test('9️⃣  User Position Check', async () => {
    console.log('9️⃣  User Position Check');
    const users = await makeRequest('GET', '/api/v1/queue/fee_cell/users');
    const firstUser = users.data.users?.[0];
    if (firstUser) {
      const pos = await makeRequest('GET', `/api/v1/queue/fee_cell/position/${firstUser.userId}`);
      console.log(`   User: ${pos.data.name} | Position: ${pos.data.position} | Status: ${pos.data.status}`);
      if (pos.status !== 200) throw new Error('Position check failed');
    } else {
      console.log('   ⚠️  No users to check');
    }
  });

  // 10. AI Morning Briefing
  await test('🔟 AI Morning Briefing', async () => {
    console.log('🔟 AI Morning Briefing');
    const briefing = await makeRequest('GET', '/api/v1/admin/queue/fee_cell/briefing');
    console.log(`   Status: ${briefing.status}`);
    if (briefing.status !== 200) throw new Error('Briefing failed');
  });

  // 11. Briefing Trigger (200 with data, 422 without)
  await test('1️⃣1️⃣ Briefing Manual Trigger', async () => {
    console.log('1️⃣1️⃣ Briefing Manual Trigger');
    const trigger = await makeRequest('POST', '/api/v1/admin/briefing/trigger', { queue_id: 'fee_cell' });
    console.log(`   Status: ${trigger.status} | Source: ${trigger.data.source || trigger.data.error}`);
    if (trigger.status !== 200 && trigger.status !== 422) throw new Error('Briefing trigger failed');
  });

  // 12. Internal Auto-Advance
  await test('1️⃣2️⃣ Internal Auto-Advance (POST /next)', async () => {
    console.log('1️⃣2️⃣ Internal Auto-Advance (POST /next)');
    const advance = await makeRequest('POST', '/api/v1/admin/queue/fee_cell/next', {
      counter_id: 'counter_1',
      source: 'auto_advance',
    });
    console.log(`   Status: ${advance.status} | Called: ${advance.data.called_user?.name || 'none'}`);
    if (advance.status !== 200) throw new Error('Auto-advance failed');
  });

  // 13. Queue Pause
  await test('1️⃣3️⃣ Queue Pause', async () => {
    console.log('1️⃣3️⃣ Queue Pause');
    const pause = await makeRequest('POST', '/api/v1/admin/queue/fee_cell/pause');
    console.log(`   Status: ${pause.status} | Queue Status: ${pause.data.status}`);
    if (pause.data.status !== 'paused') throw new Error('Pause failed');
  });

  // 14. Join Blocked When Paused
  await test('1️⃣4️⃣ Join Blocked When Paused', async () => {
    console.log('1️⃣4️⃣ Join Blocked When Paused');
    const join = await makeRequest('POST', '/api/v1/queue/fee_cell/join', {
      name: 'Blocked Student',
      phone: '8888888888',
      visit_reason: 'testing pause',
      form_fill_ms: 9000,
    });
    console.log(`   Status: ${join.status} | Blocked: ${join.status === 403}`);
    if (join.status !== 403) throw new Error('Pause block failed');
  });

  // 15. Queue Resume
  await test('1️⃣5️⃣ Queue Resume', async () => {
    console.log('1️⃣5️⃣ Queue Resume');
    const resume = await makeRequest('POST', '/api/v1/admin/queue/fee_cell/resume');
    console.log(`   Status: ${resume.status} | Queue Status: ${resume.data.status}`);
    if (resume.data.status !== 'open') throw new Error('Resume failed');
  });

  // 16. Skip User (admin)
  await test('1️⃣6️⃣ Skip User (admin)', async () => {
    console.log('1️⃣6️⃣ Skip User (admin)');
    const usersResp = await makeRequest('GET', '/api/v1/queue/fee_cell/users');
    const waitingUser = usersResp.data.users?.find(u => u.status === 'waiting');
    if (waitingUser) {
      const skip = await makeRequest('POST', `/api/v1/queue/fee_cell/skip/${waitingUser.userId}`, {
        reason: 'no_show',
        source: 'admin',
      });
      console.log(`   Skipped: ${skip.data.skipped_user} | Remaining: ${skip.data.new_queue_count}`);
      if (skip.status !== 200) throw new Error('Skip failed');
    } else {
      console.log('   ⚠️  No waiting users to skip');
    }
  });

  // 17. 404 Test
  await test('1️⃣7️⃣ 404 Handler', async () => {
    console.log('1️⃣7️⃣ 404 Handler');
    const notFound = await makeRequest('GET', '/api/v1/nonexistent');
    console.log(`   Status: ${notFound.status} | Error: ${notFound.data.error}`);
    if (notFound.status !== 404) throw new Error('404 handler failed');
  });

  // 18. Unknown queue join rejected
  await test('1️⃣8️⃣ Join unknown queue rejected', async () => {
    console.log('1️⃣8️⃣ Join unknown queue rejected');
    const join = await makeRequest('POST', '/api/v1/queue/does_not_exist/join', {
      name: 'Ghost',
      phone: '7777777777',
      visit_reason: 'nothing',
      form_fill_ms: 9000,
    });
    console.log(`   Status: ${join.status} (expected 404)`);
    if (join.status !== 404) throw new Error('Unknown queue was not rejected');
  });

  // ── Higher-load / new-workflow scenarios ─────────────────────

  // 19. Concurrent joins → unique tokens & positions
  await test('1️⃣9️⃣ Concurrent joins (unique tokens)', async () => {
    console.log('1️⃣9️⃣ Concurrent joins (unique tokens)');
    await makeRequest('POST', '/api/v1/admin/queue/create', { queue_id: 'test_concurrent', name: 'Concurrent Cell', type: 'test_concurrent', counters_open: 1 });
    const phones = Array.from({ length: 8 }, (_, i) => `70000000${String(i).padStart(2, '0')}`);
    const results = await Promise.all(phones.map((p) => makeRequest('POST', '/api/v1/queue/test_concurrent/join', {
      name: `C${p.slice(-2)}`, phone: p, visit_reason: 'fee payment test', form_fill_ms: 9000,
    })));
    const ok = results.filter(r => r.status === 201);
    const tokens = ok.map(r => r.data.token);
    const positions = ok.map(r => r.data.position);
    console.log(`   201s: ${ok.length}/8 | unique tokens: ${new Set(tokens).size} | positions: ${positions.join(',')}`);
    if (ok.length !== 8) throw new Error('not all concurrent joins succeeded');
    if (new Set(tokens).size !== 8) throw new Error('duplicate tokens');
    if (new Set(positions).size !== 8) throw new Error('duplicate positions');
  });

  // 20. Call-next & counter-busy handling
  await test('2️⃣0️⃣ Call-next & counter-busy handling', async () => {
    console.log('2️⃣0️⃣ Call-next & counter-busy handling');
    const first = await makeRequest('POST', '/api/v1/admin/queue/test_concurrent/call-next', { counter_id: 'counter_1' });
    const second = await makeRequest('POST', '/api/v1/admin/queue/test_concurrent/call-next', { counter_id: 'counter_1' });
    console.log(`   first: ${first.status} | second: ${second.status} (expect 409)`);
    if (first.status !== 200) throw new Error('call-next failed');
    if (second.status !== 409) throw new Error('counter-busy not enforced');
  });

  // 21. No-show frees the counter
  await test('2️⃣1️⃣ No-show removes & frees counter', async () => {
    console.log('2️⃣1️⃣ No-show removes & frees counter');
    const users = await makeRequest('GET', '/api/v1/queue/test_concurrent/users');
    const called = (users.data.users || []).find(u => u.status === 'called');
    if (!called) throw new Error('no called user found');
    const ns = await makeRequest('POST', `/api/v1/queue/test_concurrent/no-show/${called.userId}`, { reason: 'no_show' });
    console.log(`   no-show: ${ns.status}`);
    if (ns.status !== 200) throw new Error('no-show failed');
    const again = await makeRequest('POST', '/api/v1/admin/queue/test_concurrent/call-next', { counter_id: 'counter_1' });
    if (again.status !== 200) throw new Error('counter not freed after no-show');
  });

  // 22. Settings roundtrip
  await test('2️⃣2️⃣ Queue settings roundtrip', async () => {
    console.log('2️⃣2️⃣ Queue settings roundtrip');
    const set = await makeRequest('POST', '/api/v1/admin/queue/test_concurrent/settings', { auto_advance: true, limit_joins_on_surge: true, max_wait_minutes: 30 });
    console.log(`   saved: auto_advance=${set.data.settings?.auto_advance}, limit_joins=${set.data.settings?.limit_joins_on_surge}`);
    if (set.status !== 200 || set.data.settings.auto_advance !== true) throw new Error('settings not saved');
    const get = await makeRequest('GET', '/api/v1/admin/queue/test_concurrent/settings');
    if (get.data.settings.max_wait_minutes !== 30) throw new Error('settings not persisted');
  });

  // 23. Add & remove counters
  await test('2️⃣3️⃣ Add & remove counters', async () => {
    console.log('2️⃣3️⃣ Add & remove counters');
    const add = await makeRequest('POST', '/api/v1/admin/queue/test_concurrent/counters', { action: 'add', label: 'Counter 2' });
    if (add.status !== 200) throw new Error('add counter failed');
    const st = await makeRequest('GET', '/api/v1/queue/test_concurrent/status');
    if (!st.data.counters.some(c => c.id === add.data.added)) throw new Error('counter not present in status');
    const rem = await makeRequest('POST', '/api/v1/admin/queue/test_concurrent/counters', { action: 'remove', counter_id: add.data.added });
    console.log(`   added ${add.data.added}, removed → ${rem.status}`);
    if (rem.status !== 200) throw new Error('remove counter failed');
  });

  // 24. Closed queue rejects joins
  await test('2️⃣4️⃣ Closed queue rejects joins', async () => {
    console.log('2️⃣4️⃣ Closed queue rejects joins');
    await makeRequest('POST', '/api/v1/admin/queue/create', { queue_id: 'test_closed', name: 'Closed Cell', type: 'test_closed', counters_open: 1 });
    const close = await makeRequest('POST', '/api/v1/admin/queue/test_closed/close');
    const join = await makeRequest('POST', '/api/v1/queue/test_closed/join', { name: 'Nope', phone: '7999999999', visit_reason: 'test', form_fill_ms: 9000 });
    console.log(`   close: ${close.status} | join blocked: ${join.status}`);
    if (close.status !== 200) throw new Error('close failed');
    if (join.status !== 403) throw new Error('closed queue did not reject join');
  });

  // 25. Analytics endpoint fields
  await test('2️⃣5️⃣ Analytics endpoint (fields for Reports page)', async () => {
    console.log('2️⃣5️⃣ Analytics endpoint');
    const a = await makeRequest('GET', '/api/v1/admin/queue/fee_cell/analytics?range=today');
    console.log(`   Status: ${a.status} | served: ${a.data.total_served_today} | avgwait: ${a.data.avg_wait} | accuracy: ${a.data.prediction_accuracy}%`);
    if (a.status !== 200) throw new Error('analytics failed');
    for (const f of ['heatmap_data', 'intent_breakdown', 'total_served_today', 'no_show_rate', 'avg_wait', 'prediction_accuracy']) {
      if (!(f in a.data)) throw new Error('analytics missing field: ' + f);
    }
  });

  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`🏁 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed === 0) {
    console.log('🏆 ALL TESTS PASSED — Backend is ready!');
  } else {
    console.log(`⚠️  ${failed} test(s) failed — review above`);
  }
  console.log('═══════════════════════════════════════════════════════════\n');
}

runTests().catch(console.error);
