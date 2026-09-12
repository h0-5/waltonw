// ==========================================
// HOME PAGE JS v3 — عدّادات + تنازل المسابقات + لمسة الضوء
// كل شيء يبدأ فقط عند الحاجة ويتوقف تلقائياً — بلا حلقات دائمة
// وبلا أي عمل عند السكون، والحركة على أجهزة خفيفة معطّلة
// ==========================================
(function () {
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── عدّادات الإحصائيات: تبدأ عند ظهور الشريط فقط ──
  // القيم غير الرقمية (24/7 مثلاً) تبقى كما كتبها السيرفر
  function animateValue(el, end, duration, suffix) {
    var startT = null;
    function tick(now) {
      if (!startT) startT = now;
      var p = Math.min((now - startT) / duration, 1);
      var ease = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = Math.floor(end * ease) + suffix;
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = end + suffix;
    }
    requestAnimationFrame(tick);
  }

  var counters = document.querySelectorAll('.hx-stat-val');
  if (counters.length && !reduced && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        io.unobserve(el);
        var m = (el.textContent || '').trim().match(/^(\d[\d,]*)\s*(.*)$/);
        if (!m) return;
        var end = parseInt(m[1].replace(/,/g, ''), 10);
        if (!isFinite(end) || end === 0) return;
        animateValue(el, end, 1100, m[2] || '');
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { io.observe(el); });
  }

  // ── تنازل المسابقات: صيغة أيام/ساعات/دقائق وتحديث خفيف كل 30ث ──
  // لا مؤقت إطلاقاً إذا لم توجد أي مسابقة بصفحة
  var counts = document.querySelectorAll('.hx-count[data-end]');
  if (counts.length) {
    var fmt = function (diff) {
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      if (d) return d + ' يوم' + (h ? ' ' + h + ' ساعة' : '');
      if (h) return h + ' ساعة' + (m ? ' ' + m + ' دقيقة' : '');
      return Math.max(m, 1) + ' دقيقة';
    };
    var tickCounts = function () {
      var now = Date.now();
      counts.forEach(function (el) {
        var val = el.querySelector('.hx-count-val');
        if (!val) return;
        var end = new Date(el.getAttribute('data-end')).getTime();
        var diff = end - now;
        if (diff <= 0) { val.textContent = 'انتهت'; el.style.opacity = '.65'; }
        else val.textContent = fmt(diff);
      });
    };
    tickCounts();
    setInterval(tickCounts, 30000);
  }

  // ── لمسة الضوء على بطاقات الأخبار — ديسكتوب فقط (ماوس دقيق) ──
  // المستمع passive وrAF مرة لكل إطار، وما يشتغل إلا والمؤشر فعلاً فوق الشبكة —
  // صفر عمل على الهاتف وصفر عمل عند السكون حتى على الديسكتوب
  if (!reduced && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var grid = document.querySelector('.hx-news-grid');
    if (grid) {
      var queued = false, lastEv = null;
      grid.addEventListener('mousemove', function (e) {
        lastEv = e;
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
          queued = false;
          var t = lastEv.target;
          var card = t && t.closest ? t.closest('.hx-card') : null;
          if (!card) return;
          var r = card.getBoundingClientRect();
          card.style.setProperty('--mx', (lastEv.clientX - r.left) + 'px');
          card.style.setProperty('--my', (lastEv.clientY - r.top) + 'px');
        });
      }, { passive: true });
    }
  }
  // ── سطر الوصف الآلي (آلة كاتبة) — يبدأ بعد تحميل الصفحة كاملة بطلب المستخدم:
  // «ينكتب بعد ما تحمل صفحة ينكتب كذا قدام اللاعب» — النص كامل بالـ DOM أولاً
  // (يظهر لو تعطل JS)، ينمسح ثم يُكتب حرفاً حرفاً، والمؤشر يظهر أثناء الكتابة فقط.
  // مع تقليل الحركة: النص يظهر كاملاً فوراً بلا كتابة ولا مؤشر ──
  var typeWrap = document.querySelector('.hx-type');
  if (typeWrap) {
    var typeTxt = typeWrap.querySelector('.hx-type-txt');
    if (typeTxt) {
      var typeFull = (typeTxt.textContent || '').trim();
      if (!typeFull || reduced || !('setTimeout' in window)) {
        // بلا حركة: النص يبقى كما هو والسطر يعتبر منتهياً
        typeWrap.classList.add('done');
      } else {
        typeTxt.textContent = '';
        var typeStarted = false;
        var startTyping = function () {
          if (typeStarted) return;
          typeStarted = true;
          var i = 0;
          typeWrap.classList.add('typing');
          var typeTimer = setInterval(function () {
            i++;
            typeTxt.textContent = typeFull.slice(0, i);
            if (i >= typeFull.length) {
              clearInterval(typeTimer);
              typeWrap.classList.remove('typing');
              typeWrap.classList.add('done');
            }
          }, 38);
        };
        if (document.readyState === 'complete') setTimeout(startTyping, 600);
        else window.addEventListener('load', function () { setTimeout(startTyping, 600); });
      }
    }
  }
})();
