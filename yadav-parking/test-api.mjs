/* Yadav Parking — end-to-end API test */
const BASE = 'http://127.0.0.1:4599';
let failures = 0;
function ok(cond, name, extra = '') {
  if (cond) console.log('  ✓', name);
  else { failures++; console.log('  ✗ FAIL:', name, extra); }
}
async function api(path, { method, body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const run = async () => {
  // wait for server
  for (let i = 0; i < 20; i++) {
    try { await fetch(BASE + '/api/health'); break; } catch { await new Promise((r) => setTimeout(r, 300)); }
  }

  console.log('— Public —');
  const health = await api('/api/health');
  ok(health.status === 200 && health.data.ok, 'health');
  const sum = await api('/api/public/summary');
  ok(sum.status === 200 && sum.data.shopName === 'Yadav Parking', 'public summary');
  ok(sum.data.vehicleTypes.length === 3, '3 default vehicle types');
  const bike = sum.data.vehicleTypes.find((v) => v.id === 'bike');
  ok(bike.rate.blockPrice === 20 && bike.rate.monthlyPrice === 250 && bike.rate.quarterlyPrice === 600, 'default rates 20/250/600');

  console.log('— Auth —');
  const su = await api('/api/auth/signup', { body: { name: 'Uncle Yadav', mobile: '9800000001', password: 'uncle123' } });
  ok(su.status === 200 && su.data.user.role === 'admin', 'pehla signup = admin');
  const adminTok = su.data.token;
  const su2 = await api('/api/auth/signup', { body: { name: 'Ravi Customer', mobile: '9800000002', password: 'ravi123' } });
  ok(su2.status === 200 && su2.data.user.role === 'customer', 'doosra signup = customer');
  const custTok = su2.data.token;
  const bad = await api('/api/auth/login', { body: { mobile: '9800000001', password: 'wrong' } });
  ok(bad.status === 401, 'galat password reject');

  console.log('— Rates (admin) —');
  const put = await api('/api/vehicle-types/bike', { method: 'PUT', token: adminTok, body: { rate: { blockHours: 12, blockPrice: 25, monthlyPrice: 300, quarterlyPrice: 700 } } });
  ok(put.status === 200 && put.data.vehicleType.rate.monthlyPrice === 300, 'bike rate update');
  const putCust = await api('/api/vehicle-types/bike', { method: 'PUT', token: custTok, body: { rate: { monthlyPrice: 1 } } });
  ok(putCust.status === 403, 'customer rate nahi badal sakta');
  await api('/api/vehicle-types/bike', { method: 'PUT', token: adminTok, body: { rate: { blockHours: 12, blockPrice: 20, monthlyPrice: 250, quarterlyPrice: 600 } } });

  console.log('— Passes —');
  const p1 = await api('/api/passes', { token: adminTok, body: { name: 'Ravi', mobile: '9800000002', vehicleTypeId: 'bike', vehicleNo: 'rj14ex0001', passType: 'monthly', advanceAmount: 100, advanceMethod: 'cash' } });
  ok(p1.status === 200 && p1.data.pass.price === 250, 'monthly pass price 250');
  ok(p1.data.pass.paid === 100 && p1.data.pass.due === 150, 'advance 100, due 150');
  ok(p1.data.pass.vehicleNo === 'RJ14EX0001', 'vehicle no uppercase');
  const p2 = await api('/api/passes', { token: adminTok, body: { name: 'Fast Track', mobile: '9800000003', vehicleTypeId: 'bike', passType: 'hourly', hours: 36 } });
  ok(p2.data.pass.price === 60, '36h = 3 blocks × 20 = 60');
  const pc = await api('/api/passes', { token: custTok, body: { name: 'Ravi', mobile: '9800000002', vehicleTypeId: 'cycle', passType: 'monthly' } });
  ok(pc.status === 200 && pc.data.pass.status === 'pending', 'customer booking = pending');
  const cyc = await api('/api/passes', { token: adminTok, body: { name: 'Cycle Wala', mobile: '9800000004', vehicleTypeId: 'cycle', passType: 'hourly' } });
  ok(cyc.status === 200, 'cycle pass bina number');

  console.log('— Confirm + payments —');
  const conf = await api(`/api/passes/${pc.data.pass.id}`, { method: 'PUT', token: adminTok, body: { status: 'active' } });
  ok(conf.data.pass.status === 'active', 'admin ne confirm kiya');
  const pay = await api(`/api/passes/${pc.data.pass.id}/payments`, { token: adminTok, body: { amount: 100, method: 'upi' } });
  ok(pay.status === 200 && pay.data.pass.due === 0, 'payment 100 → due 0');
  const payCust = await api(`/api/passes/${p1.data.pass.id}/payments`, { token: custTok, body: { amount: 50 } });
  ok(payCust.status === 403, 'customer payment entry nahi kar sakta');
  const renew = await api(`/api/passes/${p1.data.pass.id}/renew`, { token: adminTok, body: { passType: 'monthly' } });
  ok(renew.status === 200 && renew.data.pass.price === 500, 'renew → price 500 (250+250)');

  console.log('— Visibility —');
  const adminList = await api('/api/passes?status=all', { token: adminTok });
  ok(adminList.data.passes.length === 4, 'admin ko sab 4 passes');
  const custList = await api('/api/passes?status=all', { token: custTok });
  ok(custList.data.passes.length === 2, 'customer ko apne 2 hi passes');
  const q = await api('/api/passes?q=ravi', { token: adminTok });
  ok(q.data.passes.length >= 2, 'search "ravi"');

  console.log('— Notifications & expiry —');
  const notif = await api('/api/notifications', { token: adminTok });
  ok(notif.status === 200, 'notifications list');
  // p2 ka endAt 23h baad hai (36h pass, blockHours 12) → 12h pe pending nahi, 24h mein
  const st = await api('/api/stats', { token: adminTok });
  ok(st.data.revenue.total === 200, 'total kamai 200 (advance 100 + upi 100)', `got ${st.data.revenue.total}`);
  ok(st.data.activeTotal === 4, '4 active passes', `got ${st.data.activeTotal}`);
  ok(st.data.pendingRequests === 0, '0 pending');
  ok(st.data.revenue.pendingDue === 470, 'due 470 (p1:400 + p2:60 + cycle:10)', `got ${st.data.revenue.pendingDue}`);

  console.log('— Customers, backup, config —');
  const cust2 = await api('/api/customers', { token: adminTok });
  ok(cust2.status === 200 && cust2.data.customers.length === 3, '3 unique customers (same mobile merge)');
  const cfg = await api('/api/config', { method: 'PUT', token: adminTok, body: { alertDays: 2, upiId: 'yadav@upi' } });
  ok(cfg.data.config.alertDays === 2, 'config update');
  const backup = await api(`/api/backup?token=${adminTok}`);
  ok(backup.status === 200 && backup.data.passes.length === 4, 'backup download (query token)');

  console.log(failures === 0 ? '\n🎯 SAB TESTS PASS!' : `\n💥 ${failures} TESTS FAIL`);
  process.exit(failures ? 1 : 0);
};
run().catch((e) => { console.error('Test crash:', e); process.exit(1); });
