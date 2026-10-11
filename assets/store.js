// واجهة المتجر: الباقات والأسعار بتيجي من الباك إند، والدفع عبر Paymob.
// لو الباك إند على دومين تاني، عدّل API_BASE (مثال: "https://api.novaweb.io").
(function () {
  var API_BASE = window.NOVA_API_BASE || '';
  var $ = function (id) { return document.getElementById(id); };
  var current = null;
  var currency = 'EGP';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return n.toLocaleString('ar-EG') + ' ' + (currency === 'EGP' ? 'ج.م' : currency); }

  function render(pkgs) {
    $('packages').innerHTML = pkgs.map(function (p) {
      return '<div class="card pkg">' +
        '<div class="ico" style="color:' + esc(p.color) + '"><i class="fa-solid ' + esc(p.icon) + '"></i></div>' +
        '<h3>' + esc(p.name) + '</h3>' +
        '<div class="m-price">' + (p.custom ? 'ابتداءً من ' : '') + money(p.price) + '</div>' +
        '<ul class="pkg-f">' + p.features.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' +
        '<button class="btn btn-primary" data-id="' + esc(p.id) + '" style="width:100%;justify-content:center">اشترِ الآن</button>' +
        '</div>';
    }).join('');
    $('packages').querySelectorAll('button[data-id]').forEach(function (b) {
      b.addEventListener('click', function () {
        open(pkgs.find(function (p) { return p.id === b.dataset.id; }));
      });
    });
  }

  function open(p) {
    current = p;
    $('m-name').textContent = p.name;
    $('m-price').textContent = (p.custom ? 'ابتداءً من ' : '') + money(p.price);
    $('m-amount-wrap').hidden = !p.custom;
    if (p.custom) {
      $('m-amount').min = p.price; $('m-amount').max = p.max; $('m-amount').value = p.price;
      $('m-amount-label').textContent = 'المبلغ (' + (currency === 'EGP' ? 'ج.م' : currency) + ') — الحد الأدنى ' + p.price;
    }
    $('m-ico').style.color = p.color;
    $('m-ico').innerHTML = '<i class="fa-solid ' + p.icon + '"></i>';
    $('m-err').hidden = true;
    $('modal').hidden = false;
  }
  function close() { $('modal').hidden = true; }

  function fail(msg) { var e = $('m-err'); e.textContent = msg; e.hidden = false; }

  async function pay() {
    if (!current) return;
    var btn = $('m-pay');
    var body = {
      packageId: current.id,
      player: $('m-player').value.trim(),
      email: $('m-email').value.trim(),
      phone: $('m-phone').value.trim()
    };
    if (current.custom) {
      body.amount = Number($('m-amount').value);
      if (!isFinite(body.amount) || body.amount < current.price) return fail('أقل مبلغ هو ' + money(current.price));
      if (current.max && body.amount > current.max) return fail('أقصى مبلغ هو ' + money(current.max));
    }
    if (body.player.length < 2) return fail('اكتب اسمك داخل اللعبة');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) return fail('اكتب بريد إلكتروني صحيح');

    btn.disabled = true;
    try {
      var r = await fetch(API_BASE + '/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || 'حدث خطأ');
      window.location.href = d.paymentUrl;
    } catch (e) {
      fail(e.message || 'حدث خطأ، حاول مرة أخرى');
      btn.disabled = false;
    }
  }

  var LABELS = {
    paid: ['success', 'تم الدفع بنجاح ✅ — ستقوم الإدارة بتفعيل مشترياتك قريباً.'],
    pending: ['info', 'جاري تأكيد الدفع…'],
    failed: ['error', 'فشلت عملية الدفع. يمكنك المحاولة مرة أخرى.'],
    voided: ['error', 'تم إلغاء العملية.'],
    refunded: ['error', 'تم استرجاع المبلغ.'],
    mismatch: ['error', 'هناك مشكلة في مطابقة المبلغ، تواصل مع الإدارة وأرفق رقم الطلب.']
  };

  async function showOrder(id) {
    var box = $('order-status');
    var tries = 0;
    async function tick() {
      try {
        var r = await fetch(API_BASE + '/api/orders/' + encodeURIComponent(id) + '/status');
        if (!r.ok) { box.innerHTML = ''; return; }
        var o = await r.json();
        var l = LABELS[o.status] || ['info', o.status];
        box.innerHTML = '<div class="notice"><b>طلب #' + esc(o.id) + ' — ' + esc(o.packageName) + '</b><br>' + esc(l[1]) + '</div>';
        if (o.status === 'pending' && tries++ < 12) setTimeout(tick, 4000);
      } catch (e) { /* تجاهل */ }
    }
    tick();
  }

  async function init() {
    $('modal-x').addEventListener('click', close);
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) close(); });
    $('m-pay').addEventListener('click', pay);

    try {
      var r = await fetch(API_BASE + '/api/packages');
      var d = await r.json();
      currency = d.currency;
      render(d.packages);
    } catch (e) {
      $('packages').innerHTML = '<div class="notice">تعذّر تحميل الباقات حالياً.</div>';
    }

    var id = new URLSearchParams(location.search).get('order');
    if (id) showOrder(id);
  }
  init();
})();
