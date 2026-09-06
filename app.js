require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const passport = require('./config/auth');
const sessionConfig = require('./config/session');
const db = require('./config/database');

async function runMigrate() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      discord_id VARCHAR(50) UNIQUE,
      username VARCHAR(100),
      email VARCHAR(255),
      avatar TEXT,
      profile_picture TEXT,
      cover_photo TEXT,
      role VARCHAR(50) DEFAULT 'user',
      is_banned TINYINT(1) DEFAULT 0,
      ban_reason TEXT,
      is_muted TINYINT(1) DEFAULT 0,
      total_game_points INT DEFAULT 0,
      warn_count INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS sessions (
      session_id VARCHAR(128) PRIMARY KEY,
      expires INT UNSIGNED NOT NULL,
      data MEDIUMTEXT,
      INDEX sessions_expires(expires)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255),
      description TEXT,
      price DECIMAL(10,2),
      image TEXT,
      category VARCHAR(100),
      stock INT DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      product_id INT,
      quantity INT DEFAULT 1,
      total_price DECIMAL(10,2),
      status VARCHAR(50) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS news (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255),
      content TEXT,
      image TEXT,
      author_id INT,
      is_published TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS tickets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      subject VARCHAR(255),
      message TEXT,
      status VARCHAR(50) DEFAULT 'open',
      priority VARCHAR(20) DEFAULT 'medium',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS site_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(50) UNIQUE,
      level INT DEFAULT 0,
      color VARCHAR(20) DEFAULT '#ffffff',
      permissions TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS rules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category VARCHAR(100),
      title VARCHAR(255),
      content TEXT,
      sort_order INT DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS discounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) UNIQUE,
      percentage INT DEFAULT 0,
      max_uses INT DEFAULT 0,
      used_count INT DEFAULT 0,
      expires_at DATETIME,
      is_active TINYINT(1) DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS banned_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      reason TEXT,
      banned_by INT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS broadcasts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      message TEXT,
      type VARCHAR(50) DEFAULT 'info',
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS application_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      application_type VARCHAR(100) UNIQUE,
      description TEXT,
      is_active TINYINT(1) DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS application_questions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      application_type VARCHAR(100),
      question TEXT,
      question_type VARCHAR(50) DEFAULT 'text',
      is_required TINYINT(1) DEFAULT 1,
      sort_order INT DEFAULT 0,
      keyword VARCHAR(200)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS application_submissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      application_type VARCHAR(100),
      answers JSON,
      status VARCHAR(50) DEFAULT 'pending',
      reviewed_by INT,
      review_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS about_us_content (
      content_key VARCHAR(100) PRIMARY KEY,
      content_value TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS company_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255),
      description TEXT,
      image TEXT,
      video_url TEXT,
      category VARCHAR(100),
      sort_order INT DEFAULT 0,
      service_status VARCHAR(20) DEFAULT 'active'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS properties (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255),
      description TEXT,
      image TEXT,
      details JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS user_sessions (
      id VARCHAR(128) PRIMARY KEY,
      expires INT UNSIGNED NOT NULL,
      data MEDIUMTEXT,
      INDEX sessions_expires(expires)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];

  try {
    for (const sql of tables) {
      const name = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
      await db.execute(sql);
      console.log(`✅ Table: ${name}`);
    }
    console.log('✅ All tables ready');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
  }
}

const app = express();

// Security middleware
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: process.env.SITE_URL || 'http://localhost:3000', credentials: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 60,
  message: 'Too many requests, please try again later.'
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const fileUpload = require('express-fileupload');
app.use(fileUpload({ limits: { fileSize: 5 * 1024 * 1024 } }));

// Session
app.use(session(sessionConfig));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Global settings cache (refreshes every 5 min)
let globalSettings = {};
let settingsLastFetch = 0;
const SETTINGS_CACHE_TTL = 5 * 60 * 1000;

async function loadSettings() {
  try {
    const now = Date.now();
    if (now - settingsLastFetch < SETTINGS_CACHE_TTL && Object.keys(globalSettings).length > 0) {
      return globalSettings;
    }
    const [rows] = await db.execute('SELECT setting_key, setting_value FROM site_settings');
    rows.forEach(r => { globalSettings[r.setting_key] = r.setting_value; });
    settingsLastFetch = now;
  } catch(e) {}
  return globalSettings;
}

// Global middleware - load settings from DB and attach to views
app.use(async (req, res, next) => {
  const settings = await loadSettings();
  req.db = db;
  req.settings = settings;
  res.locals.user = req.user || null;
  res.locals.siteName = settings.site_name || process.env.SITE_NAME || 'Walton Family';
  res.locals.siteUrl = settings.site_url || process.env.SITE_URL || 'http://localhost:3000';
  res.locals.accentColor = settings.site_accent_color || process.env.SITE_ACCENT_COLOR || '#780ecf';
  res.locals.currentPath = req.path;
  res.locals.settings = settings;
  res.locals.bgUrl = settings.site_bg_url || '';
  res.locals.mobileBgUrl = settings.site_mobile_bg_url || '';
  next();
});

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const communityApi = require('./routes/api/community');
const storeApi = require('./routes/api/store');
const supportApi = require('./routes/api/support');
const profileApi = require('./routes/api/profile');
const gamesApi = require('./routes/api/games');
const adminApi = require('./routes/api/admin');

app.use('/', indexRoutes);
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/api/community', communityApi);
app.use('/api/store', storeApi);
app.use('/api/support', supportApi);
app.use('/api/profile', profileApi);
app.use('/api/games', gamesApi);
app.use('/api/admin', adminApi);
app.use('/api/orders', adminApi);
app.use('/api/notifications', adminApi);

// Ensure all view locals always exist (fallback for error/404 pages)
app.use((req, res, next) => {
  res.locals.user = res.locals.user || null;
  res.locals.siteName = res.locals.siteName || 'Walton Family';
  res.locals.accentColor = res.locals.accentColor || '#780ecf';
  res.locals.currentPath = res.locals.currentPath || req.path;
  res.locals.settings = res.locals.settings || {};
  res.locals.bgUrl = res.locals.bgUrl || '';
  res.locals.mobileBgUrl = res.locals.mobileBgUrl || '';
  next();
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('pages/404', { title: '404 - الصفحة غير موجودة' });
});

// Error handler — never show code to users
app.use((err, req, res, next) => {
  console.error('[ERROR]', new Date().toISOString(), err.message);
  console.error(err.stack);
  const statusCode = err.status || 500;
  res.status(statusCode).render('pages/error', {
    title: statusCode === 404 ? 'الصفحة غير موجودة' : 'خطأ في الخادم',
    error: statusCode === 404 ? 'الصفحة التي تبحث عنها غير موجودة' : 'حدث خطأ غير متوقع، يرجى المحاولة لاحقاً'
  });
});

runMigrate().then(() => {
  console.log('🚀 Walton Family ready');
}).catch(err => {
  console.error('❌ Startup error:', err.message);
});

module.exports = app;
