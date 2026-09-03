// ==========================================
// HOME PAGE JS - Optimized
// ==========================================

document.addEventListener('DOMContentLoaded', function() {
  // Stat counter animation (lightweight)
  const statValues = document.querySelectorAll('.stat-value[data-target]');
  if (statValues.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const text = el.textContent;
          const num = parseInt(text);
          if (!isNaN(num)) {
            animateValue(el, 0, num, 1200, text.replace(num.toString(), ''));
          }
          observer.unobserve(el);
        }
      });
    }, { threshold: 0.5 });
    statValues.forEach(el => observer.observe(el));
  }

  function animateValue(el, start, end, duration, suffix) {
    let startT = null;
    function tick(now) {
      if (!startT) startT = now;
      const p = Math.min((now - startT) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.floor(start + (end - start) * ease) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Giveaway timers
  document.querySelectorAll('.giveaway-timer[data-end]').forEach(timer => {
    const end = new Date(timer.dataset.end);
    function tick() {
      const diff = end - Date.now();
      if (diff <= 0) { timer.querySelector('.timer').textContent = 'انتهى'; return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      let t = '';
      if (d) t += d + ' يوم ';
      if (h) t += h + ' ساعة ';
      if (m) t += m + ' دقيقة ';
      t += s + ' ثانية';
      timer.querySelector('.timer').textContent = t;
    }
    tick();
    setInterval(tick, 1000);
  });
});
