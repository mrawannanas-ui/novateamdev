const fs = require('fs');
const path = require('path');
// تحميل .env بدون أي مكتبة (القيم الموجودة في البيئة بتتقدّم)
try {
  const f = path.join(__dirname, '..', '.env');
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* مفيش .env، عادي */ }

const env = (k, d = '') => (process.env[k] ?? d).trim();

// الباقات هنا على السيرفر: السعر بيتحدد هنا بس، العميل مايقدرش يغيره.
// السعر بالجنيه (EGP). عدّل براحتك.
const CURRENCY = env('CURRENCY', 'EGP');
// أقل مبلغ لباقة الدعم الحر (بنفس عملة CURRENCY). 2$ تقريباً = 100 جنيه.
// لو CURRENCY=USD يبقى 2 (محتاج Integration بالدولار في Paymob).
const MIN_CUSTOM = Number(env('MIN_CUSTOM_AMOUNT', CURRENCY === 'USD' ? '2' : '100'));
const MAX_CUSTOM = Number(env('MAX_CUSTOM_AMOUNT', CURRENCY === 'USD' ? '1000' : '50000'));

const PACKAGES = [
  { id: 'bronze', name: 'برونزي', price: 150, icon: 'fa-medal', color: '#cd7f32',
    features: ['رتبة برونزية', 'أولوية دخول بسيطة', 'لون اسم مميز'] },
  { id: 'silver', name: 'فضي', price: 300, icon: 'fa-award', color: '#c0c0c0',
    features: ['كل مميزات البرونزي', 'سيارة مخصصة', 'أولوية دخول'] },
  { id: 'gold', name: 'ذهبي', price: 600, icon: 'fa-crown', color: '#ffd700',
    features: ['كل مميزات الفضي', 'منزل مميز', 'دعم أولوية'] },
  { id: 'diamond', name: 'دايموند', price: 1200, icon: 'fa-gem', color: '#4fc3f7',
    features: ['كل مميزات الذهبي', 'مركبتان مخصصتان', 'فعاليات حصرية'] },
  // custom: اللاعب هو اللي يحدد المبلغ، و price هنا = أقل مبلغ مسموح
  { id: 'support', name: 'دعم السيرفر', price: MIN_CUSTOM, custom: true, icon: 'fa-heart', color: '#ff5c8a',
    features: ['ادفع أي مبلغ تحبه', 'يساعد في تكاليف تشغيل السيرفر'] }
];

module.exports = {
  port: Number(env('PORT', '3000')),
  siteUrl: env('SITE_URL', 'http://localhost:3000'),
  publicApiUrl: env('PUBLIC_API_URL', 'http://localhost:3000'),
  adminToken: env('ADMIN_TOKEN'),
  currency: CURRENCY,
  maxCustom: MAX_CUSTOM,
  paymob: {
    apiKey: env('PAYMOB_API_KEY'),
    integrationId: env('PAYMOB_INTEGRATION_ID'),
    iframeId: env('PAYMOB_IFRAME_ID'),
    hmacSecret: env('PAYMOB_HMAC_SECRET'),
    baseUrl: env('PAYMOB_BASE_URL', 'https://accept.paymob.com')
  },
  PACKAGES
};
