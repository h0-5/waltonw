const express = require('express');
const router = express.Router();
const db = require('../config/database');
const path = require('path');
const fs = require('fs');
const { isAuthenticated } = require('../middleware/auth');

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
router.get('/', isAuthenticated, async (req, res) => {
  const settings = await getSettings();
  const news = await safeQuery('SELECT * FROM news WHERE is_hidden = 0 ORDER BY created_at DESC LIMIT 10');
  const memberCount = await safeQuery('SELECT COUNT(*) as c FROM users');
  const giveaways = await safeQuery("SELECT * FROM news WHERE type = 'giveaway' AND expires_at > NOW() AND is_hidden = 0");
  
  const stats = {
    members: settings.stat_members || (memberCount[0] ? memberCount[0].c : '50+'),
    staff: settings.stat_staff || '15+',
    support: settings.stat_support || '24/7'
  };

  res.render('pages/home', {
    title: settings.site_name || 'الرئيسية',
    news, stats, activeGiveaways: giveaways, settings
  });
});

// About
router.get('/about', isAuthenticated, async (req, res) => {
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
router.get('/rules', isAuthenticated, async (req, res) => {
  const settings = await getSettings();
  const rules = await safeQuery('SELECT * FROM rules ORDER BY sort_order ASC');
  const categories = await safeQuery('SELECT * FROM rule_categories ORDER BY sort_order ASC');
  res.render('pages/rules', { title: 'القواعد', rules, categories, settings });
});

// Store
router.get('/store', isAuthenticated, async (req, res) => {
  const settings = await getSettings();
  let sql = 'SELECT * FROM fs_products WHERE 1=1';
  const params = [];

  if (req.query.search) {
    sql += ' AND name LIKE ?';
    params.push('%' + req.query.search + '%');
  }
  if (req.query.cat) {
    sql += ' AND category_type = ?';
    params.push(req.query.cat);
  }
  sql += ' ORDER BY id ASC';

  let products = await safeQuery(sql, params);
  
  let userPoints = 0;
  if (req.user && req.user.discord_id) {
    const pts = await safeQuery('SELECT points FROM bot_points WHERE discord_id = ?', [req.user.discord_id]);
    userPoints = pts.length > 0 ? pts[0].points : 0;
  }

  res.render('pages/store', {
    title: 'المتجر',
    products, userPoints, settings,
    search: req.query.search || '',
    cat: req.query.cat || ''
  });
});

// Store Products (Public Store tab)
router.get('/store/products', isAuthenticated, async (req, res) => {
  const settings = await getSettings();
  let products = await safeQuery('SELECT * FROM fs_products WHERE category_type = ? ORDER BY id ASC', ['purchase']);
  
  let userPoints = 0;
  if (req.user && req.user.discord_id) {
    const pts = await safeQuery('SELECT points FROM bot_points WHERE discord_id = ?', [req.user.discord_id]);
    userPoints = pts.length > 0 ? pts[0].points : 0;
  }

  res.render('pages/store', {
    title: 'المتجر العام',
    products, userPoints, settings,
    search: '', cat: 'purchase'
  });
});

// Products (Marketplace)
router.get('/products', isAuthenticated, async (req, res) => {
  const settings = await getSettings();
  const categories = await safeQuery('SELECT * FROM categories ORDER BY sort_order ASC, id ASC');
  
  let sql = "SELECT p.*, c.name as cat_name, u.username as seller_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN users u ON p.seller_id = u.id WHERE p.status = 'approved'";
  const params = [];

  if (req.query.cat || req.query.category) {
    sql += ' AND p.category_id = ?';
    params.push(req.query.cat || req.query.category);
  }
  if (req.query.search) {
    sql += ' AND p.name LIKE ?';
    params.push('%' + req.query.search + '%');
  }
  sql += ' ORDER BY p.created_at DESC';

  const products = await safeQuery(sql, params);

  let userPoints = 0;
  if (req.user && req.user.discord_id) {
    const pts = await safeQuery('SELECT points FROM bot_points WHERE discord_id = ?', [req.user.discord_id]);
    userPoints = pts.length > 0 ? pts[0].points : 0;
  }

  res.render('pages/products', {
    title: 'المنتجات',
    products, categories, userPoints, settings,
    search: req.query.search || '',
    cat: req.query.cat || ''
  });
});

// Games
router.get('/games', isAuthenticated, async (req, res) => {
  const settings = await getSettings();
  res.render('pages/games', { title: 'الألعاب', settings });
});

// Community
router.get('/community', isAuthenticated, async (req, res) => {
  const settings = await getSettings();
  res.render('pages/community', { title: 'المجتمع', settings });
});

// Applications
router.get('/applications', isAuthenticated, async (req, res) => {
  try {
    const settings = await getSettings();
    const applications = await safeQuery('SELECT * FROM application_settings ORDER BY id ASC');
    const userApps = await safeQuery('SELECT application_type, status FROM submitted_applications WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    res.render('pages/applications', { title: 'الطلبات', applications, userApps, settings });
  } catch(e) {
    res.render('pages/applications', { title: 'الطلبات', applications: [], userApps: [], settings: {} });
  }
});

// Application Form
router.get('/applications/form/:type', isAuthenticated, async (req, res) => {
  try {
    const type = req.params.type;
    const settings = await getSettings();
    const [appSetting] = await db.query('SELECT * FROM application_settings WHERE application_type = ? LIMIT 1', [type]);
    if (!appSetting || appSetting.status !== 'open') {
      return res.redirect('/applications');
    }
    const questions = await db.query('SELECT * FROM application_questions WHERE application_type = ? ORDER BY order_index ASC, sort_order ASC', [type]);
    
    const [pendingApp] = await db.query(
      "SELECT id FROM submitted_applications WHERE user_id = ? AND application_type = ? AND status IN ('pending','waiting_join') LIMIT 1",
      [req.user.id, type]
    );
    
    const [rejectedApp] = await db.query(
      "SELECT cooldown_until FROM submitted_applications WHERE user_id = ? AND application_type = ? AND status = 'rejected' AND cooldown_until IS NOT NULL ORDER BY id DESC LIMIT 1",
      [req.user.id, type]
    );
    
    let inCooldown = false;
    if (rejectedApp && rejectedApp.cooldown_until) {
      inCooldown = new Date(rejectedApp.cooldown_until) > new Date();
    }

    const [userSubmitted] = await db.query(
      "SELECT id, status FROM submitted_applications WHERE user_id = ? AND application_type = ? ORDER BY id DESC LIMIT 5",
      [req.user.id, type]
    );

    res.render('pages/application-form', {
      title: 'تقديم - ' + (appSetting.title || type),
      appSetting: appSetting[0],
      questions: questions,
      pendingApp: pendingApp ? pendingApp.id : null,
      inCooldown,
      cooldownUntil: rejectedApp ? rejectedApp.cooldown_until : null,
      userSubmitted,
      settings
    });
  } catch(e) {
    console.error('Application form error:', e.message);
    res.redirect('/applications');
  }
});

// Submit Application API
router.post('/api/applications/submit', isAuthenticated, async (req, res) => {
  try {
    const { type, answers, answers_multiple, answers_img_url } = req.body;
    if (!type) return res.status(400).json({ error: 'نوع التقديم مطلوب' });

    const [appSetting] = await db.query('SELECT * FROM application_settings WHERE application_type = ? AND status = "open" LIMIT 1', [type]);
    if (!appSetting || !appSetting.length) return res.status(400).json({ error: 'التقديم غير متاح' });

    const [pendingApp] = await db.query(
      "SELECT id FROM submitted_applications WHERE user_id = ? AND application_type = ? AND status IN ('pending','waiting_join') LIMIT 1",
      [req.user.id, type]
    );
    if (pendingApp && pendingApp.length) return res.status(400).json({ error: 'لديك طلب معلق بالفعل' });

    const [rejectedApp] = await db.query(
      "SELECT cooldown_until FROM submitted_applications WHERE user_id = ? AND application_type = ? AND status = 'rejected' AND cooldown_until IS NOT NULL ORDER BY id DESC LIMIT 1",
      [req.user.id, type]
    );
    if (rejectedApp && rejectedApp.cooldown_until && new Date(rejectedApp.cooldown_until) > new Date()) {
      return res.status(400).json({ error: 'يجب الانتظار حتى انتهاء فترة التهدئة' });
    }

    const questions = await db.query('SELECT * FROM application_questions WHERE application_type = ? ORDER BY order_index ASC', [type]);
    const answersData = {};
    const submitAnswers = typeof answers === 'object' ? answers : {};

    for (const q of questions) {
      if (q.type === 'multiple_choice') {
        const multiKey = 'answers_multiple_' + q.id;
        const multiAns = answers_multiple && answers_multiple[q.id] ? answers_multiple[q.id] : (req.body[multiKey] || []);
        if (Array.isArray(multiAns) && multiAns.length > 0) {
          answersData[q.id] = multiAns.filter(a => typeof a === 'string' && a.length <= 200).join(', ');
        }
        if (q.required && (!multiAns || !multiAns.length)) {
          return res.status(400).json({ error: 'يرجى الإجابة على جميع الأسئلة المطلوبة' });
        }
      } else if (q.type === 'image') {
        const imgUrl = answers_img_url && answers_img_url[q.id] ? answers_img_url[q.id] : '';
        if (imgUrl) {
          if (!/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)/i.test(imgUrl)) {
            return res.status(400).json({ error: 'رابط الصورة غير صحيح' });
          }
          answersData[q.id] = imgUrl;
        } else {
          const file = req.files && req.files['answers_img_' + q.id] ? req.files['answers_img_' + q.id] : null;
          if (file) {
            const allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
            const ext = file.name.split('.').pop().toLowerCase();
            if (!allowedExts.includes(ext)) {
              return res.status(400).json({ error: 'نوع الملف غير مسموح به' });
            }
            if (file.size > 5 * 1024 * 1024) {
              return res.status(400).json({ error: 'حجم الملف يتجاوز 5 ميجا' });
            }
            const filename = Date.now() + '_' + Math.random().toString(36).substr(2, 9) + '.' + ext;
            const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'applications');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            await file.mv(path.join(uploadDir, filename));
            answersData[q.id] = '/uploads/applications/' + filename;
          } else if (q.required) {
            return res.status(400).json({ error: 'يرجى رفع صورة للسؤال المطلوب' });
          }
        }
      } else {
        const val = submitAnswers[q.id] || submitAnswers[String(q.id)] || '';
        if (typeof val === 'string') {
          answersData[q.id] = val.substring(0, 2000);
        }
        if (q.required && !val) {
          return res.status(400).json({ error: 'يرجى الإجابة على جميع الأسئلة المطلوبة' });
        }
      }
    }

    await db.query(
      'INSERT INTO submitted_applications (user_id, application_type, answers, status, submitted_at) VALUES (?, ?, ?, "pending", NOW())',
      [req.user.id, type, JSON.stringify(answersData)]
    );

    res.json({ success: true, message: 'تم إرسال طلبك بنجاح' });
  } catch(e) {
    console.error('Submit application error:', e.message);
    res.status(500).json({ error: 'حدث خطأ أثناء إرسال الطلب' });
  }
});

// Support
router.get('/support', isAuthenticated, async (req, res) => {
  const settings = await getSettings();
  res.render('pages/support', { title: 'الدعم الفني', settings });
});

// Profile
router.get('/profile', isAuthenticated, async (req, res) => {
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
router.get('/cart', isAuthenticated, async (req, res) => {
  const settings = await getSettings();
  res.render('pages/cart', { title: 'سلة المشتريات', cartItems: [], total: 0, settings });
});

// Contact
router.get('/contact', isAuthenticated, async (req, res) => {
  const settings = await getSettings();
  const discordUrl = settings.discord_server_url || 'https://discord.gg/rcj6FuekX6';
  res.render('pages/contact', { title: 'تواصل معنا', discordUrl, settings });
});

// Checkout
router.get('/checkout', isAuthenticated, async (req, res) => {
  const settings = await getSettings();
  res.render('pages/checkout', { title: 'إتمام الشراء', settings });
});

// Orders
router.get('/orders', isAuthenticated, async (req, res) => {
  const settings = await getSettings();
  const orders = await safeQuery('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  res.render('pages/orders', { title: 'طلباتي', orders, settings });
});

// My Discounts
router.get('/my_discounts', isAuthenticated, async (req, res) => {
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
router.get('/games/mafia', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/mafia', { title: 'مافيا', settings: s }); });
router.get('/games/rps', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'حجر ورقة مقص', settings: s }); });
router.get('/games/memory', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/memory', { title: 'الذاكرة', settings: s }); });
router.get('/games/spin_wheel', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/spin_wheel', { title: 'عجلة الحظ', settings: s }); });
router.get('/games/impostor', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/mafia', { title: 'Impostor', settings: s }); });
router.get('/games/trivia', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'Trivia', settings: s }); });
router.get('/games/uno', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'UNO', settings: s }); });
router.get('/games/math_race', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'سباق الحساب', settings: s }); });
router.get('/games/word_scramble', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'ترتيب الحروف', settings: s }); });
router.get('/games/quick_quiz', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'kwiz سريع', settings: s }); });
router.get('/games/find_link', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'ابحث عن الرابط', settings: s }); });
router.get('/games/crossword', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'أحجية الكلمات', settings: s }); });
router.get('/games/aviator', isAuthenticated, async (req, res) => { const s = await getSettings(); res.render('games/rps', { title: 'Aviator', settings: s }); });

// Properties
router.get('/properties', async (req, res) => {
  const all = await safeQuery('SELECT * FROM properties ORDER BY sort_order ASC, id ASC');
  const palaces = all.filter(p => p.category === 'palaces');
  const vehicles = all.filter(p => p.category === 'vehicles');
  res.render('pages/properties', { title: 'الممتلكات', palaces, vehicles });
});

// Company
router.get('/company', async (req, res) => {
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

module.exports = router;
