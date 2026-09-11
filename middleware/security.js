const db = require('../config/database');

const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
};

const preventBot = (req, res, next) => {
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  const botPatterns = ['bot', 'crawler', 'spider', 'scraper', 'curl', 'wget'];
  
  if (botPatterns.some(pattern => userAgent.includes(pattern))) {
    if (!req.path.startsWith('/api/')) {
      return res.status(403).send('Access denied');
    }
  }
  next();
};

const sanitizeInput = (req, res, next) => {
  if (req.body) {
    for (let key in req.body) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key]
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/on\w+="[^"]*"/gi, '')
          .trim();
      }
    }
  }
  next();
};

/* الصيانة والإغلاق يقرآن من كاش الإعدادات العام (req.settings — يُحمّل كل 5 دقائق ويتلغى فور
   الحفظ من اللوحة) بدل استعلامين لكل طلب صفحة — تخفيف Railway بدون أي تغيير بالميزة */
const maintenanceMode = (req, res, next) => {
  const cached = req.settings ? req.settings['maintenance_mode'] : null;
  if (cached !== null && cached !== undefined) {
    if (cached === '1') {
      if (req.user && ['owner', 'developer', 'founder'].includes(req.user.role)) return next();
      return res.status(503).render('pages/maintenance', { title: 'الصيانة' });
    }
    return next();
  }
  db.execute("SELECT setting_value FROM site_settings WHERE setting_key = 'maintenance_mode'")
    .then(([rows]) => {
      if (rows.length > 0 && rows[0].setting_value === '1') {
        if (req.user && ['owner', 'developer', 'founder'].includes(req.user.role)) return next();
        return res.status(503).render('pages/maintenance', { title: 'الصيانة' });
      }
      next();
    })
    .catch(() => next());
};

/* الإغلاق يقرأ من كاش الإعدادات العام (req.settings — يُحمّل كل 5 دقائق ويتلغى فور الحفظ من
   اللوحة) بدل 1-4 استعلامات site_settings مع كل طلب صفحة — تخفيف Railway بدون تغيير الميزة */
const lockdownMode = (req, res, next) => {
  // Skip for API routes, auth routes, and static files
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/') || req.path.startsWith('/images/') || req.path.startsWith('/css/') || req.path.startsWith('/js/')) {
    return next();
  }

  const applyLockdown = () => {
    const allowedRoles = ((req.settings && req.settings['site_lockdown_roles']) || 'owner,developer,founder')
      .split(',').map(r => r.trim());
    if (req.user && allowedRoles.includes(req.user.role)) return next();
    return res.status(503).render('pages/lockdown', {
      title: 'الموقع مغلق',
      message: (req.settings && req.settings['lockdown_message']) || 'الموقع مغلق حالياً. يرجى المحاولة لاحقاً.',
      reason: (req.settings && req.settings['lockdown_reason']) || '',
      image: ''
    });
  };

  const cached = req.settings ? req.settings['site_lockdown'] : null;
  if (cached !== null && cached !== undefined) {
    if (cached === '1') return applyLockdown();
    return next();
  }

  db.execute("SELECT setting_value FROM site_settings WHERE setting_key = 'site_lockdown'")
    .then(([rows]) => {
      if (rows.length > 0 && rows[0].setting_value === '1') return applyLockdown();
      next();
    })
    .catch(() => next());
};

module.exports = { securityHeaders, preventBot, sanitizeInput, maintenanceMode, lockdownMode };
