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

const app = express();

app.set('trust proxy', 1);

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

// TEMPORARY: SQL Import endpoint
app.get('/import-sql', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>SQL Import</title><style>body{font-family:Arial;background:#111;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}form{background:#222;padding:40px;border-radius:16px;text-align:center}input[type=file]{margin:20px 0}button{background:#780ecf;color:#fff;border:none;padding:12px 30px;border-radius:8px;font-size:16px;cursor:pointer}pre{margin-top:20px;text-align:left;max-height:400px;overflow:auto;background:#000;padding:10px;border-radius:8px;font-size:12px}</style></head><body><form method="POST" action="/import-sql" enctype="multipart/form-data"><h2>SQL Import</h2><input type="file" name="sqlfile" accept=".sql"><br><button type="submit">Import</button></form></body></html>`);
});

app.post('/import-sql', async (req, res) => {
  try {
    if (!req.files || !req.files.sqlfile) return res.status(400).send('No file');
    const sqlContent = req.files.sqlfile.data.toString('utf8');
    const statements = sqlContent.split(';').filter(s => s.trim().length > 10);
    const results = [];
    for (const stmt of statements) {
      try {
        await db.query(stmt);
        const match = stmt.match(/INSERT INTO `?(\w+)`?/i) || stmt.match(/CREATE TABLE.*`?(\w+)`?/i);
        results.push('✅ ' + (match ? match[1] : 'ok'));
      } catch (e) {
        results.push('❌ ' + e.message.substring(0, 80));
      }
    }
    res.send('<html><body style="font-family:monospace;background:#111;color:#fff;padding:20px"><pre>' + results.join('\n') + '</pre></body></html>');
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
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
  try {
    res.status(statusCode).render('pages/error', {
      title: statusCode === 404 ? 'الصفحة غير موجودة' : 'خطأ في الخادم',
      error: statusCode === 404 ? 'الصفحة التي تبحث عنها غير موجودة' : 'حدث خطأ غير متوقع، يرجى المحاولة لاحقاً'
    });
  } catch(e) {
    res.status(500).send('خطأ في الخادم');
  }
});

module.exports = app;
