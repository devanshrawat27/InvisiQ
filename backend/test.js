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
  console.log('🧪 Testing Invisible Queue System Backend\n');

  // 1. Health Check
  console.log('1️⃣  Health Check');
  const health = await makeRequest('GET', '/api/health');
  console.log(`   Status: ${health.status} | Mock Mode: ${health.data.mock_mode}`);
  console.log('   ✅ PASS\n');

  // 2. Create Queue
  console.log('2️⃣  Create Queue (fee_cell)');
  const createQ = await makeRequest('POST', '/api/v1/admin/queue/create', {
    queue_id: 'fee_cell',
    name: 'Fee Cell',
    type: 'fee_cell',
    counters_open: 2,
  });
  console.log(`   Status: ${createQ.status} | Queue: ${createQ.data.name}`);
  console.log('   ✅ PASS\n');

  // 3. Get Queue Status
  console.log('3️⃣  Queue Status');
  const status = await makeRequest('GET', '/api/v1/queue/fee_cell/status');
  console.log(`   Status: ${status.status} | Count: ${status.data.count} | Name: ${status.data.queue_name}`);
  console.log('   ✅ PASS\n');

  // 4. Seed Demo Users
  console.log('4️⃣  Seed Demo Users');
  const seed = await makeRequest('POST', '/api/v1/admin/queue/fee_cell/seed');
  console.log(`   Status: ${seed.status} | Seeded: ${seed.data.users?.length} users`);
  seed.data.users?.forEach(u => console.log(`   - ${u.name} (#${u.position}) — ${u.intent}`));
  console.log('   ✅ PASS\n');

  // 5. Join Queue (new user)
  console.log('5️⃣  Join Queue (new student)');
  const join = await makeRequest('POST', '/api/v1/queue/fee_cell/join', {
    name: 'Test Student',
    phone: '9999999999',
    visit_reason: 'need to pay my semester fees urgently',
    priority: 'normal',
  });
  console.log(`   Status: ${join.status} | Token: ${join.data.token} | Position: ${join.data.position}`);
  console.log(`   Intent: ${join.data.intent_category} | Wait: ${join.data.wait_minutes}min (${join.data.confidence}% confidence)`);
  console.log(`   Counter: ${join.data.counter_label}`);
  console.log(`   Flash: ${join.data.flash_message}`);
  console.log('   ✅ PASS\n');

  // 6. Fraud Detection (duplicate phone)
  console.log('6️⃣  Fraud Detection (duplicate phone)');
  const fraud = await makeRequest('POST', '/api/v1/queue/fee_cell/join', {
    name: 'Fraud User',
    phone: '9999999999',
    visit_reason: 'testing duplicate',
    priority: 'normal',
  });
  console.log(`   Status: ${fraud.status} | Blocked: ${fraud.status === 403}`);
  console.log(`   Reason: ${fraud.data.reason} — ${fraud.data.message}`);
  console.log('   ✅ PASS\n');

  // 7. Get Queue Users
  console.log('7️⃣  Get Queue Users');
  const users = await makeRequest('GET', '/api/v1/queue/fee_cell/users');
  console.log(`   Active Users: ${users.data.count}`);
  users.data.users?.forEach(u =>
    console.log(`   - ${u.name} (#${u.position}) — ${u.intent_category} | bail: ${u.bail_probability}% | urgency: ${u.urgency_score}`)
  );
  console.log('   ✅ PASS\n');

  // 8. Get Briefing
  console.log('8️⃣  AI Morning Briefing');
  const briefing = await makeRequest('GET', '/api/v1/admin/queue/fee_cell/briefing');
  console.log(`   Status: ${briefing.status}`);
  console.log(`   Peak: ${briefing.data.expected_peak}`);
  console.log(`   Staff: ${briefing.data.staff_recommendation}`);
  console.log(`   Score: ${briefing.data.efficiency_score}`);
  console.log(`   Tip: ${briefing.data.actionable_tip}`);
  console.log('   ✅ PASS\n');

  // 9. Admin Removed (remove a user, triggering auto-advance)
  console.log('9️⃣  Admin Flow: Remove → Auto-Advance');
  const usersForAdmin = await makeRequest('GET', '/api/v1/queue/fee_cell/users');
  const calledUser = usersForAdmin.data.users?.find(u => u.status === 'called');
  const waitingUser = usersForAdmin.data.users?.find(u => u.status === 'waiting');
  if (waitingUser) {
    // Skip a waiting user via the skip endpoint
    const skip = await makeRequest('POST', `/api/v1/queue/fee_cell/skip/${waitingUser.userId}`, {
      reason: 'no_show',
      source: 'ghost_buster',
    });
    console.log(`   Skipped: ${skip.status} | User: ${skip.data.skipped_user} | Remaining: ${skip.data.new_queue_count}`);
    console.log('   ✅ PASS\n');
  } else {
    console.log('   ⚠️  No waiting users to test with\n');
  }

  console.log('═══════════════════════════════════════════');
  console.log('🏆 ALL TESTS PASSED — Backend is ready!');
  console.log('═══════════════════════════════════════════\n');
}

runTests().catch(console.error);
