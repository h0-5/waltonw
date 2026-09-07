const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAdmin } = require('../middleware/auth');

// Admin Dashboard
router.get('/', isAdmin, async (req, res) => {
  try {
    const stats = {};
    try { const [r] = await db.execute('SELECT COUNT(*) as c FROM users'); stats.users = r[0].c; } catch(e) {}
    try { const [r] = await db.execute('SELECT COUNT(*) as c FROM products'); stats.products = r[0].c; } catch(e) {}
    try { const [r] = await db.execute('SELECT COUNT(*) as c FROM orders'); stats.orders = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT COUNT(*) as c FROM tickets WHERE status='open'"); stats.openTickets = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT COUNT(*) as c FROM users WHERE last_login > DATE_SUB(NOW(), INTERVAL 24 HOUR)"); stats.activeToday = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT COUNT(*) as c FROM orders WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)"); stats.newOrders = r[0].c; } catch(e) {}

    res.render('admin/dashboard', { title: 'لوحة التحكم', stats, currentPath: req.path });
  } catch(err) {
    res.render('admin/dashboard', { title: 'لوحة التحكم', stats: {}, currentPath: req.path });
  }
});

// Users Management
router.get('/users', isAdmin, async (req, res) => {
  try {
    const [users] = await db.execute("SELECT * FROM users ORDER BY FIELD(role, 'owner','developer','founder','vice_founder','chairman','present_member','vice_president','leadership','family_member','admin','moderator','support','member','trial','user') ASC, id DESC");
    res.render('admin/users', { title: 'إدارة المستخدمين', users, currentPath: req.path });
  } catch(err) {
    res.render('admin/users', { title: 'إدارة المستخدمين', users: [], currentPath: req.path });
  }
});

// Products Management
router.get('/products', isAdmin, async (req, res) => {
  try {
    const [products] = await db.execute('SELECT * FROM fs_products ORDER BY id DESC');
    res.render('admin/products', { title: 'إدارة المنتجات', products, currentPath: req.path });
  } catch(err) {
    res.render('admin/products', { title: 'إدارة المنتجات', products: [], currentPath: req.path });
  }
});

// Orders
router.get('/orders', isAdmin, async (req, res) => {
  try {
    const [orders] = await db.execute('SELECT o.*, u.username FROM orders o LEFT JOIN users u ON o.user_id = u.id ORDER BY o.id DESC');
    res.render('admin/orders', { title: 'إدارة الطلبات', orders, currentPath: req.path });
  } catch(err) {
    res.render('admin/orders', { title: 'إدارة الطلبات', orders: [], currentPath: req.path });
  }
});

// News
router.get('/news', isAdmin, async (req, res) => {
  try {
    const [news] = await db.execute('SELECT * FROM news ORDER BY id DESC');
    res.render('admin/news', { title: 'إدارة الأخبار', news, currentPath: req.path });
  } catch(err) {
    res.render('admin/news', { title: 'إدارة الأخبار', news: [], currentPath: req.path });
  }
});

// Tickets
router.get('/tickets', isAdmin, async (req, res) => {
  try {
    const [tickets] = await db.execute('SELECT t.*, u.username FROM support_tickets t LEFT JOIN users u ON t.user_id = u.id ORDER BY t.id DESC');
    res.render('admin/tickets', { title: 'إدارة التذاكر', tickets, currentPath: req.path });
  } catch(err) {
    res.render('admin/tickets', { title: 'إدارة التذاكر', tickets: [], currentPath: req.path });
  }
});

// Applications - Submissions View
router.get('/applications', isAdmin, async (req, res) => {
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
router.get('/manage-apps', isAdmin, async (req, res) => {
  try {
    const [types] = await db.query('SELECT * FROM application_settings ORDER BY id ASC');
    res.render('admin/manage-apps', { title: 'إدارة نظام التقديمات', types, currentPath: req.path });
  } catch(err) {
    console.error('Manage apps error:', err.message);
    res.render('admin/manage-apps', { title: 'إدارة نظام التقديمات', types: [], currentPath: req.path });
  }
});

// Settings
router.get('/settings', isAdmin, async (req, res) => {
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
router.get('/roles', isAdmin, async (req, res) => {
  try {
    const [roles] = await db.execute('SELECT * FROM roles ORDER BY level DESC, sort_order ASC');
    const [perms] = await db.execute('SELECT * FROM role_permissions');
    const permissions = {};
    perms.forEach(p => {
      if (!permissions[p.role_id]) permissions[p.role_id] = {};
      permissions[p.role_id][p.page] = { can_access: p.can_access, can_edit: p.can_edit, can_delete: p.can_delete, can_manage: p.can_manage };
    });
    res.render('admin/roles', { title: 'إدارة الصلاحيات', roles, permissions, currentPath: req.path });
  } catch(err) {
    res.render('admin/roles', { title: 'إدارة الصلاحيات', roles: [], permissions: {}, currentPath: req.path });
  }
});

// Rules Management
router.get('/rules', isAdmin, async (req, res) => {
  try {
    const [rules] = await db.execute('SELECT * FROM rules ORDER BY sort_order ASC, id ASC');
    res.render('admin/rules', { title: 'إدارة القوانين', rules, currentPath: req.path });
  } catch(err) {
    res.render('admin/rules', { title: 'إدارة القوانين', rules: [], currentPath: req.path });
  }
});

// Discounts Management
router.get('/discounts', isAdmin, async (req, res) => {
  try {
    const [discounts] = await db.execute('SELECT * FROM discount_codes ORDER BY id DESC');
    res.render('admin/discounts', { title: 'أكواد الخصم', discounts, currentPath: req.path });
  } catch(err) {
    res.render('admin/discounts', { title: 'أكواد الخصم', discounts: [], currentPath: req.path });
  }
});

// Banned Users
router.get('/banned', isAdmin, async (req, res) => {
  try {
    const [banned] = await db.execute('SELECT * FROM users WHERE is_banned = 1 ORDER BY id DESC');
    res.render('admin/banned', { title: 'المحظورين', banned, currentPath: req.path });
  } catch(err) {
    res.render('admin/banned', { title: 'المحظورين', banned: [], currentPath: req.path });
  }
});

// Broadcast
router.get('/broadcast', isAdmin, async (req, res) => {
  res.render('admin/broadcast', { title: 'البث', currentPath: req.path });
});

// About Content
router.get('/about', isAdmin, async (req, res) => {
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
router.get('/properties', isAdmin, async (req, res) => {
  try {
    const [properties] = await db.execute('SELECT * FROM properties ORDER BY sort_order ASC, id ASC');
    res.render('admin/properties', { title: 'إدارة الممتلكات', properties, currentPath: req.path });
  } catch(err) {
    res.render('admin/properties', { title: 'إدارة الممتلكات', properties: [], currentPath: req.path });
  }
});

// Company Management
router.get('/company', isAdmin, async (req, res) => {
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
router.get('/logs', isAdmin, async (req, res) => {
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
