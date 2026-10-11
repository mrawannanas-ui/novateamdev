# NOVA RP — الموقع + الباك إند (Paymob)

الموقع (HTML/CSS/JS) + باك إند Node **من غير أي مكتبات** (مفيش `npm install`)، وقاعدة بيانات SQLite مدمجة. محتاج **Node 22.13+**.

## الهيكل
```
index.html          الرئيسية
store.html          المتجر (الدفع عبر Paymob)
assets/             style.css / app.js / logo.png (ملفاتك الأصلية) + store.js الجديد
server/
  server.js         السيرفر (API + بيخدّم الموقع)
  src/config.js     الإعدادات + الباقات والأسعار (من هنا بس)
  src/paymob.js     تكامل Paymob + التحقق من HMAC
  src/db.js         قاعدة بيانات SQLite (data/nova.db): الطلبات + الباقات
  test/smoke.js     اختبار شامل (npm test)
  .env.example
```
اتشالوا: صفحة القوانين (`rules.html` + `rules-data.js`) وصفحة التفعيل عبر الديسكورد (`verify.html` + `verify-data.js`) وPayPal ولوحة `nova-admin`.

## التشغيل
```bash
cd server
cp .env.example .env     # املأ القيم
node server.js           # http://localhost:3000
npm test                 # اختبار من غير إنترنت
```

## إعداد Paymob
من لوحة Paymob خُد: **API Key**، **Integration ID** (كروت/محفظة)، **Iframe ID**، و**HMAC Secret** وحطهم في `.env`. بعدين في إعدادات الـ Integration حط:

| الحقل | القيمة |
|---|---|
| Transaction processed callback | `https://<PUBLIC_API_URL>/api/paymob/webhook` |
| Transaction response callback | `https://<PUBLIC_API_URL>/api/paymob/return` |

`PUBLIC_API_URL` لازم يكون HTTPS ومتاح من الإنترنت (للتجربة محلياً استخدم ngrok أو cloudflared).

## إزاي الدفع بيشتغل
1. العميل يختار باقة ← `POST /api/checkout` (باقة + اسم + إيميل بس).
2. السيرفر يحسب **السعر بنفسه** من `config.js`، ينشئ الطلب، ويكلّم Paymob (auth ← order ← payment key).
3. العميل يتحوّل لصفحة Paymob الآمنة.
4. Paymob يبعت الـ webhook ← السيرفر يتحقق من **HMAC-SHA512** ويطابق المبلغ والعملة مع المحفوظ عنده ← الطلب يبقى `paid`.
5. العميل يرجع للمتجر ويشوف حالة طلبه (الحالة من الـ webhook مش من رابط الرجوع، فمينفعش تتزوّر).

> فرق عن PayPal القديم: التزوير في السعر اتقفل لأن السعر على السيرفر، والتأكيد تلقائي.

## الباقات والأسعار (في قاعدة البيانات)
`PACKAGES` في `config.js` بتتزرع **مرة واحدة** عند أول تشغيل، وبعدها الباقات بتتعدّل من الـ API من غير إعادة نشر:
```bash
# كل الباقات
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://API/api/admin/packages
# إضافة/تعديل (السعر بالجنيه، رقم صحيح)
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"VIP","price":500,"icon":"fa-crown","color":"#ffd700","features":["ميزة 1","ميزة 2"]}' \
  https://API/api/admin/packages/vip
# حذف (لو عليها طلبات بتتعطّل بدل ما تتمسح)
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" https://API/api/admin/packages/vip
```

## إدارة الطلبات
أنشئ `ADMIN_TOKEN` طويل: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

```bash
# كل الطلبات المدفوعة
curl -H "Authorization: Bearer $ADMIN_TOKEN" "https://API/api/admin/orders?status=paid"
# علّم الطلب إنه اتسلّم داخل اللعبة
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://API/api/admin/orders/<id>/deliver
```
الحالات: `pending` · `paid` · `failed` · `voided` · `refunded` · `mismatch` (المبلغ مش مطابق: راجعه يدوياً).

## النشر
الباك إند سيرفر Node عادي بيحفظ في ملف، فمحتاج استضافة بقرص دائم: **Render / Railway / Fly.io / VPS**.
**مش مناسب لـ Vercel** لأن ملفاتها بتتمسح وبتتعامل مع الدوال كل مرة لوحدها (لو عايز Vercel لازم قاعدة بيانات خارجية زي Postgres/Supabase، قولّي وأحوّله).

- شغّل `node server/server.js` (Node 18+)، واضبط متغيّرات `.env` في الاستضافة.
- `SITE_URL` = دومين الموقع بالظبط (بيتستخدم في CORS والتحويل بعد الدفع).
- لو الموقع على دومين والـ API على دومين تاني، حط قبل `store.js` في `store.html`:
  `<script>window.NOVA_API_BASE="https://api.novaweb.io"</script>`

## أمان
- ما تحطش `.env` في Git (ده في `.gitignore`).
- ملفات `server/` و`.env` و`data/` محجوبة من الخدمة العامة.
- فيه rate limit على الدفع والإدارة، وتحقق من المدخلات.

## النشر على Railway
1. ارفع المشروع على GitHub (من الروت `nova`) ← Railway ← **New Project ← Deploy from GitHub repo**.
2. **Settings ← Volumes ← New Volume** واربطه على `/data` (عشان الطلبات ماتتمسحش مع كل نشر).
3. **Variables** ضيف:
   `ADMIN_TOKEN` · `PAYMOB_API_KEY` · `PAYMOB_INTEGRATION_ID` · `PAYMOB_IFRAME_ID` · `PAYMOB_HMAC_SECRET` ·
   `DATA_DIR=/data` · `CURRENCY=EGP` · `SITE_URL` و`PUBLIC_API_URL` = رابط الخدمة (https://xxxx.up.railway.app أو دومينك).
4. **Settings ← Networking ← Generate Domain** (أو Custom Domain)، وبعدها حدّث `SITE_URL` و`PUBLIC_API_URL` بالرابط ده.
5. في Paymob حط: webhook = `https://<الرابط>/api/paymob/webhook` ورجوع = `https://<الرابط>/api/paymob/return`.
6. افتح `https://<الرابط>/api/health` لازم يرجع `paymobConfigured: true`.

## باقة "دعم السيرفر" (مبلغ حر)
اللاعب بيكتب المبلغ اللي هو عايزه، والسيرفر بيتحقق إنه بين الحد الأدنى والأقصى (مش بيثق في المتصفح).
- الحد الأدنى: `MIN_CUSTOM_AMOUNT` (الافتراضي **100 جنيه ≈ 2$**، أو 2 لو `CURRENCY=USD`).
- الحد الأقصى: `MAX_CUSTOM_AMOUNT` (الافتراضي 50000 جنيه).
- أي باقة تتحوّل لمبلغ حر بـ `"custom": true` في `PUT /api/admin/packages/<id>` (والسعر وقتها = الحد الأدنى).
- لو عندك قاعدة بيانات قديمة اتزرعت قبل الباقة دي، ضيفها بالأمر ده:
  `curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"name":"دعم السيرفر","price":100,"custom":true,"icon":"fa-heart","color":"#ff5c8a","features":["ادفع أي مبلغ تحبه"]}' https://API/api/admin/packages/support`
