const http = require('http');
const PORT = process.env.PORT || 5074;
function req(method, path, body, token) {
  return new Promise((res, rej) => {
    const data = body != null ? JSON.stringify(body) : null;
    const r = http.request({ hostname: 'localhost', port: PORT, path, method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (resp) => { let b = ''; resp.on('data', c => b += c); resp.on('end', () => { let d; try { d = JSON.parse(b); } catch { d = b; } res({ s: resp.statusCode, d }); }); });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
let pass = 0, fail = 0;
function ok(name, cond, extra='') { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + ' ' + extra); } }

(async () => {
  const superTok = (await req('POST', '/api/v1/auth/login', { username: 'superadmin', password: 'Super@123' })).d.token;
  const feeTok = (await req('POST', '/api/v1/auth/login', { username: 'fee_admin', password: 'Fee@123' })).d.token;
  await req('POST', '/api/v1/admin/queue/create', { queue_id: 'fee_cell', name: 'Fee Cell', type: 'fee_cell', counters_open: 1 }, superTok);
  await req('POST', '/api/v1/admin/queue/create', { queue_id: 'admission_cell', name: 'Admission Cell', type: 'admission_cell', counters_open: 1 }, superTok);

  console.log('\n── AUTH ──');
  ok('admin endpoint without token → 401', (await req('GET', '/api/v1/queue/fee_cell/users')).s === 401);
  ok('admin endpoint bad token → 403', (await req('GET', '/api/v1/queue/fee_cell/users', null, 'garbage')).s === 403);
  ok('admin endpoint good token → 200', (await req('GET', '/api/v1/queue/fee_cell/users', null, superTok)).s === 200);
  ok('wrong password → 401', (await req('POST', '/api/v1/auth/login', { username: 'superadmin', password: 'x' })).s === 401);
  ok('fee_admin on fee_cell → 200', (await req('GET', '/api/v1/queue/fee_cell/users', null, feeTok)).s === 200);
  ok('fee_admin on admission_cell → 403', (await req('GET', '/api/v1/queue/admission_cell/users', null, feeTok)).s === 403);

  console.log('\n── STUDENT JOIN VALIDATION ──');
  ok('missing fields → 400', (await req('POST', '/api/v1/queue/fee_cell/join', { name: 'x' })).s === 400);
  ok('bad phone → 400', (await req('POST', '/api/v1/queue/fee_cell/join', { name: 'x', phone: '123', visit_reason: 'fee' })).s === 400);
  ok('unknown queue → 404', (await req('POST', '/api/v1/queue/nope/join', { name: 'x', phone: '9811111111', visit_reason: 'fee', form_fill_ms: 9000 })).s === 404);
  const j1 = await req('POST', '/api/v1/queue/fee_cell/join', { name: 'A', phone: '9811111112', visit_reason: 'fee payment', form_fill_ms: 9000 });
  ok('valid join → 201 + token', j1.s === 201 && !!j1.d.token && !!j1.d.userId, JSON.stringify(j1.d).slice(0,80));
  ok('duplicate phone → 403', (await req('POST', '/api/v1/queue/fee_cell/join', { name: 'A2', phone: '9811111112', visit_reason: 'fee', form_fill_ms: 9000 })).s === 403);
  ok('position unknown user → 404', (await req('GET', '/api/v1/queue/fee_cell/position/nouser')).s === 404);
  ok('status unknown queue → 404', (await req('GET', '/api/v1/queue/nope/status')).s === 404);
  ok('requirements public → 200', (await req('GET', '/api/v1/queue/fee_cell/requirements')).s === 200);

  console.log('\n── ADMIN OPERATIONS ──');
  ok('call-next unknown counter → 409', (await req('POST', '/api/v1/admin/queue/fee_cell/call-next', { counter_id: 'nope' }, superTok)).s === 409);
  const ju = await req('POST', '/api/v1/queue/fee_cell/join', { name: 'StateTest', phone: '9811111199', visit_reason: 'fee', form_fill_ms: 9000 });
  ok('attended on a waiting user → 400', (await req('POST', `/api/v1/admin/queue/fee_cell/attended/${ju.d.userId}`, {}, superTok)).s === 400);
  const call = await req('POST', '/api/v1/admin/queue/fee_cell/call-next', { counter_id: 'counter_1' }, superTok);
  ok('call-next valid → 200 called', call.s === 200 && !!call.d.called_user, JSON.stringify(call.d).slice(0,80));
  const calledId = call.d.called_user.userId;
  const arr = await req('POST', `/api/v1/admin/queue/fee_cell/attended/${calledId}`, {}, superTok);
  ok('attended on called → 200 in_service', arr.s === 200 && arr.d.status === 'in_service', JSON.stringify(arr.d));
  ok('done on in_service → 200', (await req('POST', `/api/v1/admin/queue/fee_cell/done/${calledId}`, {}, superTok)).s === 200);
  ok('done again on served → 400', (await req('POST', `/api/v1/admin/queue/fee_cell/done/${calledId}`, {}, superTok)).s === 400);
  ok('no-show unknown user → 404', (await req('POST', '/api/v1/queue/fee_cell/no-show/nouser', { reason: 'x' }, superTok)).s === 404);
  ok('remove last counter → 400', (await req('POST', '/api/v1/admin/queue/fee_cell/counters', { action: 'remove', counter_id: 'counter_1' }, superTok)).s === 400);
  const addc = await req('POST', '/api/v1/admin/queue/fee_cell/counters', { action: 'add' }, superTok);
  ok('add counter → 200', addc.s === 200 && addc.d.added);
  ok('remove added counter → 200', (await req('POST', '/api/v1/admin/queue/fee_cell/counters', { action: 'remove', counter_id: addc.d.added }, superTok)).s === 200);
  ok('settings GET → 200', (await req('GET', '/api/v1/admin/queue/fee_cell/settings', null, superTok)).s === 200);
  ok('analytics → 200', (await req('GET', '/api/v1/admin/queue/fee_cell/analytics?range=week', null, superTok)).s === 200);

  console.log('\n── PAUSE / CLOSE ──');
  await req('POST', '/api/v1/admin/queue/admission_cell/pause', {}, superTok);
  ok('join when paused → 403', (await req('POST', '/api/v1/queue/admission_cell/join', { name: 'P', phone: '9822222222', visit_reason: 'x', form_fill_ms: 9000 })).s === 403);
  await req('POST', '/api/v1/admin/queue/admission_cell/close', {}, superTok);
  ok('join when closed → 403', (await req('POST', '/api/v1/queue/admission_cell/join', { name: 'P', phone: '9833333333', visit_reason: 'x', form_fill_ms: 9000 })).s === 403);

  console.log('\n── CONCURRENCY ──');
  const phones = Array.from({ length: 15 }, (_, i) => `97${String(10000000 + i).slice(0,8)}`);
  const joins = await Promise.all(phones.map(p => req('POST', '/api/v1/queue/admission_cell/join', { name: 'C' + p.slice(-2), phone: p, visit_reason: 'fee payment', form_fill_ms: 9000 })));
  // admission closed above; reopen first
  // (re-run after reopen)
  await req('POST', '/api/v1/admin/queue/admission_cell/resume', {}, superTok);
  const joins2 = await Promise.all(phones.map(p => req('POST', '/api/v1/queue/admission_cell/join', { name: 'C' + p.slice(-2), phone: p, visit_reason: 'fee payment', form_fill_ms: 9000 })));
  const ok2 = joins2.filter(r => r.s === 201);
  ok('15 concurrent joins all 201', ok2.length === 15, `(${ok2.length}/15)`);
  ok('tokens unique', new Set(ok2.map(r => r.d.token)).size === 15);
  ok('positions unique', new Set(ok2.map(r => r.d.position)).size === 15);
  const [c1, c2] = await Promise.all([
    req('POST', '/api/v1/admin/queue/admission_cell/call-next', { counter_id: 'counter_1' }, superTok),
    req('POST', '/api/v1/admin/queue/admission_cell/call-next', { counter_id: 'counter_1' }, superTok),
  ]);
  ok('parallel call-next: exactly one wins', [c1.s, c2.s].sort().join(',') === '200,409', `(${c1.s},${c2.s})`);

  console.log(`\n════ AUDIT: ${pass} passed, ${fail} failed ════`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
