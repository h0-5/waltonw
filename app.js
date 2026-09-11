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
const { securityHeaders, sanitizeInput, maintenanceMode, lockdownMode } = require('./middleware/security');

app.set('trust proxy', 1);

// Security middleware
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: process.env.SITE_URL || 'http://localhost:3000', credentials: true }));

// Response compression (gzip) — level 4 = same bandwidth saving, noticeably
// less CPU per response than 6 (Railway bills CPU)
const compression = require('compression');
app.use(compression({ level: 4, threshold: 1024 }));

// EJS template compilation cache — avoids re-compiling views on every request
app.set('view cache', true);

// Security guard: attack-tool blocking, bot policy, flood auto-block (before static = cheapest kill)
const { guard } = require('./middleware/guard');
app.use(guard);
app.use(securityHeaders);
app.use(sanitizeInput);

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

// Static files — long cache for images/fonts, 1 day for css/js
app.use('/images', express.static(path.join(__dirname, 'public/images'), { maxAge: '7d' }));
app.use('/fonts', express.static(path.join(__dirname, 'public/fonts'), { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// Visit analytics (daily page views + unique visitors) — skips /admin /api assets bots
const { trackVisit } = require('./middleware/analytics');
app.use(trackVisit);

// Global settings cache (refreshes every 5 min)
let globalSettings = {};
let settingsLastFetch = 0;
const SETTINGS_CACHE_TTL = 5 * 60 * 1000;

function invalidateSettingsCache() {
  settingsLastFetch = 0;
  globalSettings = {};
}

async function loadSettings() {
  try {
    const now = Date.now();
    if (now - settingsLastFetch < SETTINGS_CACHE_TTL && Object.keys(globalSettings).length > 0) {
      return globalSettings;
    }
    const [rows] = await db.execute('SELECT setting_key, setting_value FROM site_settings');
    rows.forEach(r => { globalSettings[r.setting_key] = r.setting_value; });
    // ترحيل الخلفيات: نسخ PNG الثقيلة (2MB+) استبدلت بنظائر JPEG مضغوطة —
    // أي قيمة قديمة مخزنة تُحوَّل هنا في الذاكرة (بدون كتابة DB) فكل الصفحات تستخدم الملف الخفيف
    const BG_MIGRATE = {
      '/images/site-bg.png': '/images/site-bg.jpg',
      '/images/site-mobile-bg.png': '/images/site-mobile-bg.jpg',
      '/images/admin-mobile-bg.png': '/images/admin-mobile-bg.jpg'
    };
    for (const k in globalSettings) {
      if (BG_MIGRATE[globalSettings[k]]) globalSettings[k] = BG_MIGRATE[globalSettings[k]];
    }
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
  var _accent = settings.accent_color || settings.site_accent_color || process.env.SITE_ACCENT_COLOR || '#bc13fe';
  if (String(_accent).toLowerCase() === '#780ecf') _accent = '#bc13fe'; // ترحيل الثيم القديم للرسمي
  res.locals.accentColor = _accent;
  /* ثيم الموقع الأساسي البنفسجي مرجعه main.css/design-system.css — قيم الإعدادات تُمرَّر فقط
     عند تخصيص فعلي من لوحة الإعدادات. قيم اليوم الأول (#06040a/#0c0816/#ffffff/#1a1525) كانت
     افتراضيات خاطئة سُجلت site-wide وألغت بنفسجية الثيم — تُعامل كغير مضروبة حتى تُشفى أي قيم محفوظة سابقاً */
  var _leg = { bg_color: '#06040a', card_color: '#0c0816', text_color: '#ffffff', border_color: '#1a1525' };
  res.locals.bgColor = (settings.bg_color && settings.bg_color !== _leg.bg_color) ? settings.bg_color : '';
  res.locals.textColor = (settings.text_color && settings.text_color !== _leg.text_color) ? settings.text_color : '';
  res.locals.cardColor = (settings.card_color && settings.card_color !== _leg.card_color) ? settings.card_color : '';
  res.locals.borderColor = (settings.border_color && settings.border_color !== _leg.border_color) ? settings.border_color : '';
  res.locals.currentPath = req.path;
  res.locals.settings = settings;
  res.locals.bgUrl = settings.site_bg_url || '';
  res.locals.mobileBgUrl = settings.site_mobile_bg_url || '';

  // Load user permissions & page access for navbar/sidebar filtering
  res.locals.userPermissions = {};
  res.locals.pageAccess = {};
  if (req.user) {
    try {
      if (req.user.role === 'owner') {
        // Owner gets all permissions + all pages
        const { getAllPermissionsFlat } = require('./config/permissions');
        const allPerms = {};
        const allPages = {};
        getAllPermissionsFlat().forEach(k => { allPerms[k] = 1; });
        ['/','/home','/rules','/applications','/store','/games','/community','/about',
         '/properties','/company','/profile','/cart','/contact','/checkout','/orders',
         '/my-discounts','/support',
         '/games/quiz','/games/snake','/games/memory','/games/tetris','/games/minesweeper',
         '/games/chess','/games/tic-tac-toe','/games/2048','/games/flappy-bird',
         '/games/sudoku','/games/pacman','/games/crossy-road','/games/rock-paper-scissors'
        ].forEach(p => { allPages[p] = 1; });
        res.locals.userPermissions = allPerms;
        res.locals.pageAccess = allPages;
      } else {
        // Cached per role (60s TTL) — was 3 DB queries on EVERY request
        const cached = rolePermCache.get(req.user.role);
        if (cached && (Date.now() - cached.at) < ROLE_PERM_TTL) {
          res.locals.userPermissions = cached.perms;
          res.locals.pageAccess = cached.pages;
        } else {
          const [role] = await db.execute('SELECT id, is_admin_role FROM roles WHERE name = ?', [req.user.role]);
          if (role.length) {
            if (role[0].is_admin_role) {
              // Admin roles get everything
              const { getAllPermissionsFlat } = require('./config/permissions');
              const allPerms = {};
              getAllPermissionsFlat().forEach(k => { allPerms[k] = 1; });
              res.locals.userPermissions = allPerms;
            } else {
              // Load permissions
              const [perms] = await db.execute(
                'SELECT permission_key FROM role_role_permissions WHERE role_id = ? AND enabled = 1',
                [role[0].id]
              );
              perms.forEach(p => { res.locals.userPermissions[p.permission_key] = 1; });
            }
            // Load page access (for all roles including admin — admin sidebar already handles this)
            const [pages] = await db.execute(
              'SELECT page_path, can_access FROM role_page_access WHERE role_id = ?',
              [role[0].id]
            );
            pages.forEach(p => { res.locals.pageAccess[p.page_path] = p.can_access ? 1 : 0; });
            rolePermCache.set(req.user.role, {
              perms: res.locals.userPermissions,
              pages: res.locals.pageAccess,
              at: Date.now()
            });
          }
        }
      }
    } catch(e) {}
  }
  next();
});

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Asset version stamping (cache-busting) ──
// Every boot gets a unique ?v= appended to /css/* and /js/* links inside
// rendered HTML. Without this, browsers kept CSS cached for up to a full day
// (static maxAge below) and users kept seeing the OLD design after every
// deploy — the reason fixes "never appeared" on phones.
const ASSET_VER = Date.now().toString(36);
const ASSET_CSS_RE = /(href=")(\/css\/[^"?]*\.css)(\?[^"?]*)?(\")/g;
const ASSET_JS_RE = /(src=")(\/js\/[^"?]*\.js)(\?[^"?]*)?(\")/g;
app.use((req, res, next) => {
  const origSend = res.send;
  res.send = function(body) {
    try {
      if (typeof body === 'string' && (body.indexOf('/css/') !== -1 || body.indexOf('/js/') !== -1)) {
        const ct = (typeof this.get === 'function' && this.get('Content-Type')) || '';
        // patch only HTML documents — never JSON/API payloads
        if (ct === '' || ct.indexOf('html') !== -1) {
          body = body
            .replace(ASSET_CSS_RE, '$1$2?v=' + ASSET_VER + '$4')
            .replace(ASSET_JS_RE, '$1$2?v=' + ASSET_VER + '$4');
        }
      }
    } catch (e) { /* never break a response over stamping */ }
    return origSend.call(this, body);
  };
  next();
});

// Role permission cache — cuts 3 DB queries per request for every logged-in
// user down to 3 per minute per role (permissions changes apply within 60s)
const rolePermCache = new Map(); // role name -> { perms, pages, at }
const ROLE_PERM_TTL = 60 * 1000;

// Routes
const indexRoutes = require('./routes/index');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const communityApi = require('./routes/api/community');
const storeApi = require('./routes/api/store');
const supportApi = require('./routes/api/support');
const profileApi = require('./routes/api/profile');
const gamesApi = require('./routes/api/games');
const applicationsApi = require('./routes/api/applications');
const adminApi = require('./routes/api/admin');
const botApi = require('./routes/api/bot');

app.use('/', indexRoutes);
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/api/community', communityApi);
app.use('/api/store', storeApi);
app.use('/api/support', supportApi);
app.use('/api/profile', profileApi);
app.use('/api/games', gamesApi);
app.use('/api/applications', applicationsApi);
app.use('/api/admin', adminApi);
app.use('/api/orders', adminApi);
app.use('/api/bot', botApi);
app.use('/api/notifications', adminApi);
app.use('/api/farm', require('./routes/api/farm').router);
app.use('/api/company', require('./routes/api/company'));

// Maintenance mode (after routes, before static)
app.use(maintenanceMode);

// Lockdown mode
app.use(lockdownMode);

// Ensure all view locals always exist (fallback for error/404 pages)
app.use((req, res, next) => {
  res.locals.user = res.locals.user || null;
  res.locals.siteName = res.locals.siteName || 'Walton Family';
  res.locals.accentColor = res.locals.accentColor || '#bc13fe';
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
  try {
    res.status(statusCode).render('pages/error', {
      title: statusCode === 404 ? 'الصفحة غير موجودة' : 'خطأ في الخادم',
      error: statusCode === 404 ? 'الصفحة التي تبحث عنها غير موجودة' : 'حدث خطأ غير متوقع، يرجى المحاولة لاحقاً'
    });
  } catch(e) {
    res.status(500).send('خطأ في الخادم');
  }
});

app.invalidateSettingsCache = invalidateSettingsCache;
module.exports = app;
