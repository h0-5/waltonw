const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAdmin, checkPermission, isAuthenticated } = require('../middleware/auth');

// DEBUG PAGE - shows exactly what's wrong
router.get('/debug', isAuthenticated, async (req, res) => {
  let debug = {};
  debug.user = req.user ? { id: req.user.id, username: req.user.username, role: req.user.role, discord_id: req.user.discord_id } : null;

  try {
    const [allRoles] = await db.execute('SELECT * FROM roles');
    debug.allRoles = allRoles;
  } catch(e) { debug.rolesError = e.message; }

  if (req.user) {
    try {
      const [myRole] = await db.execute('SELECT id, is_admin_role FROM roles WHERE name = ?', [req.user.role]);
      debug.myRoleFromDB = myRole.length ? myRole[0] : null;
    } catch(e) { debug.myRoleError = e.message; }
  }

  // Try rendering the roles page and capture errors
  try {
    const [roles] = await db.execute('SELECT * FROM roles ORDER BY is_admin_role DESC, sort_order ASC, id ASC');
    const [perms] = await db.execute('SELECT * FROM role_permissions');
    const permissions = {};
    perms.forEach(p => {
      if (!permissions[p.role_id]) permissions[p.role_id] = {};
      permissions[p.role_id][p.page] = { can_access: p.can_access, can_edit: p.can_edit, can_delete: p.can_delete, can_manage: p.can_manage };
    });

    let pagePerms = {};
    try { const [pp] = await db.execute('SELECT * FROM role_page_permissions'); pp.forEach(p => { if (!pagePerms[p.role_id]) pagePerms[p.role_id] = {}; pagePerms[p.role_id][p.page] = {}; }); } catch(e) { debug.pagePermsError = e.message; }

    let elemPerms = {};
    try { const [ep] = await db.execute('SELECT * FROM role_element_permissions'); ep.forEach(p => { if (!elemPerms[p.role_id]) elemPerms[p.role_id] = {}; }); } catch(e) { debug.elemPermsError = e.message; }

    let punishData = {};
    try { const [pd] = await db.execute('SELECT * FROM role_punishments'); pd.forEach(p => { punishData[p.role_id] = {}; }); } catch(e) { debug.punishError = e.message; }

    let unifiedPerms = {};
    try { const [up] = await db.execute('SELECT role_id, permission_key, enabled FROM role_role_permissions'); up.forEach(p => { if (!unifiedPerms[p.role_id]) unifiedPerms[p.role_id] = {}; unifiedPerms[p.role_id][p.permission_key] = p.enabled; }); } catch(e) { debug.unifiedError = e.message; }

    let sideRoles = [];
    try { const [sr] = await db.execute('SELECT * FROM side_roles ORDER BY sort_order ASC'); sideRoles = sr; } catch(e) { debug.sideRolesError = e.message; }

    let userSideRoles = {};
    try { const [usr] = await db.execute('SELECT user_id, side_role_id FROM user_side_roles'); usr.forEach(r => { if (!userSideRoles[r.user_id]) userSideRoles[r.user_id] = []; userSideRoles[r.user_id].push(r.side_role_id); }); } catch(e) { debug.userSideRolesError = e.message; }

    const { PERMISSION_GROUPS } = require('../config/permissions');

    let pageAccess = {};
    try { const [pa] = await db.execute('SELECT role_id, page_path, can_access FROM role_page_access'); pa.forEach(r => { if (!pageAccess[r.role_id]) pageAccess[r.role_id] = {}; pageAccess[r.role_id][r.page_path] = r.can_access; }); } catch(e) { debug.pageAccessError = e.message; }

    debug.renderData = { rolesCount: roles.length, rolesNames: roles.map(r => r.name), permsCount: Object.keys(permissions).length, pagePermsCount: Object.keys(pagePerms).length, unifiedPermsCount: Object.keys(unifiedPerms).length };
    debug.renderErrors = debug.pagePermsError || debug.elemPermsError || debug.punishError || debug.unifiedError || debug.sideRolesError || debug.pageAccessError ? debug : 'none';
  } catch(e) { debug.renderFatalError = e.message; }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<pre style="background:#111;color:#0f0;padding:2rem;font-size:14px;white-space:pre-wrap;direction:ltr">${JSON.stringify(debug, null, 2)}</pre>`);
});

// PROFILE DEBUG PAGE
router.get('/profile-debug', isAuthenticated, async (req, res) => {
  const steps = [];
  const safe = (label, fn) => {
    try { const r = fn(); steps.push({ step: label, ok: true, result: r }); return r; }
    catch(e) { steps.push({ step: label, ok: false, error: e.message, stack: e.stack }); return null; }
  };
  const safeAsync = async (label, fn) => {
    try { const r = await fn(); steps.push({ step: label, ok: true, result: r }); return r; }
    catch(e) { steps.push({ step: label, ok: false, error: e.message, stack: e.stack }); return null; }
  };

  const step0 = safe('1. Check req.user', () => {
    if (!req.user) throw new Error('req.user is undefined!');
    return { id: req.user.id, username: req.user.username, role: req.user.role };
  });

  const step1 = safe('2. Check role', () => {
    const roles = ['owner','admin','moderator','support'];
    if (!roles.includes(req.user.role)) throw new Error('Role not allowed: ' + req.user.role);
    return true;
  });

  const step2 = await safeAsync('3. Fetch user from DB', async () => {
    const [rows] = await db.execute(`
      SELECT u.*, r.display_name as role_display, r.color as role_color, r.icon as role_icon
      FROM users u LEFT JOIN roles r ON u.role = r.name
      WHERE u.id = ?
    `, [req.user.id]);
    if (!rows[0]) throw new Error('User not found in DB! id=' + req.user.id);
    return { id: rows[0].id, username: rows[0].username, role: rows[0].role, hasProfilePicture: !!rows[0].profile_picture, hasRoleColor: !!rows[0].role_color, created_at: rows[0].created_at, last_login: rows[0].last_login };
  });

  const safeQuery = async (label, sql, params) => {
    try { const [r] = await db.execute(sql, params); steps.push({ step: label, ok: true, count: r.length }); return r; }
    catch(e) { steps.push({ step: label, ok: false, error: e.message }); return []; }
  };

  await safeQuery('4. Query support_tickets', 'SELECT COUNT(*) as c FROM support_tickets WHERE admin_id = ?', [req.user.id]);
  await safeQuery('5. Query submitted_applications', 'SELECT COUNT(*) as c FROM submitted_applications WHERE reviewed_by = ?', [req.user.id]);
  await safeQuery('6. Query orders', 'SELECT COUNT(*) as c FROM orders WHERE user_id = ?', [req.user.id]);
  await safeQuery('7. Query admin_logs', 'SELECT COUNT(*) as c FROM admin_logs WHERE user_id = ? AND DATE(created_at) = CURDATE()', [req.user.id]);
  await safeQuery('8. Query admin_warnings', 'SELECT * FROM admin_warnings WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 5', [req.user.id]);
  await safeQuery('9. Query admin_excuses', 'SELECT * FROM admin_excuses WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [req.user.id]);
  await safeQuery('10. Query admin_profile_logs', 'SELECT * FROM admin_profile_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 5', [req.user.id]);
  await safeQuery('11. Query orders+products join', 'SELECT o.*, p.name as product_name FROM orders o LEFT JOIN products p ON o.product_id = p.id WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 5', [req.user.id]);
  await safeQuery('12. Query staff', `SELECT u.id, u.username, u.profile_picture, u.role, r.display_name as role_display, r.color as role_color, r.icon as role_icon, r.sort_order FROM users u LEFT JOIN roles r ON u.role = r.name WHERE r.is_admin_role = 1 OR u.role IN ('owner','admin','moderator','support') ORDER BY r.sort_order ASC, u.id ASC`);

  const stepChart = await safeAsync('13. Build chartData', async () => {
    const chartRows = await db.execute(`SELECT DATE(created_at) as day, COUNT(*) as actions FROM admin_logs WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at)`, [req.user.id]);
    var chartData = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      chartData.push({ day: d.toISOString().slice(0,10) });
    }
    return { dataPoints: chartData.length };
  });

  const stepRender = await safeAsync('14. TEST RENDER profile.ejs', async () => {
    const user = step2;
    const stats = { tickets: 0, applications: 0, orders: 0, todayActions: 0, weekActions: 0, avgRating: '—' };
    const chartData = [{ day: 'test', actions: 0, tickets: 0, applications: 0 }];
    return new Promise((resolve, reject) => {
      res.render('admin/profile', {
        title: 'Debug Profile',
        user, stats, chartData,
        warnings: [], excuses: [], allLogs: [], tickets: [], applications: [], orders: [], staff: [],
        canWarn: false, canExcuse: false, currentPath: '/admin/profile'
      }, (err, html) => {
        if (err) reject(err);
        else resolve({ htmlLength: html.length });
      });
    });
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<pre style="background:#0a0a0f;color:#0f0;padding:2rem;font-size:13px;white-space:pre-wrap;direction:ltr;font-family:monospace">${JSON.stringify(steps, null, 2)}</pre>`);
});

// Load user permissions for sidebar filtering
router.use(isAdmin, async (req, res, next) => {
  try {
    if (req.user && req.user.role !== 'owner') {
      const [role] = await db.execute('SELECT id, is_admin_role FROM roles WHERE name = ?', [req.user.role]);
      if (role.length && !role[0].is_admin_role) {
        const [perms] = await db.execute('SELECT permission_key FROM role_role_permissions WHERE role_id = ? AND enabled = 1', [role[0].id]);
        const permMap = {};
        perms.forEach(p => { permMap[p.permission_key] = 1; });
        res.locals._admUserPerms = permMap;
      } else {
        // Admin roles see everything
        const { PERMISSION_GROUPS } = require('../config/permissions');
        const allPerms = {};
        for (const group of Object.values(PERMISSION_GROUPS)) {
          for (const pKey of Object.keys(group.permissions)) {
            allPerms[pKey] = 1;
          }
        }
        res.locals._admUserPerms = allPerms;
      }
    } else {
      // Owner sees everything
      const { PERMISSION_GROUPS } = require('../config/permissions');
      const allPerms = {};
      for (const group of Object.values(PERMISSION_GROUPS)) {
        for (const pKey of Object.keys(group.permissions)) {
          allPerms[pKey] = 1;
        }
      }
      res.locals._admUserPerms = allPerms;
    }
  } catch(e) {
    res.locals._admUserPerms = {};
  }
  next();
});

// Admin Dashboard
router.get('/', checkPermission('users_view'), async (req, res) => {
  try {
    const stats = {};
    try { const [r] = await db.execute('SELECT COUNT(*) as c FROM users'); stats.users = r[0].c; } catch(e) {}
    try { const [r] = await db.execute('SELECT COUNT(*) as c FROM fs_products'); stats.products = r[0].c; } catch(e) {}
    try { const [r] = await db.execute('SELECT COUNT(*) as c FROM orders'); stats.orders = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT COUNT(*) as c FROM support_tickets WHERE status='open'"); stats.openTickets = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT COUNT(*) as c FROM users WHERE last_login > DATE_SUB(NOW(), INTERVAL 24 HOUR)"); stats.activeToday = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT COUNT(*) as c FROM orders WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)"); stats.newOrders = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT COUNT(*) as c FROM news"); stats.newsCount = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT COUNT(*) as c FROM submitted_applications WHERE status='pending'"); stats.pendingApps = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT COUNT(*) as c FROM users WHERE is_banned = 1"); stats.bannedUsers = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT COUNT(*) as c FROM giveaways WHERE status='active'"); stats.activeGiveaways = r[0].c; } catch(e) {}

    // ── Visit analytics (site_visits / visit_uniques) ──
    const visits = { today: 0, yesterday: 0, week: 0, total: 0, uniqueToday: 0, daily: [], topPages: [] };
    try {
      const [todayRow] = await db.execute("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS d");
      const todayStr = todayRow[0].d;
      const [dailyRows] = await db.execute(
        "SELECT DATE_FORMAT(visit_date, '%Y-%m-%d') AS d, SUM(views) AS v FROM site_visits WHERE visit_date >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) GROUP BY visit_date"
      );
      const dmap = {};
      dailyRows.forEach(r => { dmap[r.d] = Number(r.v) || 0; });
      const t0 = new Date(todayStr + 'T00:00:00Z').getTime();
      for (let i = 13; i >= 0; i--) {
        const ds = new Date(t0 - i * 86400000).toISOString().slice(0, 10);
        visits.daily.push({ date: ds, views: dmap[ds] || 0 });
      }
      visits.today = visits.daily[13].views;
      visits.yesterday = visits.daily[12].views;
      visits.week = visits.daily.slice(7).reduce((s, x) => s + x.views, 0);
      try { const [t] = await db.execute('SELECT SUM(views) AS v FROM site_visits'); visits.total = Number(t[0].v) || 0; } catch(e) {}
      try { const [u] = await db.execute('SELECT COUNT(*) AS c FROM visit_uniques WHERE visit_date = CURDATE()'); visits.uniqueToday = u[0].c; } catch(e) {}
      try {
        const [tp] = await db.execute(
          "SELECT path, SUM(views) AS v FROM site_visits WHERE visit_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY path ORDER BY v DESC LIMIT 8"
        );
        visits.topPages = tp.map(r => ({ path: r.path, views: Number(r.v) || 0 }));
      } catch(e) {}
      try { const [b] = await db.execute('SELECT SUM(views) AS v FROM bot_visits WHERE visit_date = CURDATE()'); visits.botToday = Number(b[0].v) || 0; } catch(e) {}
    } catch(e) {}

    // Recent activity
    let recentActivity = [];
    try {
      const [logs] = await db.execute("SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 10");
      recentActivity = logs;
    } catch(e) {}

    // Recent users
    let recentUsers = [];
    try {
      const [users] = await db.execute("SELECT id, username, profile_picture, role, created_at FROM users ORDER BY created_at DESC LIMIT 5");
      recentUsers = users;
    } catch(e) {}

    res.render('admin/dashboard', { title: 'لوحة التحكم', stats, visits, recentActivity, recentUsers, currentPath: req.path });
  } catch(err) {
    res.render('admin/dashboard', { title: 'لوحة التحكم', stats: {}, visits: { today: 0, yesterday: 0, week: 0, total: 0, uniqueToday: 0, botToday: 0, daily: [], topPages: [] }, recentActivity: [], recentUsers: [], currentPath: req.path });
  }
});

// ═══ Security / Protection Center ═══
const guardModule = require('../middleware/guard');

router.get('/security', checkPermission('logs_view'), async (req, res) => {
  const sec = { blockedNow: 0, blockedToday: 0, botVisitsToday: 0, blockedList: [], topBots: [], botMode: (process.env.GUARD_BOT_MODE || 'log') };
  try {
    await guardModule.ensureTables();
    try { const [r] = await db.execute("SELECT COUNT(*) c FROM blocked_ips WHERE expires_at IS NULL OR expires_at > NOW()"); sec.blockedNow = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT COUNT(*) c FROM blocked_ips WHERE blocked_at >= CURDATE()"); sec.blockedToday = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT SUM(views) v FROM bot_visits WHERE visit_date = CURDATE()"); sec.botVisitsToday = Number(r[0].v) || 0; } catch(e) {}
    try {
      const [r] = await db.execute("SELECT ip, reason, user_agent, blocked_at, expires_at FROM blocked_ips WHERE expires_at IS NULL OR expires_at > NOW() ORDER BY blocked_at DESC LIMIT 100");
      sec.blockedList = r;
    } catch(e) {}
  } catch(e) {}
  sec.topBots = Array.from(guardModule.botUAStats.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  res.render('admin/security', { title: 'مركز الحماية', sec, currentPath: req.path });
});

router.post('/security/block', checkPermission('logs_view'), async (req, res) => {
  try {
    const ip = String(req.body.ip || '').trim().slice(0, 60);
    const reason = String(req.body.reason || 'manual').trim().slice(0, 180);
    if (ip) await guardModule.blockIp(ip, 'manual: ' + reason, '', null);
  } catch(e) {}
  res.redirect('/admin/security');
});

router.post('/security/unblock', checkPermission('logs_view'), async (req, res) => {
  try {
    const ip = String(req.body.ip || '').trim();
    if (ip) await guardModule.unblockIp(ip);
  } catch(e) {}
  res.redirect('/admin/security');
});

router.post('/security/clear-expired', checkPermission('logs_view'), async (req, res) => {
  try { await db.execute('DELETE FROM blocked_ips WHERE expires_at IS NOT NULL AND expires_at <= NOW()'); } catch(e) {}
  res.redirect('/admin/security');
});

// Users Management
router.get('/users', checkPermission('users_view'), async (req, res) => {
  try {
    const [users] = await db.execute("SELECT u.*, bp.points, bp.total_earned FROM users u LEFT JOIN bot_points bp ON u.discord_id = bp.discord_id ORDER BY FIELD(u.role, 'owner','developer','founder','vice_founder','chairman','present_member','vice_president','leadership','family_member','admin','moderator','support','member','trial','user') ASC, u.id DESC");
    const [sideRoles] = await db.execute('SELECT * FROM side_roles WHERE is_active = 1');
    const [roles] = await db.execute('SELECT name, display_name, color, icon FROM roles ORDER BY is_admin_role DESC, sort_order ASC, id ASC');
    res.render('admin/users', { title: 'إدارة المستخدمين', users, sideRoles, roles, currentUser: req.user, currentPath: req.path });
  } catch(err) {
    res.render('admin/users', { title: 'إدارة المستخدمين', users: [], sideRoles: [], roles: [], currentPath: req.path });
  }
});

// Products Management
router.get('/products', checkPermission('products_view'), async (req, res) => {
  try {
    const [products] = await db.execute('SELECT * FROM fs_products ORDER BY id DESC');
    res.render('admin/products', { title: 'إدارة المنتجات', products, currentPath: req.path });
  } catch(err) {
    res.render('admin/products', { title: 'إدارة المنتجات', products: [], currentPath: req.path });
  }
});

// Orders
router.get('/orders', checkPermission('store_orders_view'), async (req, res) => {
  try {
    const [orders] = await db.execute(`
      SELECT o.*, u.username, u.profile_picture as user_avatar,
             p.name as product_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN fs_products p ON o.product_id = p.id
      ORDER BY o.id DESC
    `);
    res.render('admin/orders', { title: 'إدارة الطلبات', orders, currentPath: req.path });
  } catch(err) {
    res.render('admin/orders', { title: 'إدارة الطلبات', orders: [], currentPath: req.path });
  }
});

// News
router.get('/news', checkPermission('news_add'), async (req, res) => {
  try {
    const [news] = await db.execute('SELECT n.*, u.username as author_name FROM news n LEFT JOIN users u ON n.author_id = u.id ORDER BY n.id DESC');
    const [giveaways] = await db.execute('SELECT id, title FROM giveaways ORDER BY id DESC');
    res.render('admin/news', { title: 'إدارة الأخبار', news, giveaways, currentPath: req.path });
  } catch(err) {
    res.render('admin/news', { title: 'إدارة الأخبار', news: [], giveaways: [], currentPath: req.path });
  }
});

// Tickets
router.get('/tickets', checkPermission('tickets_view'), async (req, res) => {
  try {
    const [tickets] = await db.execute('SELECT t.*, u.username, u.profile_picture as user_avatar FROM support_tickets t LEFT JOIN users u ON t.user_id = u.id ORDER BY t.id DESC');
    res.render('admin/tickets', { title: 'إدارة التذاكر', tickets, currentPath: req.path });
  } catch(err) {
    res.render('admin/tickets', { title: 'إدارة التذاكر', tickets: [], currentPath: req.path });
  }
});

// Applications - Submissions View
router.get('/applications', checkPermission('apps_view'), async (req, res) => {
  try {
    const [applications] = await db.query(`
      SELECT sa.*, u.username 
      FROM submitted_applications sa 
      LEFT JOIN users u ON sa.user_id = u.id 
      ORDER BY sa.id DESC
    `);
    const [types] = await db.query('SELECT application_type, title FROM application_settings');
    const questionsMap = {};
    for (const t of types) {
      const [qs] = await db.query('SELECT id, question, type, options FROM application_questions WHERE application_type = ?', [t.application_type]);
      questionsMap[t.application_type] = qs;
    }
    res.render('admin/applications', { title: 'الطلبات المقدمة', applications, types, questionsMap, currentPath: req.path });
  } catch(err) {
    console.error('Admin applications error:', err.message);
    res.render('admin/applications', { title: 'الطلبات المقدمة', applications: [], types: [], questionsMap: {}, currentPath: req.path });
  }
});

// Applications - Manage Types & Questions
router.get('/manage-apps', checkPermission('app_types_view'), async (req, res) => {
  try {
    const [types] = await db.query('SELECT * FROM application_settings ORDER BY id ASC');
    res.render('admin/manage-apps', { title: 'إدارة نظام التقديمات', types, currentPath: req.path });
  } catch(err) {
    console.error('Manage apps error:', err.message);
    res.render('admin/manage-apps', { title: 'إدارة نظام التقديمات', types: [], currentPath: req.path });
  }
});

// Settings
router.get('/settings', checkPermission('site_settings_view'), async (req, res) => {
  try {
    const settings = {};
    const [rows] = await db.execute('SELECT setting_key, setting_value FROM site_settings');
    rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
    const [roles] = await db.execute('SELECT name, display_name, icon FROM roles ORDER BY sort_order ASC, id ASC');
    const [aboutRows] = await db.execute('SELECT * FROM about_page LIMIT 1');
    const about = aboutRows[0] || {};
    res.render('admin/settings', { title: 'الإعدادات', settings, roles, about, currentPath: req.path });
  } catch(err) {
    console.error('[Admin/Settings]', err);
    res.render('admin/settings', { title: 'الإعدادات', settings: {}, roles: [], about: {}, currentPath: req.path });
  }
});

// Admin Profile Page
router.get('/profile', isAuthenticated, async (req, res) => {
  try {
    if (!req.user || !['owner','admin','moderator','support'].includes(req.user.role)) {
      return res.redirect('/admin');
    }
    const userId = req.user.id;
    let user;
    try {
      const [users] = await db.execute(`
        SELECT u.*, r.display_name as role_display, r.color as role_color, r.icon as role_icon
        FROM users u LEFT JOIN roles r ON u.role = r.name
        WHERE u.id = ?
      `, [userId]);
      user = users[0];
    } catch(joinErr) {
      console.error('[Admin/Profile] JOIN failed, trying simple query:', joinErr.message);
      const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [userId]);
      user = users[0] || null;
      if (user) {
        try {
          const [role] = await db.execute('SELECT display_name, color, icon FROM roles WHERE name = ?', [user.role]);
          if (role[0]) { user.role_display = role[0].display_name; user.role_color = role[0].color; user.role_icon = role[0].icon; }
        } catch(e2) { user.role_display = user.role; }
      }
    }
    if (!user) return res.redirect('/admin');

    const safeQuery = async (sql, params) => {
      try { return (await db.execute(sql, params))[0]; } catch(e) { return []; }
    };

    const ticketCount = await safeQuery('SELECT COUNT(*) as c FROM support_tickets WHERE admin_id = ?', [userId]);
    const appCount = await safeQuery('SELECT COUNT(*) as c FROM submitted_applications WHERE reviewed_by = ?', [userId]);
    const orderCount = await safeQuery('SELECT COUNT(*) as c FROM orders WHERE user_id = ?', [userId]);
    const todayCount = await safeQuery('SELECT COUNT(*) as c FROM admin_logs WHERE user_id = ? AND DATE(created_at) = CURDATE()', [userId]);
    const weekCount = await safeQuery('SELECT COUNT(*) as c FROM admin_logs WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)', [userId]);

    const chartRows = await safeQuery(`SELECT DATE(created_at) as day, COUNT(*) as actions FROM admin_logs WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at)`, [userId]);
    const chartTickets = await safeQuery(`SELECT DATE(created_at) as day, COUNT(*) as c FROM support_tickets WHERE admin_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at)`, [userId]);
    const chartApps = await safeQuery(`SELECT DATE(created_at) as day, COUNT(*) as c FROM submitted_applications WHERE reviewed_by = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at)`, [userId]);

    var chartData = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var dateStr = d.toISOString().slice(0, 10);
      var dayNames = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
      chartData.push({
        day: dayNames[d.getDay()],
        actions: (chartRows.find(r => new Date(r.day).toISOString().slice(0,10) === dateStr) || {}).actions || 0,
        tickets: (chartTickets.find(r => new Date(r.day).toISOString().slice(0,10) === dateStr) || {}).c || 0,
        applications: (chartApps.find(r => new Date(r.day).toISOString().slice(0,10) === dateStr) || {}).c || 0
      });
    }

    const warnings = await safeQuery('SELECT * FROM admin_warnings WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC', [userId]);
    const excuses = await safeQuery('SELECT * FROM admin_excuses WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    const allLogs = await safeQuery('SELECT * FROM admin_profile_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [userId]);
    const tickets = await safeQuery('SELECT * FROM support_tickets WHERE admin_id = ? ORDER BY created_at DESC LIMIT 20', [userId]);
    const applications = await safeQuery('SELECT * FROM submitted_applications WHERE reviewed_by = ? ORDER BY created_at DESC LIMIT 20', [userId]);
    const orders = await safeQuery('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [userId]);

    const staff = await safeQuery(`
      SELECT u.id, u.username, u.profile_picture, u.role, u.created_at, u.last_login, u.tickets_closed
      FROM users u
      WHERE u.role IN ('owner','admin','moderator','support')
      ORDER BY u.id ASC
    `);
    try {
      for (const s of staff) {
        const [role] = await db.execute('SELECT display_name, color, icon FROM roles WHERE name = ?', [s.role]);
        if (role[0]) { s.role_display = role[0].display_name; s.role_color = role[0].color; s.role_icon = role[0].icon; }
        else { s.role_display = s.role; s.role_color = '#fff'; s.role_icon = 'fa-user'; }
        const [ticketCount] = await db.execute('SELECT COUNT(*) as c FROM support_tickets WHERE admin_id = ? AND status = "closed"', [s.id]).catch(() => [[{c:0}]]);
        s.tickets_closed = ticketCount[0]?.c || 0;
        const [warnCount] = await db.execute('SELECT COUNT(*) as c FROM admin_warnings WHERE user_id = ? AND is_deleted = 0', [s.id]).catch(() => [[{c:0}]]);
        s.warnings_count = warnCount[0]?.c || 0;
      }
    } catch(e) { console.error('[Admin/Profile] Staff role fetch:', e.message); }

    const myRole = req.user.role;
    const isOwner = myRole === 'owner';
    let canWarn = isOwner, canExcuse = isOwner;
    if (!isOwner) {
      try {
        const [role] = await db.execute('SELECT id, is_admin_role FROM roles WHERE name = ?', [myRole]);
        if (role.length && role[0].is_admin_role) {
          canWarn = canExcuse = true;
        } else if (role.length) {
          const [perms] = await db.execute('SELECT permission_key, enabled FROM role_role_permissions WHERE role_id = ? AND permission_key IN ("admin_profile_warn","admin_profile_excuse")', [role[0].id]);
          perms.forEach(p => {
            if (!p.enabled) return;
            if (p.permission_key === 'admin_profile_warn') canWarn = true;
            if (p.permission_key === 'admin_profile_excuse') canExcuse = true;
          });
        }
      } catch(e) { console.error('[Admin/Profile] Perm check:', e.message); }
    }

    res.render('admin/profile', {
      title: 'البروفايل',
      user, stats: {
        tickets: ticketCount[0]?.c || 0,
        applications: appCount[0]?.c || 0,
        orders: orderCount[0]?.c || 0,
        todayActions: todayCount[0]?.c || 0,
        weekActions: weekCount[0]?.c || 0,
        avgRating: '—'
      },
      chartData, warnings, excuses, allLogs, tickets, applications, orders, staff,
      canWarn, canExcuse, currentPath: req.path
    });
  } catch(err) {
    console.error('[Admin/Profile]', err);
    res.status(500).send(`<pre>Profile Error: ${err.message}\n\n${err.stack}</pre>`);
  }
});

// View another admin's profile
router.get('/profile/:userId', isAuthenticated, async (req, res) => {
  try {
    if (!req.user || !['owner','admin','moderator','support'].includes(req.user.role)) {
      return res.redirect('/admin');
    }
    const targetId = req.params.userId;

    if (req.user.role !== 'owner') {
      const ROLE_RANK = { owner: 0, admin: 1, moderator: 2, support: 3, member: 14 };
      const [targetUser] = await db.execute('SELECT role FROM users WHERE id = ?', [targetId]);
      if (targetUser[0]) {
        const targetRank = ROLE_RANK[targetUser[0].role] || 14;
        const myRank = ROLE_RANK[req.user.role] || 14;
        if (targetRank <= myRank) return res.redirect('/admin/profile');
      }
    }

    const safeQuery = async (sql, params) => {
      try { return (await db.execute(sql, params))[0]; } catch(e) { return []; }
    };

    let user;
    try {
      const [users] = await db.execute(`
        SELECT u.*, r.display_name as role_display, r.color as role_color, r.icon as role_icon
        FROM users u LEFT JOIN roles r ON u.role = r.name WHERE u.id = ?
      `, [targetId]);
      user = users[0];
    } catch(joinErr) {
      console.error('[Admin/Profile/:userId] JOIN failed:', joinErr.message);
      const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [targetId]);
      user = users[0] || null;
      if (user) {
        try {
          const [role] = await db.execute('SELECT display_name, color, icon FROM roles WHERE name = ?', [user.role]);
          if (role[0]) { user.role_display = role[0].display_name; user.role_color = role[0].color; user.role_icon = role[0].icon; }
        } catch(e2) { user.role_display = user.role; }
      }
    }
    if (!user) return res.redirect('/admin/profile');

    const ticketCount = await safeQuery('SELECT COUNT(*) as c FROM support_tickets WHERE admin_id = ?', [targetId]);
    const appCount = await safeQuery('SELECT COUNT(*) as c FROM submitted_applications WHERE reviewed_by = ?', [targetId]);
    const orderCount = await safeQuery('SELECT COUNT(*) as c FROM orders WHERE user_id = ?', [targetId]);
    const todayCount = await safeQuery('SELECT COUNT(*) as c FROM admin_logs WHERE user_id = ? AND DATE(created_at) = CURDATE()', [targetId]);
    const weekCount = await safeQuery('SELECT COUNT(*) as c FROM admin_logs WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)', [targetId]);

    const chartRows = await safeQuery(`SELECT DATE(created_at) as day, COUNT(*) as actions FROM admin_logs WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at)`, [targetId]);
    const chartTickets = await safeQuery(`SELECT DATE(created_at) as day, COUNT(*) as c FROM support_tickets WHERE admin_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at)`, [targetId]);
    const chartApps = await safeQuery(`SELECT DATE(created_at) as day, COUNT(*) as c FROM submitted_applications WHERE reviewed_by = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at)`, [targetId]);

    var chartData = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var dateStr = d.toISOString().slice(0, 10);
      var dayNames = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
      chartData.push({
        day: dayNames[d.getDay()],
        actions: (chartRows.find(r => new Date(r.day).toISOString().slice(0,10) === dateStr) || {}).actions || 0,
        tickets: (chartTickets.find(r => new Date(r.day).toISOString().slice(0,10) === dateStr) || {}).c || 0,
        applications: (chartApps.find(r => new Date(r.day).toISOString().slice(0,10) === dateStr) || {}).c || 0
      });
    }

    const warnings = await safeQuery('SELECT * FROM admin_warnings WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC', [targetId]);
    const excuses = await safeQuery('SELECT * FROM admin_excuses WHERE user_id = ? ORDER BY created_at DESC', [targetId]);
    const allLogs = await safeQuery('SELECT * FROM admin_profile_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [targetId]);
    const tickets = await safeQuery('SELECT * FROM support_tickets WHERE admin_id = ? ORDER BY created_at DESC LIMIT 20', [targetId]);
    const applications = await safeQuery('SELECT * FROM submitted_applications WHERE reviewed_by = ? ORDER BY created_at DESC LIMIT 20', [targetId]);
    const orders = await safeQuery('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [targetId]);
    const staff = await safeQuery(`SELECT u.id, u.username, u.profile_picture, u.role, u.created_at, u.last_login, u.tickets_closed FROM users u WHERE u.role IN ('owner','admin','moderator','support') ORDER BY u.id ASC`);
    try {
      for (const s of staff) {
        const [role] = await db.execute('SELECT display_name, color, icon FROM roles WHERE name = ?', [s.role]);
        if (role[0]) { s.role_display = role[0].display_name; s.role_color = role[0].color; s.role_icon = role[0].icon; }
        else { s.role_display = s.role; s.role_color = '#fff'; s.role_icon = 'fa-user'; }
        const [ticketCount] = await db.execute('SELECT COUNT(*) as c FROM support_tickets WHERE admin_id = ? AND status = "closed"', [s.id]).catch(() => [[{c:0}]]);
        s.tickets_closed = ticketCount[0]?.c || 0;
        const [warnCount] = await db.execute('SELECT COUNT(*) as c FROM admin_warnings WHERE user_id = ? AND is_deleted = 0', [s.id]).catch(() => [[{c:0}]]);
        s.warnings_count = warnCount[0]?.c || 0;
      }
    } catch(e) {}

    const myRole = req.user.role;
    const isOwner = myRole === 'owner';
    let canWarn = isOwner, canExcuse = isOwner;
    if (!isOwner) {
      try {
        const [role] = await db.execute('SELECT id, is_admin_role FROM roles WHERE name = ?', [myRole]);
        if (role.length && role[0].is_admin_role) {
          canWarn = canExcuse = true;
        } else if (role.length) {
          const [perms] = await db.execute('SELECT permission_key, enabled FROM role_role_permissions WHERE role_id = ? AND permission_key IN ("admin_profile_warn","admin_profile_excuse")', [role[0].id]);
          perms.forEach(p => {
            if (!p.enabled) return;
            if (p.permission_key === 'admin_profile_warn') canWarn = true;
            if (p.permission_key === 'admin_profile_excuse') canExcuse = true;
          });
        }
      } catch(e) {}
    }

    res.render('admin/profile', {
      title: 'بروفايل ' + user.username,
      user, stats: {
        tickets: ticketCount[0]?.c || 0, applications: appCount[0]?.c || 0,
        orders: orderCount[0]?.c || 0, todayActions: todayCount[0]?.c || 0,
        weekActions: weekCount[0]?.c || 0, avgRating: '—'
      },
      chartData, warnings, excuses, allLogs, tickets, applications, orders, staff,
      canWarn, canExcuse, currentPath: req.path
    });
  } catch(err) {
    console.error('[Admin/Profile/:userId]', err);
    res.status(500).send(`<pre>Profile Error: ${err.message}\n\n${err.stack}</pre>`);
  }
});

// Roles
router.get('/roles', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const [roles] = await db.execute('SELECT * FROM roles ORDER BY is_admin_role DESC, sort_order ASC, id ASC');
    if (!roles.length) {
      console.error('[Admin/Roles] WARNING: roles table returned 0 rows!');
    }
    const [perms] = await db.execute('SELECT * FROM role_permissions');
    const permissions = {};
    perms.forEach(p => {
      if (!permissions[p.role_id]) permissions[p.role_id] = {};
      permissions[p.role_id][p.page] = { can_access: p.can_access, can_edit: p.can_edit, can_delete: p.can_delete, can_manage: p.can_manage };
    });

    // Page permissions (advanced)
    let pagePerms = {};
    try {
      const [pp] = await db.execute('SELECT * FROM role_page_permissions');
      pp.forEach(p => {
        if (!pagePerms[p.role_id]) pagePerms[p.role_id] = {};
        pagePerms[p.role_id][p.page] = { can_view: p.can_view, can_create: p.can_create, can_edit: p.can_edit, can_delete: p.can_delete, can_manage: p.can_manage, can_export: p.can_export, can_broadcast: p.can_broadcast };
      });
    } catch(e) {}

    // Element permissions
    let elemPerms = {};
    try {
      const [ep] = await db.execute('SELECT * FROM role_element_permissions');
      ep.forEach(p => {
        if (!elemPerms[p.role_id]) elemPerms[p.role_id] = {};
        elemPerms[p.role_id][p.page + ':' + p.element_id] = { can_view: p.can_view, can_use: p.can_use };
      });
    } catch(e) {}

    // Punishments
    let punishData = {};
    try {
      const [pd] = await db.execute('SELECT * FROM role_punishments');
      pd.forEach(p => {
        punishData[p.role_id] = { can_ban: p.can_ban, can_mute: p.can_mute, can_warn: p.can_warn, can_kick: p.can_kick, max_ban_level: p.max_ban_level };
      });
    } catch(e) {}

    // Unified permissions
    let unifiedPerms = {};
    try {
      const [up] = await db.execute('SELECT role_id, permission_key, enabled FROM role_role_permissions');
      up.forEach(p => {
        if (!unifiedPerms[p.role_id]) unifiedPerms[p.role_id] = {};
        unifiedPerms[p.role_id][p.permission_key] = p.enabled;
      });
    } catch(e) {}

    // Side roles
    let sideRoles = [];
    try {
      const [sr] = await db.execute('SELECT * FROM side_roles ORDER BY sort_order ASC');
      sideRoles = sr;
    } catch(e) {}

    // User side roles mapping
    let userSideRoles = {};
    try {
      const [usr] = await db.execute('SELECT user_id, side_role_id FROM user_side_roles');
      usr.forEach(r => {
        if (!userSideRoles[r.user_id]) userSideRoles[r.user_id] = [];
        userSideRoles[r.user_id].push(r.side_role_id);
      });
    } catch(e) {}

    // Import permissions config
    const { PERMISSION_GROUPS } = require('../config/permissions');

    // Page access data
    let pageAccess = {};
    try {
      const [pa] = await db.execute('SELECT role_id, page_path, can_access FROM role_page_access');
      pa.forEach(r => {
        if (!pageAccess[r.role_id]) pageAccess[r.role_id] = {};
        pageAccess[r.role_id][r.page_path] = r.can_access;
      });
    } catch(e) {}

    // Side role permissions
    let sideRolePerms = {};
    let sideRolePageAccess = {};
    try {
      const [srp] = await db.execute('SELECT side_role_id, permission_key, enabled FROM side_role_permissions');
      srp.forEach(r => {
        if (!sideRolePerms[r.side_role_id]) sideRolePerms[r.side_role_id] = {};
        sideRolePerms[r.side_role_id][r.permission_key] = r.enabled;
      });
    } catch(e) {}
    try {
      const [srpa] = await db.execute('SELECT side_role_id, page_path, can_access FROM side_role_page_access');
      srpa.forEach(r => {
        if (!sideRolePageAccess[r.side_role_id]) sideRolePageAccess[r.side_role_id] = {};
        sideRolePageAccess[r.side_role_id][r.page_path] = r.can_access;
      });
    } catch(e) {}

    // Member counts per role
    let roleMemberCounts = {};
    try {
      const [mc] = await db.execute('SELECT role, COUNT(*) as cnt FROM users GROUP BY role');
      mc.forEach(r => { roleMemberCounts[r.role] = r.cnt; });
    } catch(e) {}

    res.render('admin/roles', {
      title: 'إدارة الصلاحيات',
      roles, permissions, pagePerms, elemPerms, punishData,
      unifiedPerms, sideRoles, userSideRoles,
      PERMISSION_GROUPS, pageAccess, sideRolePerms, sideRolePageAccess,
      roleMemberCounts,
      currentPath: req.path
    });
  } catch(err) {
    res.render('admin/roles', {
      title: 'إدارة الصلاحيات',
      roles: [], permissions: {}, pagePerms: {}, elemPerms: {}, punishData: {},
      unifiedPerms: {}, sideRoles: [], userSideRoles: {},
      PERMISSION_GROUPS: {}, pageAccess: {}, sideRolePerms: {}, sideRolePageAccess: {},
      roleMemberCounts: {},
      currentPath: req.path
    });
  }
});

// Rules Management
router.get('/rules', checkPermission('rules_view'), async (req, res) => {
  try {
    const [rules] = await db.execute('SELECT * FROM rules ORDER BY sort_order ASC, id ASC');
    const [categories] = await db.execute('SELECT * FROM rule_categories ORDER BY sort_order ASC, id ASC');
    res.render('admin/rules', { title: 'إدارة القوانين', rules, categories, currentPath: req.path });
  } catch(err) {
    res.render('admin/rules', { title: 'إدارة القوانين', rules: [], categories: [], currentPath: req.path });
  }
});

// Discounts Management
router.get('/discounts', checkPermission('discounts_manage'), async (req, res) => {
  try {
    const [discounts] = await db.execute('SELECT * FROM discount_codes ORDER BY id DESC');
    res.render('admin/discounts', { title: 'أكواد الخصم', discounts, currentPath: req.path });
  } catch(err) {
    res.render('admin/discounts', { title: 'أكواد الخصم', discounts: [], currentPath: req.path });
  }
});

// Banned Users
router.get('/banned', checkPermission('users_ban'), async (req, res) => {
  try {
    const [banned] = await db.execute(`
      SELECT u.*, 
        banner.username AS banned_by_name,
        CASE WHEN u.banned_until IS NOT NULL AND u.banned_until > NOW() THEN 'مؤقت' ELSE 'دائم' END AS ban_type
      FROM users u 
      LEFT JOIN users banner ON u.banned_by = banner.id 
      WHERE u.is_banned = 1 
      ORDER BY u.banned_at DESC
    `);
    res.render('admin/banned', { title: 'المحظورين', banned, currentPath: req.path });
  } catch(err) {
    res.render('admin/banned', { title: 'المحظورين', banned: [], currentPath: req.path });
  }
});

// Broadcast
router.get('/broadcast', checkPermission('broadcast_send'), async (req, res) => {
  res.render('admin/broadcast', { title: 'البث', currentPath: req.path });
});

// Properties Management
router.get('/properties', checkPermission('properties_view'), async (req, res) => {
  try {
    const [properties] = await db.execute('SELECT * FROM properties ORDER BY sort_order ASC, id ASC');
    res.render('admin/properties', { title: 'إدارة الممتلكات', properties, currentPath: req.path });
  } catch(err) {
    res.render('admin/properties', { title: 'إدارة الممتلكات', properties: [], currentPath: req.path });
  }
});

// Company Management
router.get('/company', checkPermission('company_view'), async (req, res) => {
  try {
    const [items] = await db.execute('SELECT * FROM company_items ORDER BY sort_order ASC');
    const [questions] = await db.execute('SELECT * FROM service_questions ORDER BY sort_order ASC');
    const [packages] = await db.execute('SELECT * FROM service_packages ORDER BY sort_order ASC');
    const [requests] = await db.execute('SELECT sr.*, u.username, ci.title as service_title FROM service_requests sr LEFT JOIN users u ON sr.user_id = u.id LEFT JOIN company_items ci ON sr.service_id = ci.id ORDER BY sr.id DESC');
    res.render('admin/company', { title: 'إدارة الشركة', items, questions, packages, requests, currentPath: req.path });
  } catch(err) {
    res.render('admin/company', { title: 'إدارة الشركة', items: [], questions: [], packages: [], requests: [], currentPath: req.path });
  }
});

// Logs
router.get('/logs', checkPermission('logs_view'), async (req, res) => {
  const cat = String(req.query.cat || 'admin');
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 30;
  const offset = (page - 1) * limit;

  const validCats = ['admin', 'bot', 'products', 'games', 'activity'];
  const useCat = validCats.includes(cat) ? cat : 'admin';

  let logs = [];
  let total = 0;

  try {
    if (useCat === 'admin') {
      const [c] = await db.query('SELECT COUNT(*) as c FROM admin_logs');
      total = c[0].c;
      const [r] = await db.query('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT ' + limit + ' OFFSET ' + offset);
      logs = r;
    }
  } catch(e) { console.error('logs/admin:', e.message); }

  try {
    if (useCat === 'bot') {
      const [c] = await db.query('SELECT COUNT(*) as c FROM bot_logs');
      total = c[0].c;
      const [r] = await db.query('SELECT * FROM bot_logs ORDER BY created_at DESC LIMIT ' + limit + ' OFFSET ' + offset);
      logs = r;
    }
  } catch(e) { console.error('logs/bot:', e.message); }

  try {
    if (useCat === 'products') {
      const [c] = await db.query('SELECT COUNT(*) as c FROM product_logs');
      total = c[0].c;
      const [r] = await db.query('SELECT * FROM product_logs ORDER BY created_at DESC LIMIT ' + limit + ' OFFSET ' + offset);
      logs = r;
    }
  } catch(e) { console.error('logs/products:', e.message); }

  try {
    if (useCat === 'games') {
      const [c] = await db.query('SELECT COUNT(*) as c FROM game_reward_log');
      total = c[0].c;
      const [r] = await db.query('SELECT * FROM game_reward_log ORDER BY rewarded_at DESC LIMIT ' + limit + ' OFFSET ' + offset);
      logs = r;
    }
  } catch(e) { console.error('logs/games:', e.message); }

  try {
    if (useCat === 'activity') {
      const [c] = await db.query('SELECT COUNT(*) as c FROM user_activity_log');
      total = c[0].c;
      const [r] = await db.query('SELECT * FROM user_activity_log ORDER BY created_at DESC LIMIT ' + limit + ' OFFSET ' + offset);
      logs = r;
    }
  } catch(e) { console.error('logs/activity:', e.message); }

  const totalPages = Math.ceil(total / limit) || 1;

  try {
    console.log('[LOGS] Rendering with:', { cat: useCat, total, page, totalPages, logsCount: logs.length });
    res.render('admin/logs', {
      title: 'السجلات',
      logs: logs || [],
      cat: useCat,
      total: total || 0,
      page: page,
      totalPages: totalPages,
      currentPath: req.path
    }, function(err, html) {
      if (err) {
        console.error('[LOGS] Render error:', err.message);
        console.error('[LOGS] Render stack:', err.stack);
        return res.status(500).send('Render failed: ' + err.message);
      }
      res.send(html);
    });
  } catch(e) {
    console.error('[LOGS] Sync error:', e.message);
    res.status(500).send('Sync error: ' + e.message);
  }
});

module.exports = router;
