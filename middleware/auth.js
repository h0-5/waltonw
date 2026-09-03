const db = require('../config/database');

const isAuthenticated = async (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  
  if (req.session && req.session.userId) {
    try {
      const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [req.session.userId]);
      if (rows.length > 0) {
        req.user = rows[0];
        res.locals.user = rows[0];
        return next();
      }
    } catch (err) {
      console.error('Session auth error:', err);
    }
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/discord');
};

const isGuest = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.redirect('/');
  }
  next();
};

const isAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.redirect('/auth/discord');
  }

  const adminRoles = [
    'owner', 'developer', 'founder', 'vice_founder', 'chairman',
    'executive_director', 'leadership', 'deputy_leadership',
    'executive', 'deputy_executive', 'supervisor', 'observer',
    'moderator', 'support'
  ];

  if (adminRoles.includes(req.user.role)) {
    return next();
  }

  res.status(403).render('pages/error', {
    title: 'غير مصرح',
    error: 'ليس لديك صلاحية للوصول لهذه الصفحة'
  });
};

module.exports = { isAuthenticated, isGuest, isAdmin };
