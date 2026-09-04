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
const PORT = process.env.PORT || 3000;

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

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('pages/error', {
    title: 'خطأ في الخادم',
    error: process.env.NODE_ENV === 'development' ? err.message : 'حدث خطأ غير متوقع'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n  Walton Family Server running on http://localhost:${PORT}\n`);
});

module.exports = app;
