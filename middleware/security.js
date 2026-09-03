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

const maintenanceMode = async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      "SELECT setting_value FROM site_settings WHERE setting_key = 'maintenance_mode'"
    );
    
    if (rows.length > 0 && rows[0].setting_value === '1') {
      if (req.user && ['owner', 'developer', 'founder'].includes(req.user.role)) {
        return next();
      }
      return res.status(503).render('pages/maintenance', {
        title: 'الصيانة'
      });
    }
  } catch (err) {
    // If table doesn't exist, continue
  }
  next();
};

module.exports = { securityHeaders, preventBot, sanitizeInput, maintenanceMode };
