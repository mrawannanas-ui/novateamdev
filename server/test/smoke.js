// اختبار سريع من غير إنترنت: Paymob متقلَّد (mock)، والـ HMAC بيتحسب بنفس خوارزمية Paymob.
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-'));
process.env.PAYMOB_API_KEY = 'k';
process.env.PAYMOB_INTEGRATION_ID = '123';
process.env.PAYMOB_IFRAME_ID = '456';
process.env.PAYMOB_HMAC_SECRET = 'secret';
process.env.ADMIN_TOKEN = 'admintoken';
process.env.SITE_URL = 'http://localhost';

const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith('https://accept.paymob.com')) {
    const u = String(url);
    const json = o => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (u.endsWith('/auth/tokens')) return json({ token: 'AUTH' });
    if (u.endsWith('/ecommerce/orders')) {
      const b = JSON.parse(opts.body);
      global.__lastAmount = b.amount_cents;
      return json({ id: 777 });
    }
    if (u.endsWith('/payment_keys')) return json({ token: 'PAYKEY' });
    throw new Error('unexpected ' + u);
  }
  return realFetch(url, opts);
};

const { createServer } = require('../server');
const { HMAC_FIELDS } = require('../src/paymob');

function sign(obj) {
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const s = HMAC_FIELDS.map(f => { const v = get(obj, f); return v == null ? '' : String(v); }).join('');
  return crypto.createHmac('sha512', 'secret').update(s).digest('hex');
}

(async () => {
  const srv = createServer().listen(0);
  const base = 'http://127.0.0.1:' + srv.address().port;
  const j = async (p, o = {}) => {
    const r = await realFetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) } });
    return { s: r.status, d: await r.json().catch(() => null) };
  };

  let r = await j('/api/packages');
  assert.strictEqual(r.s, 200); assert(r.d.packages.length >= 1);

  // التسعير من السيرفر: أي سعر من العميل بيتتجاهل
  r = await j('/api/checkout', { method: 'POST', body: JSON.stringify({ packageId: 'silver', price: 1, player: 'Ahmed', email: 'a@b.co' }) });
  assert.strictEqual(r.s, 200, JSON.stringify(r.d));
  assert(r.d.paymentUrl.includes('payment_token=PAYKEY'));
  const id = r.d.orderId;
  assert.strictEqual(global.__lastAmount, 30000); // 300 ج.م للفضية رغم إن العميل بعت price=1

  // باقة الدعم الحر: حد أدنى 100 EGP (≈2$)
  const sup = amount => j('/api/checkout', { method: 'POST', body: JSON.stringify({ packageId: 'support', amount, player: 'Ahmed', email: 'a@b.co' }) });
  assert.strictEqual((await sup(50)).s, 400);
  assert.strictEqual((await sup('abc')).s, 400);
  assert.strictEqual((await sup(999999)).s, 400);
  assert.strictEqual((await sup()).s, 400);
  r = await sup(150.5); assert.strictEqual(r.s, 200, JSON.stringify(r.d));
  assert.strictEqual(global.__lastAmount, 15050);
  // الباقات العادية بتتجاهل أي amount
  r = await j('/api/checkout', { method: 'POST', body: JSON.stringify({ packageId: 'bronze', amount: 1, player: 'Ahmed', email: 'a@b.co' }) });
  assert.strictEqual(global.__lastAmount, 15000);

  r = await j('/api/checkout', { method: 'POST', body: JSON.stringify({ packageId: 'nope', player: 'Ahmed', email: 'a@b.co' }) });
  assert.strictEqual(r.s, 400);
  r = await j('/api/checkout', { method: 'POST', body: JSON.stringify({ packageId: 'silver', player: 'A', email: 'bad' }) });
  assert.strictEqual(r.s, 400);

  const tx = amount => ({ obj: { amount_cents: amount, created_at: 'x', currency: 'EGP', error_occured: false, has_parent_transaction: false,
    id: 9001, integration_id: 123, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false,
    is_standalone_payment: true, is_voided: false, order: { id: 777 }, owner: 5, pending: false,
    source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true } });

  // hmac مزوّر
  r = await j('/api/paymob/webhook?hmac=deadbeef', { method: 'POST', body: JSON.stringify(tx(30000)) });
  assert.strictEqual(r.s, 401);

  // مبلغ غير مطابق (حتى لو الـ HMAC سليم) => mismatch مش paid
  let bad = tx(100);
  r = await j('/api/paymob/webhook?hmac=' + sign(bad.obj), { method: 'POST', body: JSON.stringify(bad) });
  assert.strictEqual(r.s, 200);
  r = await j('/api/orders/' + id + '/status');
  assert.strictEqual(r.d.status, 'mismatch');

  // دفع سليم
  const ok = tx(30000);
  r = await j('/api/paymob/webhook?hmac=' + sign(ok.obj), { method: 'POST', body: JSON.stringify(ok) });
  assert.strictEqual(r.s, 200);
  r = await j('/api/orders/' + id + '/status');
  assert.strictEqual(r.d.status, 'paid');

  // الإدارة
  r = await j('/api/admin/orders');
  assert.strictEqual(r.s, 401);
  const A = { headers: { Authorization: 'Bearer admintoken' } };
  r = await j('/api/admin/orders?status=paid', A);
  assert.strictEqual(r.d.count, 1);
  r = await j('/api/admin/orders/' + id + '/deliver', { method: 'POST', ...A });
  assert.strictEqual(r.d.delivered, true);

  // إدارة الباقات من الـ API (والسعر الجديد بيتطبّق في الدفع)
  r = await j('/api/admin/packages/vip', { method: 'PUT', ...A, body: JSON.stringify({ name: 'VIP', price: 99, features: ['a'] }) });
  assert.strictEqual(r.d.price, 99);
  r = await j('/api/packages'); assert(r.d.packages.some(p => p.id === 'vip' && p.price === 99));
  r = await j('/api/admin/packages/vip', { method: 'PUT', ...A, body: JSON.stringify({ name: 'VIP', price: -5 }) });
  assert.strictEqual(r.s, 400);
  r = await j('/api/admin/packages/silver', { method: 'DELETE', ...A });
  assert.strictEqual(r.d.result, 'disabled'); // عليها طلب فبتتعطّل
  r = await j('/api/admin/packages/vip', { method: 'DELETE', ...A });
  assert.strictEqual(r.d.result, 'deleted');

  // الملفات الحساسة مش بتتقدّم
  const s1 = await realFetch(base + '/server/.env.example'); assert.strictEqual(s1.status, 404);
  const s2 = await realFetch(base + '/server/data/nova.db'); assert.strictEqual(s2.status, 404);

  srv.close();
  console.log('كل الاختبارات نجحت ✅');
})().catch(e => { console.error('فشل:', e); process.exit(1); });
