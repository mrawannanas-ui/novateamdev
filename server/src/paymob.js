const crypto = require('crypto');
const cfg = require('./config');

const P = cfg.paymob;

async function post(path, body) {
  const res = await fetch(P.baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error('Paymob ' + path + ' failed (' + res.status + ')');
    err.details = data;
    throw err;
  }
  return data;
}

function configured() {
  return !!(P.apiKey && P.integrationId && P.iframeId && P.hmacSecret);
}

// 3 خطوات حسب Accept API: auth -> order -> payment key
async function createPayment({ amountCents, merchantOrderId, itemName, billing }) {
  const { token } = await post('/api/auth/tokens', { api_key: P.apiKey });

  const order = await post('/api/ecommerce/orders', {
    auth_token: token,
    delivery_needed: false,
    amount_cents: amountCents,
    currency: cfg.currency,
    merchant_order_id: merchantOrderId,
    items: [{ name: itemName, amount_cents: amountCents, description: itemName, quantity: 1 }]
  });

  const key = await post('/api/acceptance/payment_keys', {
    auth_token: token,
    amount_cents: amountCents,
    expiration: 3600,
    order_id: order.id,
    currency: cfg.currency,
    integration_id: Number(P.integrationId),
    billing_data: {
      first_name: billing.firstName || 'NOVA',
      last_name: billing.lastName || 'Player',
      email: billing.email,
      phone_number: billing.phone || 'NA',
      apartment: 'NA', floor: 'NA', street: 'NA', building: 'NA',
      shipping_method: 'NA', postal_code: 'NA', city: 'NA',
      country: 'EG', state: 'NA'
    }
  });

  return {
    paymobOrderId: order.id,
    iframeUrl: `${P.baseUrl}/api/acceptance/iframes/${P.iframeId}?payment_token=${key.token}`
  };
}

// الحقول المطلوبة لحساب HMAC بالترتيب الأبجدي (حسب توثيق Paymob)
const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
  'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
  'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending',
  'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success'
];

function pick(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function verifyHmac(obj, received) {
  if (!P.hmacSecret || !received || !obj) return false;
  const str = HMAC_FIELDS.map(f => {
    const v = pick(obj, f);
    return v === undefined || v === null ? '' : String(v);
  }).join('');
  const calc = crypto.createHmac('sha512', P.hmacSecret).update(str).digest('hex');
  const a = Buffer.from(calc);
  const b = Buffer.from(String(received).toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { configured, createPayment, verifyHmac, HMAC_FIELDS };
