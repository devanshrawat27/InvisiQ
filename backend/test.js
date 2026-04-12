/**
 * Test Script — Invisible Queue System Backend
 * ------------------------------------------------
 * Runs through all major API endpoints to verify functionality.
 * Start the server first: npm run dev
 * Then run: node test.js
 */

const http = require('http');

function makeRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
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
  console.log('║   🧪 INVISIBLE QUEUE SYSTEM — Backend Test Suite        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  let passed = 0;
  let failed = 0;

  async function test(label, fn) {
    try {
      await fn();
      passed++;
      console.log(`   ✅ PASS\n`);
    } catch (err) {
      failed++;
      console.log(`   ❌ FAIL: ${err.message}\n`);
    }
  }

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

  // 5. Seed Demo Users
  await test('5️⃣  Seed Demo Users', async () => {
    console.log('5️⃣  Seed Demo Users');
    const seed = await makeRequest('POST', '/api/v1/admin/queue/fee_cell/seed');
    console.log(`   Status: ${seed.status} | Seeded: ${seed.data.users?.length} users`);
    seed.data.users?.forEach(u => console.log(`   - ${u.name} (#${u.position}) — ${u.intent}`));
    if (seed.status !== 200) throw new Error('Seed failed');
  });

  const randomPhone = `9999${Math.floor(100000 + Math.random() * 900000)}`;

  // 6. Join Queue (new user)
  await test('6️⃣  Join Queue (new student)', async () => {
    console.log('6️⃣  Join Queue (new student)');
    const join = await makeRequest('POST', '/api/v1/queue/fee_cell/join', {
      name: 'Test Student',
      phone: randomPhone,
      visit_reason: 'need to pay my semester fees urgently',
      priority: 'normal',
    });
    console.log(`   Status: ${join.status} | Token: ${join.data.token} | Position: ${join.data.position}`);
    console.log(`   Intent: ${join.data.intent_category} | Wait: ${join.data.wait_minutes}min (${join.data.confidence}% confidence)`);
    console.log(`   Counter: ${join.data.counter_label}`);
    console.log(`   Flash: ${join.data.flash_message}`);
    if (join.status !== 201) throw new Error('Join failed');
  });

  // 7. Fraud Detection (duplicate phone)
  await test('7️⃣  Fraud Detection (duplicate phone)', async () => {
    console.log('7️⃣  Fraud Detection (duplicate phone)');
    const fraud = await makeRequest('POST', '/api/v1/queue/fee_cell/join', {
      name: 'Fraud User',
      phone: randomPhone,
      visit_reason: 'testing duplicate',
      priority: 'normal',
    });
    console.log(`   Status: ${fraud.status} | Blocked: ${fraud.status === 403}`);
    console.log(`   Reason: ${fraud.data.reason} — ${fraud.data.message}`);
    if (fraud.status !== 403) throw new Error('Fraud detection failed');
  });

  // 8. Get Queue Users
  await test('8️⃣  Get Queue Users', async () => {
    console.log('8️⃣  Get Queue Users');
    const users = await makeRequest('GET', '/api/v1/queue/fee_cell/users');
    console.log(`   Active Users: ${users.data.count}`);
    users.data.users?.forEach(u =>
      console.log(`   - ${u.name} (#${u.position}) — ${u.intent_category} | bail: ${u.bail_probability}% | urgency: ${u.urgency_score}`)
    );
    if (users.status !== 200) throw new Error('Users list failed');
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
    console.log(`   Peak: ${briefing.data.expected_peak}`);
    console.log(`   Staff: ${briefing.data.staff_recommendation}`);
    console.log(`   Score: ${briefing.data.efficiency_score}`);
    console.log(`   Tip: ${briefing.data.actionable_tip}`);
    if (briefing.status !== 200) throw new Error('Briefing failed');
  });

  // 11. Briefing Trigger
  await test('1️⃣1️⃣ Briefing Manual Trigger', async () => {
    console.log('1️⃣1️⃣ Briefing Manual Trigger');
    const trigger = await makeRequest('POST', '/api/v1/admin/briefing/trigger', {
      queue_id: 'fee_cell',
    });
    console.log(`   Status: ${trigger.status} | Source: ${trigger.data.source}`);
    if (trigger.status !== 200) throw new Error('Briefing trigger failed');
  });

  // 12. Internal Auto-Advance
  await test('1️⃣2️⃣ Internal Auto-Advance (POST /next)', async () => {
    console.log('1️⃣2️⃣ Internal Auto-Advance (POST /next)');
    const advance = await makeRequest('POST', '/api/v1/admin/queue/fee_cell/next', {
      counter_id: 'counter_1',
      source: 'auto_advance',
    });
    console.log(`   Status: ${advance.status}`);
    console.log(`   Called User: ${advance.data.called_user?.name || 'none'}`);
    console.log(`   Counter: ${advance.data.counter}`);
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
    });
    console.log(`   Status: ${join.status} | Blocked: ${join.status === 403}`);
    console.log(`   Message: ${join.data.message}`);
    if (join.status !== 403) throw new Error('Pause block failed');
  });

  // 15. Queue Resume
  await test('1️⃣5️⃣ Queue Resume', async () => {
    console.log('1️⃣5️⃣ Queue Resume');
    const resume = await makeRequest('POST', '/api/v1/admin/queue/fee_cell/resume');
    console.log(`   Status: ${resume.status} | Queue Status: ${resume.data.status}`);
    if (resume.data.status !== 'open') throw new Error('Resume failed');
  });

  // 16. Skip User (Ghost Buster simulation)
  await test('1️⃣6️⃣ Skip User (Ghost Buster)', async () => {
    console.log('1️⃣6️⃣ Skip User (Ghost Buster)');
    const usersResp = await makeRequest('GET', '/api/v1/queue/fee_cell/users');
    const waitingUser = usersResp.data.users?.find(u => u.status === 'waiting');
    if (waitingUser) {
      const skip = await makeRequest('POST', `/api/v1/queue/fee_cell/skip/${waitingUser.userId}`, {
        reason: 'no_show',
        source: 'ghost_buster',
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
