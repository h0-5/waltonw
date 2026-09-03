// ==========================================
// WALTON FAMILY v2 - MAIN JS
// Optimized for performance
// ==========================================

document.addEventListener('DOMContentLoaded', function() {
  // Mobile menu
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileNav = document.getElementById('mobileNav');
  if (mobileMenuBtn && mobileNav) {
    mobileMenuBtn.addEventListener('click', function() {
      mobileNav.classList.toggle('show');
      this.querySelector('i').classList.toggle('fa-bars');
      this.querySelector('i').classList.toggle('fa-times');
    });
  }

  // User dropdown
  const userMenuBtn = document.getElementById('userMenuBtn');
  const userDropdown = document.getElementById('userDropdown');
  if (userMenuBtn && userDropdown) {
    userMenuBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      userDropdown.classList.toggle('show');
    });
    document.addEventListener('click', function(e) {
      if (!userMenuBtn.contains(e.target) && !userDropdown.contains(e.target)) {
        userDropdown.classList.remove('show');
      }
    });
  }

  // Clock
  function updateClock() {
    const el = document.getElementById('statusClock');
    if (el) el.textContent = new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  updateClock();
  setInterval(updateClock, 1000);

  // Navbar scroll
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    window.addEventListener('scroll', function() {
      navbar.style.background = window.pageYOffset > 80 ? 'rgba(10, 8, 22, 0.95)' : 'rgba(10, 8, 22, 0.88)';
    }, { passive: true });
  }

  // Scroll reveal (IntersectionObserver - performance optimized)
  const revealElements = document.querySelectorAll('.reveal');
  if (revealElements.length > 0) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    revealElements.forEach(el => revealObserver.observe(el));
  }

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
});

// API Helper
window.WaltonAPI = {
  async get(url) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      return await res.json();
    } catch (e) { console.error('API Error:', e); throw e; }
  },
  async post(url, data) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(data)
      });
      return await res.json();
    } catch (e) { console.error('API Error:', e); throw e; }
  },
  showNotification(message, type = 'info') {
    const el = document.createElement('div');
    el.className = 'notification notification-' + type;
    el.innerHTML = '<i class="fas fa-' + (type === 'success' ? 'check-circle' : type === 'error' ? 'times-circle' : 'info-circle') + '"></i><span>' + message + '</span>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
  }
};

// Notification styles
(function() {
  const s = document.createElement('style');
  s.textContent = '.notification{position:fixed;top:85px;left:50%;transform:translateX(-50%) translateY(-16px);padding:10px 20px;background:rgba(18,15,30,0.95);border:1px solid rgba(249,115,22,0.2);border-radius:50px;display:flex;align-items:center;gap:8px;opacity:0;transition:all .3s;z-index:9999;backdrop-filter:blur(12px);font-size:14px}.notification.show{opacity:1;transform:translateX(-50%) translateY(0)}.notification-success{border-color:rgba(34,197,94,0.5);color:#22c55e}.notification-error{border-color:rgba(239,68,68,0.5);color:#ef4444}.notification-info{border-color:rgba(249,115,22,0.5);color:var(--ac)}';
  document.head.appendChild(s);
})();
