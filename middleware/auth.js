const REQUIRED_GUILD_ID = process.env.DISCORD_GUILD_ID || '1476232552564916387';
const JOIN_LINK = 'https://discord.gg/dkhSKu8hHF';

/* ── كاشات الأدوار (تخفيف Railway) ──
   كانت كل زيارة صفحة تبعث 2-3 استعلامات (roles + role_page_access + role_role_permissions).
   الكاش مشترك لكل الرولات بتواقيع 60 ثانية — نفس سلوك كاش النافبار الموجود (rolePermCache)
   — تعديل صلاحيات من اللوحة ينعكس خلال أقل من دقيقة بدون أي استعلام إضافي بالطلبات العادية */
const ROLE_TTL = 60 * 1000;
const roleInfoCache = new Map();       // name -> { id, is_admin_role, at }
const rolePageAccessCache = new Map(); // role_id -> { map: Map(page_path -> 0/1), at }
const roleKeyPermCache = new Map();    // role_id -> { set: Set(enabled keys), at }
setInterval(() => {
  const now = Date.now();
  roleInfoCache.forEach((v, k) => { if (now - v.at > ROLE_TTL) roleInfoCache.delete(k); });
  rolePageAccessCache.forEach((v, k) => { if (now - v.at > ROLE_TTL) rolePageAccessCache.delete(k); });
  roleKeyPermCache.forEach((v, k) => { if (now - v.at > ROLE_TTL) roleKeyPermCache.delete(k); });
}, 60 * 1000).unref();
function roleInfoValid(e) { return e && (Date.now() - e.at) < ROLE_TTL; }
async function getRoleInfo(db, name) {
  const hit = roleInfoCache.get(name);
  if (roleInfoValid(hit)) return hit;
  const [rows] = await db.execute('SELECT id, is_admin_role FROM roles WHERE name = ?', [name]);
  const info = rows.length ? { id: rows[0].id, is_admin_role: rows[0].is_admin_role, at: Date.now() } : { missing: true, at: Date.now() };
  roleInfoCache.set(name, info);
  return info;
}
async function getRolePageAccess(db, roleId) {
  const hit = rolePageAccessCache.get(roleId);
  if (hit && (Date.now() - hit.at) < ROLE_TTL) return hit.map;
  const [rows] = await db.execute('SELECT page_path, can_access FROM role_page_access WHERE role_id = ?', [roleId]);
  const map = new Map();
  rows.forEach(r => map.set(r.page_path, r.can_access ? 1 : 0));
  rolePageAccessCache.set(roleId, { map, at: Date.now() });
  return map;
}
async function getRoleKeyPerms(db, roleId) {
  const hit = roleKeyPermCache.get(roleId);
  if (hit && (Date.now() - hit.at) < ROLE_TTL) return hit.set;
  const [rows] = await db.execute('SELECT permission_key FROM role_role_permissions WHERE role_id = ? AND enabled = 1', [roleId]);
  const set = new Set(rows.map(r => r.permission_key));
  roleKeyPermCache.set(roleId, { set, at: Date.now() });
  return set;
}

// Dead-token cooldown — when Discord replies 401/403 the bot token is invalid:
// stop paying a doomed API roundtrip on EVERY authed page load. One retry per
// 5 min keeps self-healing once a fresh token lands in Railway variables.
let guildCheckCooldownUntil = 0;
let lastGuildErrLog = 0;

const isAuthenticated = (req, res, next) => {
  if (req.user) {
    // Check if user is banned
    if (req.user.is_banned) {
      const db = require('../config/database');
      const bannerPromise = req.user.banned_by
        ? db.execute('SELECT username FROM users WHERE id = ?', [req.user.banned_by]).then(([r]) => r.length ? r[0].username : 'غير معروف')
        : Promise.resolve(null);
      return bannerPromise.then(bannerName => {
        return res.render('pages/banned', {
          title: 'محظور',
          username: req.user.username,
          banReason: req.user.ban_reason || 'لا يوجد سبب محدد',
          bannedAt: req.user.banned_at,
          bannedUntil: req.user.banned_until,
          bannedBy: bannerName
        });
      });
    }
    return next();
  }
  req.session.returnTo = req.originalUrl;
  return res.redirect('/auth/login');
};

const isInGuild = async (req, res, next) => {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }

  // Check if user is banned
  if (req.user.is_banned) {
    const db = require('../config/database');
    const bannerPromise = req.user.banned_by
      ? db.execute('SELECT username FROM users WHERE id = ?', [req.user.banned_by]).then(([r]) => r.length ? r[0].username : 'غير معروف')
      : Promise.resolve(null);
    return bannerPromise.then(bannerName => {
      return res.render('pages/banned', {
        title: 'محظور',
        username: req.user.username,
        banReason: req.user.ban_reason || 'لا يوجد سبب محدد',
        bannedAt: req.user.banned_at,
        bannedUntil: req.user.banned_until,
        bannedBy: bannerName
      });
    });
  }

  try {
    const axios = require('axios');
    const db = require('../config/database');
    const botToken = process.env.DISCORD_BOT_TOKEN;

    // Check cached result in database
    const [cached] = await db.execute('SELECT in_guild FROM users WHERE id = ?', [req.user.id]);
    if (cached.length > 0 && cached[0].in_guild === 1) {
      return next();
    }

    if (!botToken) {
      console.log('⚠️ DISCORD_BOT_TOKEN not set, skipping guild check');
      return next();
    }

    // Token known-bad (recent 401/403) → skip the doomed call, fail open
    if (Date.now() < guildCheckCooldownUntil) return next();

    // Use Bot Token to check member directly - most reliable method
    const response = await axios.get(
      `https://discord.com/api/v10/guilds/${REQUIRED_GUILD_ID}/members/${req.user.discord_id}`,
      { headers: { Authorization: `Bot ${botToken}` } }
    );

    const isInServer = response.status === 200 && response.data;
    console.log(`Guild check: ${req.user.username} → ${isInServer ? '✅ member' : '❌ not member'}`);

    // Cache result
    await db.execute('UPDATE users SET in_guild = ? WHERE id = ?', [isInServer ? 1 : 0, req.user.id]);

    if (!isInServer) {
      return res.render('pages/not-in-server', {
        title: 'انضم لسيرفرنا',
        joinLink: JOIN_LINK,
        error: 'not_in_server'
      });
    }

    return next();
  } catch (err) {
    const st = err.response && err.response.status;
    // 404 = member not found in guild (valid token, real answer)
    if (st === 404) {
      return res.render('pages/not-in-server', {
        title: 'انضم لسيرفرنا',
        joinLink: JOIN_LINK,
        error: 'not_in_server'
      });
    }
    // 401/403 = invalid/revoked bot token — cooldown 5 min (log throttled to 1/min)
    if (st === 401 || st === 403) {
      guildCheckCooldownUntil = Date.now() + 5 * 60 * 1000;
    }
    if (Date.now() - lastGuildErrLog > 60000) {
      lastGuildErrLog = Date.now();
      console.error('Guild check error:', err.message);
    }
    // On error, let user pass (don't block)
    return next();
  }
};

const ADMIN_ROLES = ['owner', 'admin', 'moderator', 'support'];

const isAdmin = (req, res, next) => {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }

  // Quick check first
  if (ADMIN_ROLES.includes(req.user.role)) {
    return next();
  }

  const db = require('../config/database');
  getRoleInfo(db, req.user.role)
    .then((role) => {
      if (!role.missing && role.is_admin_role === 1) return next();
      return res.status(403).render('pages/error', {
        title: 'غير مصرح',
        error: 'ليس لديك صلاحية للوصول لهذه الصفحة'
      });
    })
    .catch(() => {
      // Fallback to hardcoded list if DB fails
      if (ADMIN_ROLES.includes(req.user.role)) {
        return next();
      }
      return res.status(403).render('pages/error', {
        title: 'غير مصرح',
        error: 'ليس لديك صلاحية للوصول لهذه الصفحة'
      });
    });
};

// Advanced permission checker
const checkPagePermission = (page, action) => {
  return (req, res, next) => {
    if (!req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/auth/login');
    }

    // Owner/admin bypass
    if (req.user.role === 'owner') return next();
    if (ADMIN_ROLES.includes(req.user.role)) return next();

    const db = require('../config/database');
    db.execute('SELECT id FROM roles WHERE name = ?', [req.user.role])
      .then(([role]) => {
        if (!role.length) return denyAccess(res);
        return db.execute('SELECT * FROM role_page_permissions WHERE role_id = ? AND page = ?', [role[0].id, page]);
      })
      .then(([perms]) => {
        if (!perms || !perms.length) return denyAccess(res);
        if (perms[0][action] === 1) return next();
        return denyAccess(res);
      })
      .catch(() => denyAccess(res));
  };
};

const checkElementPermission = (page, element) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'غير مصرح' });
    if (req.user.role === 'owner') return next();
    if (ADMIN_ROLES.includes(req.user.role)) return next();

    const db = require('../config/database');
    db.execute('SELECT id FROM roles WHERE name = ?', [req.user.role])
      .then(([role]) => {
        if (!role.length) return res.status(403).json({ error: 'غير مصرح' });
        return db.execute('SELECT * FROM role_element_permissions WHERE role_id = ? AND page = ? AND element_id = ?', [role[0].id, page, element]);
      })
      .then(([perms]) => {
        if (!perms || !perms.length || !perms[0].can_use) return res.status(403).json({ error: 'ليس لديك صلاحية' });
        return next();
      })
      .catch(() => res.status(403).json({ error: 'خطأ في الصلاحيات' }));
  };
};

const checkCanBan = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'غير مصرح' });
  if (req.user.role === 'owner') return next();

  const db = require('../config/database');
  db.execute('SELECT rp.* FROM role_punishments rp JOIN roles r ON rp.role_id = r.id WHERE r.name = ?', [req.user.role])
    .then(([p]) => {
      if (p.length && p[0].can_ban) return next();
      return res.status(403).json({ error: 'ليس لديك صلاحية الحظر' });
    })
    .catch(() => res.status(403).json({ error: 'خطأ في الصلاحيات' }));
};

function denyAccess(res) {
  return res.status(403).render('pages/error', {
    title: 'غير مصرح',
    error: 'ليس لديك صلاحية للوصول لهذه الصفحة'
  });
}

/**
 * Unified permission checker — checks role_role_permissions + side_role_permissions
 * Owner always passes. Admin roles pass by default.
 * Side roles are ADDITIVE: they can only grant, never revoke.
 */
const checkPermission = (permissionKey) => {
  return (req, res, next) => {
    if (!req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/auth/login');
    }
    if (req.user.role === 'owner') return next();

    const db = require('../config/database');
    getRoleInfo(db, req.user.role)
      .then(async (role) => {
        if (role.missing) {
          if (ADMIN_ROLES.includes(req.user.role)) return next();
          return checkSideRolePermission(db, req.user.id, permissionKey, next, res);
        }
        if (role.is_admin_role) return next();
        const perms = await getRoleKeyPerms(db, role.id);
        if (perms.has(permissionKey)) return next();
        return checkSideRolePermission(db, req.user.id, permissionKey, next, res);
      })
      .catch((err) => {
        console.error('checkPermission error:', err.message);
        if (ADMIN_ROLES.includes(req.user.role)) return next();
        return denyAccess(res);
      });
  };
};

/**
 * Check if any side role grants this permission (additive only)
 */
async function checkSideRolePermission(db, userId, permissionKey, next, res) {
  try {
    const [srPerm] = await db.execute(
      'SELECT srp.enabled FROM side_role_permissions srp JOIN user_side_roles usr ON srp.side_role_id = usr.side_role_id WHERE usr.user_id = ? AND srp.permission_key = ? AND srp.enabled = 1',
      [userId, permissionKey]
    );
    if (srPerm.length > 0) return next();
  } catch(_) {}
  return denyAccess(res);
}

/**
 * Check if user has a specific permission (returns boolean)
 * Includes side role permissions (additive)
 */
async function userHasPermission(userId, permissionKey) {
  const db = require('../config/database');
  const [user] = await db.execute('SELECT role FROM users WHERE id = ?', [userId]);
  if (!user.length) return false;
  if (user[0].role === 'owner') return true;
  const role = await getRoleInfo(db, user[0].role);
  if (role.missing) return false;
  if (role.is_admin_role) return true;
  const perms = await getRoleKeyPerms(db, role.id);
  if (perms.has(permissionKey)) return true;
  try {
    const [srPerm] = await db.execute(
      'SELECT srp.enabled FROM side_role_permissions srp JOIN user_side_roles usr ON srp.side_role_id = usr.side_role_id WHERE usr.user_id = ? AND srp.permission_key = ? AND srp.enabled = 1',
      [userId, permissionKey]
    );
    return srPerm.length > 0;
  } catch(_) { return false; }
}

/**
 * Check page access — owner and admin roles bypass.
 * For others, checks role_page_access + side_role_page_access.
 * Side roles are ADDITIVE.
 */
const checkPageAccess = (pagePath) => {
  return (req, res, next) => {
    if (!req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/auth/login');
    }
    if (req.user.role === 'owner') return next();

    const db = require('../config/database');
    getRoleInfo(db, req.user.role)
      .then(async (role) => {
        if (role.missing) return checkSideRolePageAccess(db, req.user.id, pagePath, next, res);
        if (role.is_admin_role) return next();
        const accessMap = await getRolePageAccess(db, role.id);
        if (!accessMap.has(pagePath)) {
          return checkSideRolePageAccess(db, req.user.id, pagePath, next, res);
        }
        if (accessMap.get(pagePath)) return next();
        return denyAccess(res);
      })
      .catch(() => next());
  };
};

async function checkSideRolePageAccess(db, userId, pagePath, next, res) {
  try {
    const [srPage] = await db.execute(
      'SELECT srpa.can_access FROM side_role_page_access srpa JOIN user_side_roles usr ON srpa.side_role_id = usr.side_role_id WHERE usr.user_id = ? AND srpa.page_path = ? AND srpa.can_access = 1',
      [userId, pagePath]
    );
    if (srPage.length > 0) return next();
  } catch(_) {}
  return denyAccess(res);
}

module.exports = { isAuthenticated, isInGuild, isAdmin, checkPagePermission, checkElementPermission, checkCanBan, checkPermission, checkPageAccess, userHasPermission, REQUIRED_GUILD_ID };
