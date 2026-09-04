const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAdmin } = require('../middleware/auth');

// Admin Dashboard
router.get('/', isAdmin, async (req, res) => {
  try {
    const stats = {};
    try { const [r] = await db.execute('SELECT COUNT(*) as c FROM users'); stats.users = r[0].c; } catch(e) {}
    try { const [r] = await db.execute('SELECT COUNT(*) as c FROM fs_products'); stats.products = r[0].c; } catch(e) {}
    try { const [r] = await db.execute('SELECT COUNT(*) as c FROM orders'); stats.orders = r[0].c; } catch(e) {}
    try { const [r] = await db.execute("SELECT COUNT(*) as c FROM support_tickets WHERE status='open'"); stats.openTickets = r[0].c; } catch(e) {}
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

// Applications
router.get('/applications', isAdmin, async (req, res) => {
  try {
    const [applications] = await db.execute('SELECT * FROM submitted_applications ORDER BY id DESC');
    res.render('admin/applications', { title: 'إدارة الطلبات', applications, currentPath: req.path });
  } catch(err) {
    res.render('admin/applications', { title: 'إدارة الطلبات', applications: [], currentPath: req.path });
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
    let rolesConfig = {};
    const [rows] = await db.execute("SELECT setting_value FROM site_settings WHERE setting_key = 'custom_roles'");
    if (rows.length > 0) rolesConfig = JSON.parse(rows[0].setting_value || '{}');
    res.render('admin/roles', { title: 'الرتب', roles: rolesConfig, currentPath: req.path });
  } catch(err) {
    res.render('admin/roles', { title: 'الرتب', roles: {}, currentPath: req.path });
  }
});

// Logs
router.get('/logs', isAdmin, async (req, res) => {
  try {
    const [logs] = await db.execute('SELECT * FROM admin_logs ORDER BY id DESC LIMIT 100');
    res.render('admin/logs', { title: 'السجلات', logs, currentPath: req.path });
  } catch(err) {
    res.render('admin/logs', { title: 'السجلات', logs: [], currentPath: req.path });
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
  try {
    const cat = req.query.cat || 'admin';
    const page = parseInt(req.query.page) || 1;
    const limit = 30;
    const offset = (page - 1) * limit;

    let logs = [];
    let total = 0;

    if (cat === 'admin') {
      const [countR] = await db.execute('SELECT COUNT(*) as c FROM admin_logs');
      total = countR[0].c;
      const [rows] = await db.execute('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
      logs = rows;
    } else if (cat === 'bot') {
      const [countR] = await db.execute('SELECT COUNT(*) as c FROM bot_logs');
      total = countR[0].c;
      const [rows] = await db.execute('SELECT * FROM bot_logs ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
      logs = rows;
    } else if (cat === 'products') {
      const [countR] = await db.execute('SELECT COUNT(*) as c FROM product_logs');
      total = countR[0].c;
      const [rows] = await db.execute('SELECT * FROM product_logs ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
      logs = rows;
    } else if (cat === 'games') {
      const [countR] = await db.execute('SELECT COUNT(*) as c FROM game_reward_log');
      total = countR[0].c;
      const [rows] = await db.execute('SELECT * FROM game_reward_log ORDER BY rewarded_at DESC LIMIT ? OFFSET ?', [limit, offset]);
      logs = rows;
    } else if (cat === 'activity') {
      const [countR] = await db.execute('SELECT COUNT(*) as c FROM user_activity_log');
      total = countR[0].c;
      const [rows] = await db.execute('SELECT * FROM user_activity_log ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
      logs = rows;
    }

    const totalPages = Math.ceil(total / limit);

    res.render('admin/logs', {
      title: 'السجلات',
      logs, cat, total, page, totalPages,
      currentPath: req.path
    });
  } catch(err) {
    res.render('admin/logs', {
      title: 'السجلات',
      logs: [], cat: 'admin', total: 0, page: 1, totalPages: 0,
      currentPath: req.path
    });
  }
});

module.exports = router;
