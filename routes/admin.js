const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAdmin, checkPermission } = require('../middleware/auth');

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

    res.render('admin/dashboard', { title: 'لوحة التحكم', stats, recentActivity, recentUsers, currentPath: req.path });
  } catch(err) {
    res.render('admin/dashboard', { title: 'لوحة التحكم', stats: {}, recentActivity: [], recentUsers: [], currentPath: req.path });
  }
});

// Users Management
router.get('/users', checkPermission('users_view'), async (req, res) => {
  try {
    const [users] = await db.execute("SELECT * FROM users ORDER BY FIELD(role, 'owner','developer','founder','vice_founder','chairman','present_member','vice_president','leadership','family_member','admin','moderator','support','member','trial','user') ASC, id DESC");
    res.render('admin/users', { title: 'إدارة المستخدمين', users, currentPath: req.path });
  } catch(err) {
    res.render('admin/users', { title: 'إدارة المستخدمين', users: [], currentPath: req.path });
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
    res.render('admin/settings', { title: 'الإعدادات', settings, currentPath: req.path });
  } catch(err) {
    res.render('admin/settings', { title: 'الإعدادات', settings: {}, currentPath: req.path });
  }
});

// Roles
router.get('/roles', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const [roles] = await db.execute('SELECT * FROM roles ORDER BY is_admin_role DESC, sort_order ASC, id ASC');
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

    res.render('admin/roles', {
      title: 'إدارة الصلاحيات',
      roles, permissions, pagePerms, elemPerms, punishData,
      unifiedPerms, sideRoles, userSideRoles,
      PERMISSION_GROUPS, pageAccess,
      currentPath: req.path
    });
  } catch(err) {
    res.render('admin/roles', {
      title: 'إدارة الصلاحيات',
      roles: [], permissions: {}, pagePerms: {}, elemPerms: {}, punishData: {},
      unifiedPerms: {}, sideRoles: [], userSideRoles: {},
      PERMISSION_GROUPS: {}, pageAccess: {},
      currentPath: req.path
    });
  }
});

// Rules Management
router.get('/rules', checkPermission('rules_view'), async (req, res) => {
  try {
    const [rules] = await db.execute('SELECT * FROM rules ORDER BY sort_order ASC, id ASC');
    res.render('admin/rules', { title: 'إدارة القوانين', rules, currentPath: req.path });
  } catch(err) {
    res.render('admin/rules', { title: 'إدارة القوانين', rules: [], currentPath: req.path });
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
    const [banned] = await db.execute('SELECT * FROM users WHERE is_banned = 1 ORDER BY id DESC');
    res.render('admin/banned', { title: 'المحظورين', banned, currentPath: req.path });
  } catch(err) {
    res.render('admin/banned', { title: 'المحظورين', banned: [], currentPath: req.path });
  }
});

// Broadcast
router.get('/broadcast', checkPermission('broadcast_send'), async (req, res) => {
  res.render('admin/broadcast', { title: 'البث', currentPath: req.path });
});

// About Content
router.get('/about', checkPermission('about_view'), async (req, res) => {
  try {
    const about = {};
    const [rows] = await db.execute('SELECT content_key, content_value FROM about_us_content');
    rows.forEach(r => { about[r.content_key] = r.content_value; });
    res.render('admin/about', { title: 'صفحة من نحن', about, currentPath: req.path });
  } catch(err) {
    res.render('admin/about', { title: 'صفحة من نحن', about: {}, currentPath: req.path });
  }
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
