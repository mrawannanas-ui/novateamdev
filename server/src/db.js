// قاعدة بيانات SQLite مدمجة في Node (node:sqlite) — من غير مكتبات.
// الملف: DATA_DIR/nova.db  (على Railway اربط Volume على /data واضبط DATA_DIR=/data)
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DIR, { recursive: true });
const db = new DatabaseSync(path.join(DIR, 'nova.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  icon TEXT NOT NULL DEFAULT 'fa-star',
  color TEXT NOT NULL DEFAULT '#4fc3f7',
  features TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  player TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  delivered INTEGER NOT NULL DEFAULT 0,
  paymob_order_id TEXT,
  paymob_tx_id TEXT,
  note TEXT,
  paid_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_paymob ON orders(paymob_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
`);

// ترحيل: عمود custom للباقات في قواعد قديمة
if (!db.prepare('PRAGMA table_info(packages)').all().some(c => c.name === 'custom')) {
  db.exec('ALTER TABLE packages ADD COLUMN custom INTEGER NOT NULL DEFAULT 0');
}

// ----- الباقات -----
const pkgOut = r => r && ({
  id: r.id, name: r.name, price: r.price, icon: r.icon, color: r.color,
  features: JSON.parse(r.features), custom: !!r.custom, active: !!r.active, sort: r.sort
});

// أول تشغيل: نزرع الباقات الافتراضية من config.js
if (db.prepare('SELECT COUNT(*) c FROM packages').get().c === 0) {
  const ins = db.prepare('INSERT INTO packages (id,name,price,icon,color,features,custom,sort) VALUES (?,?,?,?,?,?,?,?)');
  cfg.PACKAGES.forEach((p, i) => ins.run(p.id, p.name, p.price, p.icon, p.color, JSON.stringify(p.features), p.custom ? 1 : 0, i));
}

// ----- الطلبات -----
const ordOut = r => r && ({
  id: r.id, packageId: r.package_id, packageName: r.package_name,
  amountCents: r.amount_cents, currency: r.currency,
  player: r.player, email: r.email, phone: r.phone,
  status: r.status, delivered: !!r.delivered,
  paymobOrderId: r.paymob_order_id, paymobTxId: r.paymob_tx_id, note: r.note,
  paidAt: r.paid_at, deliveredAt: r.delivered_at, createdAt: r.created_at, updatedAt: r.updated_at
});

const COLS = {
  status: 'status', delivered: 'delivered', paymobOrderId: 'paymob_order_id', paymobTxId: 'paymob_tx_id',
  note: 'note', paidAt: 'paid_at', deliveredAt: 'delivered_at'
};

// ترحيل لمرة واحدة من orders.json القديم (لو موجود)
try {
  const old = path.join(DIR, 'orders.json');
  if (fs.existsSync(old) && db.prepare('SELECT COUNT(*) c FROM orders').get().c === 0) {
    const ins = db.prepare(`INSERT OR IGNORE INTO orders (id,package_id,package_name,amount_cents,currency,player,email,phone,status,delivered,
      paymob_order_id,paymob_tx_id,note,paid_at,delivered_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const o of JSON.parse(fs.readFileSync(old, 'utf8'))) {
      ins.run(o.id, o.packageId, o.packageName, o.amountCents, o.currency, o.player, o.email, o.phone || '', o.status, o.delivered ? 1 : 0,
        o.paymobOrderId != null ? String(o.paymobOrderId) : null, o.paymobTxId != null ? String(o.paymobTxId) : null,
        o.note || null, o.paidAt || null, o.deliveredAt || null, o.createdAt, o.updatedAt);
    }
    fs.renameSync(old, old + '.migrated');
  }
} catch (e) { console.error('migration skipped:', e.message); }

module.exports = {
  // الطلبات
  create(o) {
    db.prepare(`INSERT INTO orders (id,package_id,package_name,amount_cents,currency,player,email,phone,status,delivered,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(o.id, o.packageId, o.packageName, o.amountCents, o.currency, o.player, o.email, o.phone || '', o.status, 0, o.createdAt, o.updatedAt);
    return o;
  },
  byId: id => ordOut(db.prepare('SELECT * FROM orders WHERE id=?').get(id)),
  byPaymobOrderId: pid => ordOut(db.prepare('SELECT * FROM orders WHERE paymob_order_id=?').get(String(pid))),
  list(status) {
    const rows = status
      ? db.prepare('SELECT * FROM orders WHERE status=? ORDER BY created_at DESC').all(status)
      : db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
    return rows.map(ordOut);
  },
  update(id, patch) {
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!COLS[k]) continue;
      sets.push(COLS[k] + '=?');
      vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : (v != null && k === 'paymobOrderId' ? String(v) : v ?? null));
    }
    sets.push('updated_at=?'); vals.push(new Date().toISOString());
    const r = db.prepare(`UPDATE orders SET ${sets.join(',')} WHERE id=?`).run(...vals, id);
    return r.changes ? ordOut(db.prepare('SELECT * FROM orders WHERE id=?').get(id)) : null;
  },

  // الباقات
  listPackages: (all = false) =>
    db.prepare(`SELECT * FROM packages ${all ? '' : 'WHERE active=1'} ORDER BY sort, rowid`).all().map(pkgOut),
  getPackage: id => pkgOut(db.prepare('SELECT * FROM packages WHERE id=? AND active=1').get(id)),
  upsertPackage(p) {
    db.prepare(`INSERT INTO packages (id,name,price,icon,color,features,custom,active,sort) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, price=excluded.price, icon=excluded.icon, color=excluded.color,
      features=excluded.features, custom=excluded.custom, active=excluded.active, sort=excluded.sort`)
      .run(p.id, p.name, p.price, p.icon, p.color, JSON.stringify(p.features), p.custom ? 1 : 0, p.active ? 1 : 0, p.sort);
    return pkgOut(db.prepare('SELECT * FROM packages WHERE id=?').get(p.id));
  },
  // الباقة اللي عليها طلبات بتتعطّل مش بتتمسح عشان سجل الطلبات
  removePackage(id) {
    const used = db.prepare('SELECT COUNT(*) c FROM orders WHERE package_id=?').get(id).c;
    if (used) { db.prepare('UPDATE packages SET active=0 WHERE id=?').run(id); return 'disabled'; }
    return db.prepare('DELETE FROM packages WHERE id=?').run(id).changes ? 'deleted' : null;
  }
};
