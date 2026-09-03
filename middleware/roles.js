const db = require('../config/database');

const ROLE_HIERARCHY = {
  'user': 0,
  'family_member': 1,
  'company_member': 2,
  'vip': 3,
  'support': 4,
  'moderator': 5,
  'observer': 6,
  'supervisor': 7,
  'deputy_executive': 8,
  'executive': 9,
  'deputy_leadership': 10,
  'leadership': 11,
  'vice_president': 12,
  'chairman': 13,
  'chancellor': 14,
  'executive_director': 15,
  'vice_founder': 16,
  'founder': 17,
  'developer': 18,
  'owner': 19
};

const checkRole = (minRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.redirect('/auth/discord');
    }

    const userRank = ROLE_HIERARCHY[req.user.role] || 0;
    const requiredRank = ROLE_HIERARCHY[minRole] || 0;

    if (userRank >= requiredRank) {
      return next();
    }

    res.status(403).render('pages/error', {
      title: 'غير مصرح',
      error: 'ليس لديك الصلاحية الكافية'
    });
  };
};

const checkPermission = (permission) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.redirect('/auth/discord');
    }

    try {
      const [rows] = await db.execute(
        'SELECT role_permissions FROM site_settings WHERE setting_key = ?',
        ['role_permissions']
      );

      if (rows.length > 0) {
        const permissions = JSON.parse(rows[0].role_permissions || '{}');
        const userPerms = permissions[req.user.role] || [];
        
        if (userPerms.includes(permission) || userPerms.includes('all')) {
          return next();
        }
      }

      const adminRoles = ['owner', 'developer', 'founder', 'vice_founder', 'chairman'];
      if (adminRoles.includes(req.user.role)) {
        return next();
      }

      res.status(403).json({ error: 'ليس لديك الصلاحية' });
    } catch (err) {
      console.error('Permission check error:', err);
      res.status(500).json({ error: 'خطأ في التحقق من الصلاحيات' });
    }
  };
};

module.exports = { checkRole, checkPermission, ROLE_HIERARCHY };
