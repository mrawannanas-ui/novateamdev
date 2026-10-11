// باك إند NOVA RP — بدون أي dependencies (Node >= 22.13 بس).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cfg = require('./src/config');
const db = require('./src/db');
const paymob = require('./src/paymob');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

// ---------- أدوات ----------
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=15552000; includeSubDomains'
};

function send(res, status, body, headers = {}) {
  const isObj = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(status, {
    ...SEC_HEADERS,
    ...(isObj ? { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } : {}),
    ...headers
  });
  res.end(data);
}

function readJson(req, limit = 50 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// Rate limit بسيط في الذاكرة (لكل IP + مفتاح)
const hits = new Map();
function limited(req, key, max, windowMs) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const k = key + '|' + ip, now = Date.now();
  const rec = hits.get(k);
  if (!rec || now > rec.reset) { hits.set(k, { n: 1, reset: now + windowMs }); return false; }
  return ++rec.n > max;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (n > v.reset) hits.delete(k); }, 60000).unref();

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
function isAdmin(req) {
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return !!(cfg.adminToken && given && crypto.timingSafeEqual(sha(given), sha(cfg.adminToken)));
}

const publicPackage = ({ id, name, price, icon, color, features, custom }) =>
  ({ id, name, price, icon, color, features, custom, ...(custom ? { max: cfg.maxCustom } : {}), currency: cfg.currency });

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && origin === cfg.siteUrl) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
}

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  cors(req, res);
  if (m === 'OPTIONS') return send(res, 204, '');

  if (p === '/api/health' && m === 'GET') {
    return send(res, 200, { ok: true, paymobConfigured: paymob.configured(), adminConfigured: !!cfg.adminToken });
  }

  if (p === '/api/packages' && m === 'GET') {
    return send(res, 200, { currency: cfg.currency, packages: db.listPackages().map(publicPackage) });
  }

  if (p === '/api/checkout' && m === 'POST') {
    if (limited(req, 'checkout', 15, 10 * 60 * 1000)) return send(res, 429, { error: 'محاولات كثيرة، حاول بعد قليل' });
    if (!paymob.configured()) return send(res, 503, { error: 'الدفع غير مفعّل حالياً' });
    const { packageId, player, email, phone, amount } = await readJson(req);

    const pkg = db.getPackage(String(packageId || ''));
    if (!pkg) return send(res, 400, { error: 'باقة غير موجودة' });
    const playerName = String(player || '').trim();
    if (playerName.length < 2 || playerName.length > 40) return send(res, 400, { error: 'اكتب اسمك داخل اللعبة (2 إلى 40 حرف)' });
    const mail = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) || mail.length > 120) return send(res, 400, { error: 'بريد إلكتروني غير صالح' });
    const ph = String(phone || '').replace(/[^\d+]/g, '').slice(0, 20);

    const id = crypto.randomBytes(8).toString('hex');
    // السعر من السيرفر. الباقة الحرة بس بتقبل مبلغ من العميل، وبحد أدنى وأقصى
    let price = pkg.price;
    if (pkg.custom) {
      price = Number(amount);
      if (!Number.isFinite(price) || price < pkg.price || price > cfg.maxCustom) {
        return send(res, 400, { error: `المبلغ لازم يكون بين ${pkg.price} و ${cfg.maxCustom} ${cfg.currency}` });
      }
    }
    const amountCents = Math.round(price * 100);
    const now = new Date().toISOString();
    await db.create({
      id, packageId: pkg.id, packageName: pkg.name, amountCents, currency: cfg.currency,
      player: playerName, email: mail, phone: ph, status: 'pending', delivered: false, createdAt: now, updatedAt: now
    });

    try {
      const pay = await paymob.createPayment({
        amountCents, merchantOrderId: id, itemName: `NOVA RP - ${pkg.name}`,
        billing: { firstName: playerName.split(' ')[0], lastName: playerName.split(' ').slice(1).join(' ') || 'Player', email: mail, phone: ph }
      });
      await db.update(id, { paymobOrderId: pay.paymobOrderId });
      return send(res, 200, { orderId: id, paymentUrl: pay.iframeUrl });
    } catch (e) {
      console.error('paymob error:', e.message, e.details || '');
      await db.update(id, { status: 'failed', note: 'paymob init failed' });
      return send(res, 502, { error: 'تعذّر بدء عملية الدفع، حاول لاحقاً' });
    }
  }

  // Paymob "Transaction processed callback"
  if (p === '/api/paymob/webhook' && m === 'POST') {
    const body = await readJson(req);
    const obj = body && body.obj;
    if (!obj || !paymob.verifyHmac(obj, url.searchParams.get('hmac'))) return send(res, 401, { error: 'invalid hmac' });

    const order = db.byPaymobOrderId(obj.order && obj.order.id);
    if (!order) return send(res, 200, { ok: true, ignored: 'unknown order' });

    // مطابقة المبلغ والعملة مع المحفوظ عندنا
    if (Number(obj.amount_cents) !== order.amountCents || obj.currency !== order.currency) {
      await db.update(order.id, { status: 'mismatch', note: 'amount/currency mismatch', paymobTxId: obj.id });
      return send(res, 200, { ok: true, flagged: true });
    }

    let status = order.status;
    if (obj.is_refunded) status = 'refunded';
    else if (obj.is_voided) status = 'voided';
    else if (obj.success === true && obj.pending === false) status = 'paid';
    else if (obj.success === false && obj.pending === false && order.status !== 'paid') status = 'failed';

    if (status !== order.status) {
      await db.update(order.id, { status, paymobTxId: obj.id, ...(status === 'paid' ? { paidAt: new Date().toISOString() } : {}) });
    }
    return send(res, 200, { ok: true });
  }

  // تحويل العميل بعد الدفع. الحالة الحقيقية بتيجي من الـ webhook بس.
  if (p === '/api/paymob/return' && m === 'GET') {
    const mid = String(url.searchParams.get('merchant_order_id') || '').replace(/[^a-f0-9]/gi, '').slice(0, 32);
    return send(res, 302, '', { Location: `${cfg.siteUrl}/store.html${mid ? '?order=' + mid : ''}` });
  }

  let mm;
  if ((mm = p.match(/^\/api\/orders\/([a-f0-9]{1,32})\/status$/)) && m === 'GET') {
    const o = db.byId(mm[1]);
    if (!o) return send(res, 404, { error: 'not found' });
    return send(res, 200, { id: o.id, status: o.status, packageName: o.packageName, delivered: o.delivered });
  }

  // ---- إدارة ----
  if (p.startsWith('/api/admin/')) {
    if (limited(req, 'admin', 100, 15 * 60 * 1000)) return send(res, 429, { error: 'too many requests' });
    if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });

    if (p === '/api/admin/orders' && m === 'GET') {
      const st = url.searchParams.get('status');
      const list = db.list(st || undefined);
      return send(res, 200, { count: list.length, orders: list });
    }
    if (p === '/api/admin/packages' && m === 'GET') return send(res, 200, { packages: db.listPackages(true) });

    if ((mm = p.match(/^\/api\/admin\/packages\/([a-z0-9_-]{1,32})$/)) && (m === 'PUT' || m === 'DELETE')) {
      if (m === 'DELETE') {
        const r = db.removePackage(mm[1]);
        return r ? send(res, 200, { ok: true, result: r }) : send(res, 404, { error: 'not found' });
      }
      const b = await readJson(req);
      const price = Number(b.price);
      const features = Array.isArray(b.features) ? b.features.map(x => String(x).slice(0, 80)).slice(0, 12) : [];
      const name = String(b.name || '').trim().slice(0, 40);
      if (!name || !Number.isInteger(price) || price < 1 || price > 1000000) return send(res, 400, { error: 'اسم وسعر (رقم صحيح) مطلوبين' });
      const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#4fc3f7';
      const icon = /^fa-[a-z0-9-]{1,30}$/.test(b.icon || '') ? b.icon : 'fa-star';
      return send(res, 200, db.upsertPackage({ id: mm[1], name, price, icon, color, features, custom: b.custom === true, active: b.active !== false, sort: Number(b.sort) || 0 }));
    }

    if ((mm = p.match(/^\/api\/admin\/orders\/([a-f0-9]{1,32})\/deliver$/)) && m === 'POST') {
      const o = db.byId(mm[1]);
      if (!o) return send(res, 404, { error: 'not found' });
      if (o.status !== 'paid') return send(res, 409, { error: 'الطلب غير مدفوع' });
      return send(res, 200, await db.update(o.id, { delivered: true, deliveredAt: new Date().toISOString() }));
    }
  }

  return send(res, 404, { error: 'not found' });
}

// ---------- الموقع الثابت ----------
function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad Request'); }
  if (rel.includes('\0') || rel.split('/').some(s => s.startsWith('.') && s !== '')) return send(res, 404, 'Not Found');
  if (/^\/(server|node_modules)(\/|$)/i.test(rel)) return send(res, 404, 'Not Found');

  let file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return send(res, 404, 'Not Found');
  const tryFiles = [file, path.join(file, 'index.html'), file + '.html'];
  const found = tryFiles.find(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
  if (!found) return send(res, 404, 'Not Found');

  const ext = path.extname(found).toLowerCase();
  send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(found), { 'Content-Type': MIME[ext] || 'application/octet-stream' });
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message });
      console.error('unhandled:', e);
      if (!res.headersSent) send(res, 500, { error: 'server error' });
    }
  });
}

if (require.main === module) {
  createServer().listen(cfg.port, () => {
    console.log(`NOVA backend on :${cfg.port}`);
    if (!paymob.configured()) console.warn('! Paymob غير مضبوط (راجع .env)');
    if (!cfg.adminToken) console.warn('! ADMIN_TOKEN فاضي: لوحة الإدارة مقفولة');
  });
}

module.exports = { createServer };
