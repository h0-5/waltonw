const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, isInGuild, checkPageAccess } = require('../middleware/auth');

// Helper to safely query
async function safeQuery(sql, params = []) {
  try {
    const [rows] = await db.execute(sql, params);
    return rows;
  } catch (e) {
    return [];
  }
}

// Get site settings
async function getSettings() {
  const rows = await safeQuery('SELECT setting_key, setting_value FROM site_settings');
  const settings = {};
  rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
  return settings;
}

// Home
router.get('/', isAuthenticated, isInGuild, checkPageAccess('/'), async (req, res) => {
  const settings = await getSettings();
  const news = await safeQuery('SELECT * FROM news WHERE is_hidden = 0 ORDER BY created_at DESC LIMIT 10');
  const memberCount = await safeQuery('SELECT COUNT(*) as c FROM users');
  const giveaways = await safeQuery("SELECT * FROM news WHERE type = 'giveaway' AND expires_at > NOW() AND is_hidden = 0");

  const stats = {
    members: settings.stat_members || (memberCount[0] ? memberCount[0].c : '50+'),
    staff: settings.stat_staff || '15+',
    support: settings.stat_support || '24/7'
  };

  /* معاينات خفيفة للوحة bento: LIMIT محدد، بلا JOIN — تفشل بأمان لقائمة فارغة */
  const storePreview = await safeQuery('SELECT id, name, price_points, price_money, category_type, description FROM fs_products ORDER BY id ASC LIMIT 2');
  const rulesPreview = await safeQuery('SELECT category, rule_text FROM rules ORDER BY sort_order ASC LIMIT 8');

  /* نقاطي ورتبتي (للمسجّل فقط) — استعلامان صغيران بنمط صفحة البروفايل */
  let myStats = null;
  if (req.user) {
    const pts = await safeQuery('SELECT points, total_earned FROM bot_points WHERE discord_id = ? LIMIT 1', [req.user.discord_id]);
    const myPoints = pts.length ? (pts[0].points || 0) : 0;
    const rk = await safeQuery('SELECT COUNT(*) + 1 AS pos FROM bot_points WHERE points > ?', [myPoints]);
    myStats = {
      points: myPoints,
      total_earned: pts.length ? (pts[0].total_earned || 0) : 0,
      rank: rk.length ? rk[0].pos : 1
    };
  }

  res.render('pages/home', {
    title: settings.site_name || 'الرئيسية',
    news, stats, activeGiveaways: giveaways, settings, storePreview, rulesPreview, myStats
  });
});

// About
router.get('/about', isAuthenticated, isInGuild, checkPageAccess('/about'), async (req, res) => {
  const settings = await getSettings();
  const aboutRows = await safeQuery('SELECT content_key, content_value FROM about_us_content');
  const about = {};
  aboutRows.forEach(r => { about[r.content_key] = r.content_value; });

  let members = [];
  try {
    if (about.members) {
      const memberNames = about.members.split(',').map(m => m.trim());
      const memberIds = about.member_ids ? about.member_ids.split(',').map(id => id.trim()) : [];
      const memberAvatars = about.member_avatars ? JSON.parse(about.member_avatars) : {};
      
      members = memberNames.map((name, i) => ({
        name,
        id: memberIds[i] || '',
        avatar: memberAvatars[name] || '/images/default-avatar.png'
      }));
    }
  } catch(e) {}

  let story = [];
  try {
    if (about.story) {
      const parsed = JSON.parse(about.story);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const fullText = parsed.map(p => p.text).join(' ');
        // Split by sentences into ~4-6 chunks
        const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
        const chunkSize = Math.max(1, Math.ceil(sentences.length / 5));
        const chunks = [];
        for (let i = 0; i < sentences.length; i += chunkSize) {
          const chunk = sentences.slice(i, i + chunkSize).join(' ').trim();
          if (chunk) chunks.push({ text: chunk, icon: 'none' });
        }
        story = chunks.length > 0 ? chunks : parsed;
      } else {
        story = parsed;
      }
    }
  } catch(e) {
    // If story is plain text, split it
    if (about.story) {
      const sentences = about.story.match(/[^.!?]+[.!?]+/g) || [about.story];
      const chunkSize = Math.max(1, Math.ceil(sentences.length / 5));
      for (let i = 0; i < sentences.length; i += chunkSize) {
        const chunk = sentences.slice(i, i + chunkSize).join(' ').trim();
        if (chunk) story.push({ text: chunk, icon: 'none' });
      }
    }
  }

  // Enrich members with Discord avatars
  let enrichedMembers = [];
  try {
    if (about.members) {
      const memberNames = about.members.split(',').map(m => m.trim());
      const memberDiscords = about.member_discords ? JSON.parse(about.member_discords) : {};
      const memberAvatars = about.member_avatars ? JSON.parse(about.member_avatars) : {};
      const memberDiscordIds = about.member_discord_ids ? JSON.parse(about.member_discord_ids) : {};
      
      enrichedMembers = memberNames.map(name => ({
        name,
        role: 'Founder',
        role_color: '#f97316',
        avatar: memberAvatars[name] || '',
        discord_user: memberDiscords[name] || '',
        discord_id: memberDiscordIds[name] || ''
      }));
    }
  } catch(e) {}

  res.render('pages/about', {
    title: about.title || 'من نحن',
    about, members: enrichedMembers, paragraphs: story, settings
  });
});

// Rules
router.get('/rules', isAuthenticated, isInGuild, checkPageAccess('/rules'), async (req, res) => {
  const settings = await getSettings();
  const rules = await safeQuery('SELECT * FROM rules ORDER BY sort_order ASC');
  const categories = await safeQuery('SELECT * FROM rule_categories ORDER BY sort_order ASC');
  res.render('pages/rules', { title: 'القواعد', rules, categories, settings });
});

// Store
router.get('/store', isAuthenticated, isInGuild, checkPageAccess('/store'), async (req, res) => {
  const settings = await getSettings();
  let products = await safeQuery('SELECT * FROM fs_products ORDER BY id ASC');
  
  // Get user points if logged in
  let userPoints = 0;
  if (req.user && req.user.discord_id) {
    const pts = await safeQuery('SELECT points FROM bot_points WHERE discord_id = ?', [req.user.discord_id]);
    userPoints = pts.length > 0 ? pts[0].points : 0;
  }

  res.render('pages/store', {
    title: 'المتجر',
    products, userPoints, settings
  });
});

// Games
router.get('/games', isAuthenticated, isInGuild, checkPageAccess('/games'), async (req, res) => {
  const settings = await getSettings();
  res.render('pages/games', { title: 'الألعاب', settings });
});

// Community
router.get('/community', isAuthenticated, isInGuild, checkPageAccess('/community'), async (req, res) => {
  const settings = await getSettings();
  res.render('pages/community', { title: 'المجتمع', settings });
});

// Applications
router.get('/applications', isAuthenticated, isInGuild, checkPageAccess('/applications'), async (req, res) => {
  const settings = await getSettings();
  const applications = await safeQuery('SELECT * FROM application_settings ORDER BY id ASC');
  res.render('pages/applications', { title: 'الطلبات', applications, settings });
});

// Application form
router.get('/applications/form/:type', isAuthenticated, isInGuild, checkPageAccess('/applications'), async (req, res) => {
  const settings = await getSettings();
  const type = decodeURIComponent(req.params.type);

  const [appSettings] = await db.execute('SELECT * FROM application_settings WHERE application_type = ?', [type]);
  if (!appSettings.length) {
    return res.status(404).render('pages/404', { title: '404 - الصفحة غير موجودة', settings });
  }
  const appSetting = appSettings[0];

  const [qRows] = await db.execute(
    'SELECT id, question, type, required, options, max_selections, keyword, sort_order FROM application_questions WHERE application_type = ? ORDER BY sort_order ASC, id ASC',
    [type]
  );
  const questions = qRows.map(q => q);

  let pending = [];
  try {
    pending = await db.execute(
      "SELECT id FROM submitted_applications WHERE user_id = ? AND application_type = ? AND status = 'pending'",
      [req.user.id, type]
    );
    pending = pending[0];
  } catch (e) {}

  let inCooldown = false;
  let cooldownUntil = null;
  const rejected = await safeQuery(
    'SELECT cooldown_until, created_at FROM submitted_applications WHERE user_id = ? AND application_type = ? AND status = "rejected" ORDER BY id DESC LIMIT 1',
    [req.user.id, type]
  );
  if (rejected.length) {
    if (rejected[0].cooldown_until && new Date(rejected[0].cooldown_until) > new Date()) {
      inCooldown = true;
      cooldownUntil = new Date(rejected[0].cooldown_until);
    } else if (!rejected[0].cooldown_until && appSetting.rejection_cooldown_hours > 0 && rejected[0].created_at) {
      const cd = new Date(rejected[0].created_at);
      cd.setHours(cd.getHours() + Number(appSetting.rejection_cooldown_hours));
      if (cd > new Date()) {
        inCooldown = true;
        cooldownUntil = cd;
      }
    }
  }

  const discordError = !req.user.discord_id;
  const hasBlacklistRole = !!req.user.is_banned;
  const hasRequiredRole = true;

  const userSubmitted = await safeQuery(
    'SELECT id, status, created_at FROM submitted_applications WHERE user_id = ? AND application_type = ? ORDER BY id DESC LIMIT 10',
    [req.user.id, type]
  );

  res.render('pages/application-form', {
    title: appSetting.title || 'تقديم طلب',
    appSetting, questions, settings,
    inCooldown, cooldownUntil,
    pendingApp: pending.length > 0,
    discordError, hasBlacklistRole, hasRequiredRole,
    userSubmitted
  });
});

// Support
router.get('/support', isAuthenticated, isInGuild, checkPageAccess('/support'), async (req, res) => {
  const settings = await getSettings();
  res.render('pages/support', { title: 'الدعم الفني', settings });
});

// Profile
router.get('/profile', isAuthenticated, isInGuild, checkPageAccess('/profile'), async (req, res) => {
  const settings = await getSettings();
  
  // Get user points
  let userPoints = 0;
  if (req.user.discord_id) {
    const pts = await safeQuery('SELECT points, total_earned FROM bot_points WHERE discord_id = ?', [req.user.discord_id]);
    userPoints = pts.length > 0 ? pts[0] : { points: 0, total_earned: 0 };
  }
  
  // Get user achievements
  const achievements = await safeQuery('SELECT * FROM user_achievements WHERE discord_id = ?', [req.user.discord_id]);
  
  // Get notifications count
  const notifCount = await safeQuery('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);

  res.render('pages/profile', {
    title: 'الملف الشخصي',
    userPoints, achievements, notifCount: notifCount[0] ? notifCount[0].c : 0,
    settings
  });
});

// Cart
router.get('/cart', isAuthenticated, isInGuild, checkPageAccess('/cart'), async (req, res) => {
  const settings = await getSettings();
  res.render('pages/cart', { title: 'سلة المشتريات', cartItems: [], total: 0, settings });
});

// Contact
router.get('/contact', isAuthenticated, isInGuild, checkPageAccess('/contact'), async (req, res) => {
  const settings = await getSettings();
  const discordUrl = settings.discord_server_url || 'https://discord.gg/rcj6FuekX6';
  res.render('pages/contact', { title: 'تواصل معنا', discordUrl, settings });
});

// Checkout
router.get('/checkout', isAuthenticated, isInGuild, checkPageAccess('/checkout'), async (req, res) => {
  const settings = await getSettings();
  res.render('pages/checkout', { title: 'إتمام الشراء', settings });
});

// Orders
router.get('/orders', isAuthenticated, isInGuild, checkPageAccess('/orders'), async (req, res) => {
  const settings = await getSettings();
  const orders = await safeQuery('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  res.render('pages/orders', { title: 'طلباتي', orders, settings });
});

// My Discounts
router.get('/my_discounts', isAuthenticated, isInGuild, checkPageAccess('/my_discounts'), async (req, res) => {
  const settings = await getSettings();
  let discounts = [];
  try {
    discounts = await safeQuery(
      'SELECT * FROM discount_codes WHERE (expires_at IS NULL OR expires_at > NOW()) ORDER BY id ASC'
    );
  } catch(e) {}
  res.render('pages/my_discounts', { title: 'خصوماتي', discounts, settings });
});

// Game Pages
router.get('/games/mafia', isAuthenticated, isInGuild, checkPageAccess('/games/mafia'), async (req, res) => { const s = await getSettings(); res.render('games/mafia', { title: 'مافيا', settings: s }); });
router.get('/games/rps', isAuthenticated, isInGuild, checkPageAccess('/games/rps'), async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'حجر ورقة مقص', settings: s }); });
router.get('/games/memory', isAuthenticated, isInGuild, checkPageAccess('/games/memory'), async (req, res) => { const s = await getSettings(); res.render('games/memory', { title: 'الذاكرة', settings: s }); });
router.get('/games/spin_wheel', isAuthenticated, isInGuild, checkPageAccess('/games/spin_wheel'), async (req, res) => { const s = await getSettings(); res.render('games/spin_wheel', { title: 'عجلة الحظ', settings: s }); });
router.get('/games/impostor', isAuthenticated, isInGuild, checkPageAccess('/games/impostor'), async (req, res) => { const s = await getSettings(); res.render('games/mafia', { title: 'Impostor', settings: s }); });
router.get('/games/trivia', isAuthenticated, isInGuild, checkPageAccess('/games/trivia'), async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'Trivia', settings: s }); });
router.get('/games/uno', isAuthenticated, isInGuild, checkPageAccess('/games/uno'), async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'UNO', settings: s }); });
router.get('/games/math_race', isAuthenticated, isInGuild, checkPageAccess('/games/math_race'), async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'سباق الحساب', settings: s }); });
router.get('/games/word_scramble', isAuthenticated, isInGuild, checkPageAccess('/games/word_scramble'), async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'ترتيب الحروف', settings: s }); });
router.get('/games/quick_quiz', isAuthenticated, isInGuild, checkPageAccess('/games/quick_quiz'), async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'kwiz سريع', settings: s }); });
router.get('/games/find_link', isAuthenticated, isInGuild, checkPageAccess('/games/find_link'), async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'ابحث عن الرابط', settings: s }); });
router.get('/games/crossword', isAuthenticated, isInGuild, checkPageAccess('/games/crossword'), async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'أحجية الكلمات', settings: s }); });
router.get('/games/aviator', isAuthenticated, isInGuild, checkPageAccess('/games/aviator'), async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'Aviator', settings: s }); });

// Properties
router.get('/properties', isAuthenticated, isInGuild, checkPageAccess('/properties'), async (req, res) => {
  const all = await safeQuery('SELECT * FROM properties ORDER BY sort_order ASC, id ASC');
  const palaces = all.filter(p => p.category === 'palaces');
  const vehicles = all.filter(p => p.category === 'vehicles');
  res.render('pages/properties', { title: 'الممتلكات', palaces, vehicles });
});

// Company
router.get('/company', isAuthenticated, isInGuild, checkPageAccess('/company'), async (req, res) => {
  const infoItems = await safeQuery("SELECT * FROM company_items WHERE category = 'info' ORDER BY sort_order ASC");
  const activityItems = await safeQuery("SELECT * FROM company_items WHERE category = 'activities' ORDER BY sort_order ASC");
  
  const servicesQuestions = {};
  const servicesPackages = {};
  for (const item of activityItems) {
    if (item.service_status) {
      servicesQuestions[item.id] = await safeQuery("SELECT * FROM service_questions WHERE service_id = ? ORDER BY sort_order ASC", [item.id]);
      servicesPackages[item.id] = await safeQuery("SELECT * FROM service_packages WHERE service_id = ? ORDER BY sort_order ASC", [item.id]);
    }
  }
  res.render('pages/company', { title: 'الشركة', infoItems, activityItems, servicesQuestions, servicesPackages });
});

// Test page - no auth required
router.get('/test', (req, res) => {
  res.render('pages/test', { title: 'اختبار التحديث' });
});

module.exports = router;
