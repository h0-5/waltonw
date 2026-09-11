const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { isAdmin, checkPermission } = require('../../middleware/auth');
const { clearUserCache } = require('../../config/auth'); // إبطال كاش مستخدم الجلسة فور تعديل إداري (حظر/رتبة)
const { sendWebhook, sendTestWebhook, refreshWebhookUrls, isDiscordWebhookUrl, logAdminAction } = require('../../utils/webhooks');
const webhooks = require('../../config/webhooks');

/* إشعار قناة الشركة بالويبهوك (طلب خدمات الشركة) */
function notifyCompany(payload) {
  const key = webhooks.WH_COMPANY ? 'WH_COMPANY' : (webhooks.WH_FARM ? 'WH_FARM' : null);
  if (!key) return;
  sendWebhook(key, Object.assign({ footer: 'Walton Family — Company Services' }, payload)).catch(() => {});
}

// Admin Users API
router.post('/users/update', checkPermission('users_edit'), async (req, res) => {
  const { user_id, username, email } = req.body;
  try {
    await db.execute('UPDATE users SET username = ?, email = ? WHERE id = ?', [username, email, user_id]);
    clearUserCache(user_id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/role', checkPermission('users_edit'), async (req, res) => {
  return res.status(403).json({ error: 'تم تعطيل هذا المسار. استخدم PATCH /api/admin/users/:id من صفحة إدارة المستخدمين' });
});

router.post('/users/ban', checkPermission('users_ban'), async (req, res) => {
  const { user_id } = req.body;
  try {
    await db.execute('UPDATE users SET is_banned = 1 WHERE id = ?', [user_id]);
    clearUserCache(user_id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/unban', checkPermission('users_ban'), async (req, res) => {
  const { user_id } = req.body;
  try {
    await db.execute('UPDATE users SET is_banned = 0 WHERE id = ?', [user_id]);
    clearUserCache(user_id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const ROLE_RANK = {
  owner: 0, developer: 1, founder: 2, vice_founder: 3, chairman: 4,
  present_member: 5, vice_president: 6, leadership: 7, family_member: 8,
  admin: 9, moderator: 10, support: 11, member: 12, trial: 13, user: 14
};
function getRank(role) { return ROLE_RANK[role] !== undefined ? ROLE_RANK[role] : 99; }

// ===== User Detail =====
router.get('/users/:id', checkPermission('users_view'), async (req, res) => {
  try {
    const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!users.length) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const user = users[0];
    const [points] = await db.execute('SELECT * FROM bot_points WHERE discord_id = ?', [user.discord_id || '']);
    const [inventory] = await db.execute('SELECT * FROM bot_inventory WHERE user_id = ?', [user.id]);
    const [boxes] = await db.execute('SELECT * FROM user_boxes WHERE user_id = ?', [user.id]);
    const [achievements] = await db.execute('SELECT * FROM user_achievements WHERE discord_id = ?', [user.discord_id || '']);
    const [sideRoles] = await db.execute('SELECT sr.* FROM side_roles sr JOIN user_side_roles usr ON sr.id = usr.side_role_id WHERE usr.user_id = ?', [user.id]);
    res.json({ success: true, user, points: points[0] || null, inventory, boxes, achievements, sideRoles });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Unified User Update =====
router.patch('/users/:id', checkPermission('users_edit'), async (req, res) => {
  try {
    const { username, role, manageRole, eventManager, sideRoles, points } = req.body;
    const targetId = parseInt(req.params.id);

    // Self-promotion check
    if (role !== undefined && req.user.id === targetId) {
      return res.status(403).json({ error: 'لا يمكنك تغيير رتبتك بنفسك' });
    }

    // Role hierarchy check: can't promote to equal or higher role
    if (role !== undefined) {
      const myRank = getRank(req.user.role);
      const targetNewRank = getRank(role);
      if (targetNewRank <= myRank) {
        return res.status(403).json({ error: 'لا يمكنك تعيين شخص في رتبة مساوية أو أعلى من رتبتك' });
      }
    }

    const updates = [];
    const params = [];
    if (username !== undefined) { updates.push('username = ?'); params.push(username); }
    if (role !== undefined) {
      updates.push('role = ?'); params.push(role);
      updates.push('role_updated_at = NOW()');
      const familyRoles = ['family_member','company_member','vice_president','chairman','founder','leadership','deputy_leadership','executive','deputy_executive','supervisor'];
      if (familyRoles.includes(role)) updates.push('family_joined_at = COALESCE(family_joined_at, NOW())');
      if (['user','member','trial'].includes(role)) { updates.push('tickets_closed = 0'); }
    }
    if (manageRole !== undefined) { updates.push('manage_role = ?'); params.push(manageRole ? 1 : 0); }
    if (eventManager !== undefined) { updates.push('event_manager = ?'); params.push(eventManager ? 1 : 0); }
    if (updates.length) {
      params.push(req.params.id);
      await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
      clearUserCache(targetId);
    }
    if (points !== undefined) {
      const [users] = await db.execute('SELECT discord_id FROM users WHERE id = ?', [req.params.id]);
      if (users.length && users[0].discord_id) {
        await db.execute('UPDATE bot_points SET points = ? WHERE discord_id = ?', [parseInt(points) || 0, users[0].discord_id]);
      }
    }
    if (sideRoles && Array.isArray(sideRoles)) {
      await db.execute('DELETE FROM user_side_roles WHERE user_id = ?', [req.params.id]);
      for (const srId of sideRoles) {
        await db.execute('INSERT INTO user_side_roles (user_id, side_role_id, assigned_by) VALUES (?, ?, ?)', [req.params.id, srId, req.user?.id || null]);
      }
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Ban with reason + duration =====
router.post('/users/:id/ban', checkPermission('users_ban'), async (req, res) => {
  try {
    const { reason, durationMinutes } = req.body;
    const updates = ['is_banned = 1', 'ban_reason = ?', 'banned_at = NOW()', 'banned_by = ?'];
    const params = [reason || '', req.user?.id || null];
    if (durationMinutes && durationMinutes > 0) {
      updates.push('banned_until = DATE_ADD(NOW(), INTERVAL ? MINUTE)');
      params.push(parseInt(durationMinutes));
    }
    params.push(req.params.id);
    await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    clearUserCache(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Unban by ID =====
router.post('/users/:id/unban', checkPermission('users_ban'), async (req, res) => {
  try {
    await db.execute('UPDATE users SET is_banned = 0, ban_reason = NULL, banned_at = NULL, banned_until = NULL, banned_by = NULL WHERE id = ?', [req.params.id]);
    clearUserCache(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Unban All =====
router.post('/users/unban-all', checkPermission('users_ban'), async (req, res) => {
  try {
    await db.execute('UPDATE users SET is_banned = 0, ban_reason = NULL, banned_at = NULL, banned_until = NULL, banned_by = NULL WHERE is_banned = 1');
    clearUserCache(null);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Bot Points =====
router.post('/users/:id/points', checkPermission('users_edit'), async (req, res) => {
  try {
    const { points, reason } = req.body;
    const [users] = await db.execute('SELECT discord_id FROM users WHERE id = ?', [req.params.id]);
    if (!users.length || !users[0].discord_id) return res.status(404).json({ error: 'المستخدم غير موجود' });
    const discordId = users[0].discord_id;
    await db.execute('INSERT INTO bot_points (discord_id, points, total_earned) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE points = points + VALUES(points), total_earned = total_earned + VALUES(total_earned)', [discordId, points || 0, points > 0 ? points : 0]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Inventory =====
router.post('/users/:id/items', checkPermission('users_edit'), async (req, res) => {
  try {
    const { item_key, item_name, quantity } = req.body;
    await db.execute('INSERT INTO bot_inventory (user_id, item_key, item_name, quantity) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)', [req.params.id, item_key, item_name, quantity || 1]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/users/:id/items/:key', checkPermission('users_edit'), async (req, res) => {
  try {
    await db.execute('DELETE FROM bot_inventory WHERE user_id = ? AND item_key = ?', [req.params.id, req.params.key]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Boxes =====
router.post('/users/:id/boxes', checkPermission('users_edit'), async (req, res) => {
  try {
    const { box_name } = req.body;
    await db.execute('INSERT INTO user_boxes (user_id, box_name) VALUES (?, ?)', [req.params.id, box_name]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/boxes/:boxId', checkPermission('users_edit'), async (req, res) => {
  try {
    await db.execute('DELETE FROM user_boxes WHERE id = ?', [req.params.boxId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Achievements =====
router.post('/users/:id/achievements', checkPermission('users_edit'), async (req, res) => {
  try {
    const { achievement_name } = req.body;
    const [users] = await db.execute('SELECT discord_id FROM users WHERE id = ?', [req.params.id]);
    if (!users.length || !users[0].discord_id) return res.status(404).json({ error: 'المستخدم غير موجود' });
    await db.execute('INSERT INTO user_achievements (discord_id, achievement_name) VALUES (?, ?)', [users[0].discord_id, achievement_name]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/users/:id/achievements/:achId', checkPermission('users_edit'), async (req, res) => {
  try {
    await db.execute('DELETE FROM user_achievements WHERE id = ?', [req.params.achId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin Products API
router.post('/products/add', checkPermission('products_manage'), async (req, res) => {
  const { name, description, category_type, price_points, price_money, stock } = req.body;
  try {
    await db.execute(
      'INSERT INTO fs_products (name, description, category_type, price_points, price_money, stock, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [name, description, category_type, price_points || 0, price_money || 0, stock || 0]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/products/delete', checkPermission('products_manage'), async (req, res) => {
  const { product_id } = req.body;
  try {
    await db.execute('DELETE FROM fs_products WHERE id = ?', [product_id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/products/edit', checkPermission('products_manage'), async (req, res) => {
  const { product_id, name, description, category_type, price_points, price_money, stock, image } = req.body;
  try {
    await db.execute(
      'UPDATE fs_products SET name=?, description=?, category_type=?, price_points=?, price_money=?, stock=?, image=? WHERE id=?',
      [name, description, category_type, price_points || 0, price_money || 0, stock || 0, image || null, product_id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Orders API =====
router.post('/orders/:id/status', checkPermission('store_orders_view'), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });
    await db.execute('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== News API =====
router.get('/news/:id', checkPermission('news_add'), async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM news WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'غير موجود' });
    res.json({ news: rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/news', checkPermission('news_add'), async (req, res) => {
  try {
    const { title, content, type, image, is_published } = req.body;
    const [result] = await db.execute(
      'INSERT INTO news (title, content, type, image, author_id, is_published, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [title, content, type || 'news', image || null, req.user.id, is_published !== undefined ? is_published : 1]
    );
    res.json({ success: true, id: result.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/news/:id', checkPermission('news_add'), async (req, res) => {
  try {
    const { title, content, type, image, is_published } = req.body;
    await db.execute(
      'UPDATE news SET title=?, content=?, type=?, image=?, is_published=? WHERE id=?',
      [title, content, type || 'news', image || null, is_published !== undefined ? is_published : 1, req.params.id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/news/:id', checkPermission('news_add'), async (req, res) => {
  try {
    await db.execute('DELETE FROM news WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Tickets API =====
router.get('/tickets/:id', checkPermission('tickets_view'), async (req, res) => {
  try {
    const [ticket] = await db.execute('SELECT t.*, u.username FROM support_tickets t LEFT JOIN users u ON t.user_id = u.id WHERE t.id = ?', [req.params.id]);
    if (!ticket.length) return res.status(404).json({ error: 'غير موجود' });
    const [replies] = await db.execute('SELECT r.*, u.username FROM ticket_replies r LEFT JOIN users u ON r.user_id = u.id WHERE r.ticket_id = ? ORDER BY r.created_at ASC', [req.params.id]);
    res.json({ ticket: ticket[0], replies });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/tickets/:id/reply', checkPermission('tickets_reply'), async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'الرسالة مطلوبة' });
    await db.execute('INSERT INTO ticket_replies (ticket_id, user_id, message, is_admin, created_at) VALUES (?, ?, ?, 1, NOW())', [req.params.id, req.user.id, message.trim()]);
    await db.execute("UPDATE support_tickets SET status = 'replied' WHERE id = ? AND status = 'open'", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/tickets/:id/close', checkPermission('tickets_reply'), async (req, res) => {
  try {
    await db.execute("UPDATE support_tickets SET status = 'closed' WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Giveaways API =====
router.get('/giveaways', checkPermission('gifts_manage'), async (req, res) => {
  try {
    const [giveaways] = await db.execute('SELECT * FROM giveaways ORDER BY id DESC');
    res.json({ giveaways });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/giveaways', checkPermission('gifts_manage'), async (req, res) => {
  try {
    const { title, description, prize, type, winner_count, required_role, required_points, starts_at, ends_at } = req.body;
    const [result] = await db.execute(
      'INSERT INTO giveaways (title, description, prize, type, winner_count, required_role, required_points, created_by, starts_at, ends_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "active", NOW())',
      [title, description, prize, type || 'normal', winner_count || 1, required_role || null, required_points || 0, req.user.id, starts_at || null, ends_at || null]
    );
    res.json({ success: true, id: result.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/giveaways/:id', checkPermission('gifts_manage'), async (req, res) => {
  try {
    await db.execute('DELETE FROM giveaways WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/giveaways/:id/end', checkPermission('gifts_manage'), async (req, res) => {
  try {
    await db.execute("UPDATE giveaways SET status = 'ended' WHERE id = ?", [req.params.id]);
    // Pick random winners
    const [participants] = await db.execute('SELECT * FROM giveaway_participants WHERE giveaway_id = ? ORDER BY RAND() LIMIT 1', [req.params.id]);
    if (participants.length) {
      await db.execute('INSERT INTO giveaway_winners (giveaway_id, user_id, username, selected_at) VALUES (?, ?, ?, NOW())', [req.params.id, participants[0].user_id, participants[0].username]);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin Settings API
router.post('/settings', checkPermission('site_settings_edit'), async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await db.execute(
        'INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
        [key, value, value]
      );
    }
    const app = require('../../app');
    if (app.invalidateSettingsCache) app.invalidateSettingsCache();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Webhook Settings — روابط ويبهوك الإشعارات من لوحة الإدارة (بدون Railway) =====
router.get('/webhook-settings', checkPermission('site_settings_edit'), async (req, res) => {
  try {
    await refreshWebhookUrls();
    const list = Object.keys(webhooks)
      .filter(k => /^WH_[A-Z_]+$/.test(k) && k !== 'WH_PROXY')
      .map(k => ({ key: k, url: webhooks[k] || '', source: webhooks._sources[k] || (webhooks[k] ? 'env' : 'none') }));
    // الأساسية أولاً (المزارع + الشركة + سجل الإدارة) ثم الباقي أبجدياً
    const prio = ['WH_FARM', 'WH_COMPANY', 'WH_ADMIN_LOG'];
    list.sort((a, b) => {
      const ia = prio.indexOf(a.key), ib = prio.indexOf(b.key);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.key.localeCompare(b.key);
    });
    res.json({ success: true, webhooks: list });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/webhook-settings', checkPermission('site_settings_edit'), async (req, res) => {
  try {
    const urls = (req.body && req.body.urls) || {};
    const saved = [], cleared = [], invalid = [];
    for (const [key, raw] of Object.entries(urls)) {
      if (!/^WH_[A-Z_]+$/.test(key) || key === 'WH_PROXY') continue;
      const val = String(raw || '').trim();
      if (!val) {
        // حقل فاضي = مسح الرابط المحفوظ والرجوع لمتغير البيئة (إن وجد)
        await db.execute('DELETE FROM site_settings WHERE setting_key = ?', ['wh_url_' + key]);
        cleared.push(key);
        continue;
      }
      if (!isDiscordWebhookUrl(val)) { invalid.push(key); continue; }
      await db.execute(
        'INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
        ['wh_url_' + key, val, val]
      );
      saved.push(key);
    }
    await refreshWebhookUrls();
    if (saved.length || cleared.length) {
      logAdminAction(req.user.id, req.user.username, 'webhook_settings', '', null, '',
        'حدّث روابط الويبهوك — حفظ: [' + saved.join(', ') + '] مسح: [' + cleared.join(', ') + ']' +
        (invalid.length ? ' — مرفوض (رابط غير صالح): [' + invalid.join(', ') + ']' : ''), req.ip || '');
    }
    res.json({ success: true, saved, cleared, invalid });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/webhook-test', checkPermission('site_settings_edit'), async (req, res) => {
  try {
    const key = String((req.body && req.body.key) || '');
    if (!/^WH_[A-Z_]+$/.test(key) || key === 'WH_PROXY') return res.status(400).json({ success: false, error: 'مفتاح غير معروف' });
    const url = String((req.body && req.body.url) || '').trim();
    const result = await sendTestWebhook(key, url || null);
    res.json(result.ok ? { success: true } : { success: false, error: result.error });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Notifications API
router.get('/notifications', require('../../middleware/auth').isAuthenticated, async (req, res) => {
  if (!req.user) return res.json({ notifications: [] });
  try {
    const [notifications] = await db.execute(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    res.json({ notifications });
  } catch(e) { res.json({ notifications: [] }); }
});

router.post('/notifications/read', require('../../middleware/auth').isAuthenticated, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await db.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Orders API
router.post('/orders/create', require('../../middleware/auth').isAuthenticated, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { full_name, address, phone, payment } = req.body;
  try {
    const [result] = await db.execute(
      'INSERT INTO orders (user_id, total_amount, shipping_address, payment_method, status, created_at) VALUES (?, 0, ?, ?, ?, NOW())',
      [req.user.id, `${full_name} - ${address} - ${phone}`, payment, 'pending']
    );
    res.json({ success: true, orderId: result.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Rules API
router.post('/rules', checkPermission('rules_add'), async (req, res) => {
  try {
    const { category, rule_text, sort_order } = req.body;
    await db.execute('INSERT INTO rules (category, title, content, rule_text, sort_order) VALUES (?, ?, ?, ?, ?)', [category, '', rule_text, rule_text, sort_order || 0]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/rules/:id', checkPermission('rules_add'), async (req, res) => {
  try {
    const { category, rule_text, sort_order } = req.body;
    await db.execute('UPDATE rules SET category=?, content=?, rule_text=?, sort_order=? WHERE id=?', [category, rule_text, rule_text, sort_order || 0, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/rules/:id', checkPermission('rules_delete'), async (req, res) => {
  try {
    await db.execute('DELETE FROM rules WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Rule Categories API
router.get('/rule-categories', checkPermission('rules_view'), async (req, res) => {
  try {
    const [cats] = await db.execute('SELECT * FROM rule_categories ORDER BY sort_order ASC, id ASC');
    res.json(cats);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/rule-categories', checkPermission('rules_add'), async (req, res) => {
  try {
    const { name, icon, sort_order } = req.body;
    const [result] = await db.execute('INSERT INTO rule_categories (name, icon, sort_order) VALUES (?, ?, ?)', [name, icon || 'fa-gavel', sort_order || 0]);
    res.json({ success: true, id: result.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/rule-categories/:id', checkPermission('rules_add'), async (req, res) => {
  try {
    const { name, icon, sort_order } = req.body;
    const [old] = await db.execute('SELECT name FROM rule_categories WHERE id = ?', [req.params.id]);
    await db.execute('UPDATE rule_categories SET name=?, icon=?, sort_order=? WHERE id=?', [name, icon || 'fa-gavel', sort_order || 0, req.params.id]);
    // إعادة التسمية تحدّث قوانين القسم معها — وإلا تصير يتيمة بلا قسم (نفس مشكلة «أخرى»)
    if (old.length && old[0].name !== name) {
      await db.execute('UPDATE rules SET category = ? WHERE category = ?', [name, old[0].name]);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/rule-categories/:id', checkPermission('rules_delete'), async (req, res) => {
  try {
    const [cat] = await db.execute('SELECT name FROM rule_categories WHERE id = ?', [req.params.id]);
    if (cat.length) {
      // حذف القسم يحذف قوانينه معه (طلب المستخدم: ما يبغاها تنقل لقسم «أخرى»)
      await db.execute('DELETE FROM rules WHERE category = ?', [cat[0].name]);
    }
    await db.execute('DELETE FROM rule_categories WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Rule Stages API — مراحل العقوبات: نظام مستقل تماماً عن القوانين وأقسامها (نفس نمط إدارتها)
router.get('/rule-stages', checkPermission('rules_view'), async (req, res) => {
  try {
    const [stages] = await db.execute('SELECT * FROM rule_stages ORDER BY sort_order ASC, id ASC');
    res.json(stages);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// لون مخصص للمرحلة — hex صحيح (#rgb/#rrggbb) أو null (تلقائي: يتحدد من العنوان)
function stageColor(color) {
  const c = String(color || '').trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) ? c : null;
}

router.post('/rule-stages', checkPermission('rules_add'), async (req, res) => {
  try {
    const { title, description, icon, sort_order, color } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'عنوان المرحلة مطلوب' });
    const [result] = await db.execute('INSERT INTO rule_stages (title, description, icon, color, sort_order) VALUES (?, ?, ?, ?, ?)',
      [String(title).trim().slice(0, 100), String(description || '').trim().slice(0, 500), icon || 'fa-flag', stageColor(color), parseInt(sort_order) || 0]);
    res.json({ success: true, id: result.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/rule-stages/:id', checkPermission('rules_add'), async (req, res) => {
  try {
    const { title, description, icon, sort_order, color } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'عنوان المرحلة مطلوب' });
    await db.execute('UPDATE rule_stages SET title=?, description=?, icon=?, color=?, sort_order=? WHERE id=?',
      [String(title).trim().slice(0, 100), String(description || '').trim().slice(0, 500), icon || 'fa-flag', stageColor(color), parseInt(sort_order) || 0, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/rule-stages/:id', checkPermission('rules_delete'), async (req, res) => {
  try {
    await db.execute('DELETE FROM rule_stages WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Discounts API
router.post('/discounts', checkPermission('discounts_manage'), async (req, res) => {
  try {
    const { code, discount_percent, max_uses, expires_at } = req.body;
    await db.execute('INSERT INTO discount_codes (code, discount_percent, max_uses, expires_at) VALUES (?, ?, ?, ?)',
      [code, discount_percent, max_uses || null, expires_at || null]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/discounts/:id', checkPermission('discounts_manage'), async (req, res) => {
  try {
    await db.execute('DELETE FROM discount_codes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Users Unban API (by URL param)
router.post('/users/:id/unban', checkPermission('users_ban'), async (req, res) => {
  try {
    await db.execute('UPDATE users SET is_banned = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Broadcast API
router.post('/broadcast', checkPermission('broadcast_send'), async (req, res) => {
  try {
    const { title, message, target, expires_at } = req.body;
    let whereClause = '';
    if (target === 'admins') whereClause = "AND role IN ('owner','developer','founder','moderator','support')";
    else if (target === 'family') whereClause = "AND role != 'user'";
    
    const [users] = await db.execute(`SELECT id FROM users WHERE 1=1 ${whereClause}`);
    for (const u of users) {
      await db.execute('INSERT INTO notifications (user_id, title, message, is_read, created_at) VALUES (?, ?, ?, 0, NOW())',
        [u.id, title || 'تبليغ', message]);
      // Send Discord DM in background (don't await)
      try {
        const bot = require('../../bot/client');
        bot.sendNotificationDM(u.id, title || 'تبليغ', message).catch(() => {});
      } catch(e) {}
    }
    // Also save to broadcasts table for ticker
    await db.execute('INSERT INTO broadcasts (title, message, type, is_active, expires_at) VALUES (?, ?, ?, 1, ?)',
      [title || '', message, target || 'all', expires_at || null]);
    res.json({ success: true, sent: users.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// List broadcasts
router.get('/broadcasts', checkPermission('broadcast_send'), async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 50');
    res.json({ success: true, broadcasts: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete broadcast
router.delete('/broadcasts/:id', checkPermission('broadcast_send'), async (req, res) => {
  try {
    await db.execute('DELETE FROM broadcasts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Toggle broadcast active
router.post('/broadcasts/:id/toggle', checkPermission('broadcast_send'), async (req, res) => {
  try {
    await db.execute('UPDATE broadcasts SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// About Content API
router.post('/about', checkPermission('about_edit'), async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await db.execute(
        'INSERT INTO about_us_content (content_key, content_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE content_value = ?',
        [key, value, value]
      );
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Properties API
router.post('/properties', checkPermission('properties_edit'), async (req, res) => {
  try {
    const { title, category, sort_order, image_url } = req.body;
    let image = image_url || '';
    if (req.files && req.files.image_file && req.files.image_file.size > 0) {
      const file = req.files.image_file;
      const ext = file.name.split('.').pop();
      const fname = 'prop_' + Date.now() + '.' + ext;
      const uploadDir = require('path').join(__dirname, '../../public/uploads/properties');
      require('fs').mkdirSync(uploadDir, { recursive: true });
      await file.mv(uploadDir + '/' + fname);
      image = '/uploads/properties/' + fname;
    }
    await db.execute('INSERT INTO properties (title, image, category, sort_order) VALUES (?, ?, ?, ?)',
      [title, image, category || 'palaces', sort_order || 0]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/properties/:id', checkPermission('properties_edit'), async (req, res) => {
  try {
    const { title, category, sort_order, image_url } = req.body;
    const [existing] = await db.execute('SELECT image FROM properties WHERE id = ?', [req.params.id]);
    let image = existing.length ? existing[0].image : '';
    const hasNewFile = req.files && req.files.image_file && req.files.image_file.size > 0;
    if (hasNewFile) {
      if (image && image.startsWith('/uploads/')) {
        const fp = require('path').join(__dirname, '../../public', image);
        try { require('fs').unlinkSync(fp); } catch(_) {}
      }
      const file = req.files.image_file;
      const ext = file.name.split('.').pop();
      const fname = 'prop_' + Date.now() + '.' + ext;
      const uploadDir = require('path').join(__dirname, '../../public/uploads/properties');
      require('fs').mkdirSync(uploadDir, { recursive: true });
      await file.mv(uploadDir + '/' + fname);
      image = '/uploads/properties/' + fname;
    } else if (image_url && image_url.trim()) {
      if (image && image.startsWith('/uploads/')) {
        const fp = require('path').join(__dirname, '../../public', image);
        try { require('fs').unlinkSync(fp); } catch(_) {}
      }
      image = image_url.trim();
    }
    await db.execute('UPDATE properties SET title=?, image=?, category=?, sort_order=? WHERE id=?',
      [title, image, category || 'palaces', sort_order || 0, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/properties/:id', checkPermission('properties_delete'), async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT image FROM properties WHERE id = ?', [req.params.id]);
    if (rows.length && rows[0].image && rows[0].image.startsWith('/uploads/')) {
      const fp = require('path').join(__dirname, '../../public', rows[0].image);
      require('fs').unlinkSync(fp);
    }
    await db.execute('DELETE FROM properties WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Company Items API
router.post('/company/items', checkPermission('company_edit'), async (req, res) => {
  try {
    const { title, description, category, video_url, service_status, icon } = req.body;
    let image = '';
    if (req.files && req.files.image_file && req.files.image_file.size > 0) {
      const file = req.files.image_file;
      const ext = file.name.split('.').pop();
      const fname = 'co_' + Date.now() + '.' + ext;
      const uploadDir = require('path').join(__dirname, '../../public/uploads/company');
      require('fs').mkdirSync(uploadDir, { recursive: true });
      await file.mv(uploadDir + '/' + fname);
      image = '/uploads/company/' + fname;
    }
    await db.execute('INSERT INTO company_items (title, description, image, video_url, category, service_status, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [title, description || '', image, video_url || '', category || 'info', service_status || null, (icon || '').trim()]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/company/items/:id', checkPermission('company_edit'), async (req, res) => {
  try {
    const { title, description, category, video_url, service_status, icon } = req.body;
    const [existing] = await db.execute('SELECT image FROM company_items WHERE id = ?', [req.params.id]);
    let image = existing.length ? existing[0].image : '';
    const hasNewFile = req.files && req.files.image_file && req.files.image_file.size > 0;
    if (hasNewFile) {
      if (image && image.startsWith('/uploads/')) {
        const fp = require('path').join(__dirname, '../../public', image);
        try { require('fs').unlinkSync(fp); } catch(_) {}
      }
      const file = req.files.image_file;
      const ext = file.name.split('.').pop();
      const fname = 'co_' + Date.now() + '.' + ext;
      const uploadDir = require('path').join(__dirname, '../../public/uploads/company');
      require('fs').mkdirSync(uploadDir, { recursive: true });
      await file.mv(uploadDir + '/' + fname);
      image = '/uploads/company/' + fname;
    }
    await db.execute('UPDATE company_items SET title=?, description=?, image=?, video_url=?, category=?, service_status=?, icon=? WHERE id=?',
      [title, description || '', image, video_url || '', category || 'info', service_status || null, (icon || '').trim(), req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/company/items/:id', checkPermission('company_delete'), async (req, res) => {
  try {
    await db.execute('DELETE FROM service_questions WHERE service_id = ?', [req.params.id]);
    await db.execute('DELETE FROM service_packages WHERE service_id = ?', [req.params.id]);
    await db.execute('DELETE FROM company_items WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Company Service Request Actions
router.post('/company/requests/:id/approve', checkPermission('company_edit'), async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT sr.*, ci.title AS service_title FROM service_requests sr LEFT JOIN company_items ci ON sr.service_id = ci.id WHERE sr.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'الطلب غير موجود' });
    await db.execute("UPDATE service_requests SET status = 'approved', admin_id = ?, reviewed_at = NOW() WHERE id = ?", [req.user.id, req.params.id]);
    await db.execute('INSERT INTO notifications (user_id, title, message, type, link, sender_id) VALUES (?, ?, ?, ?, ?, ?)',
      [rows[0].user_id, 'تم قبول طلب خدمتك', 'طلبك على خدمة «' + (rows[0].service_title || '') + '» تم قبوله — الإدارة راح تتواصل معك للتنفيذ', 'success', '/company', req.user.id]);
    notifyCompany({ title: '✅ قبول طلب خدمة — ' + (rows[0].service_title || ''), color: 0x34d399, fields: [
      { name: 'رقم الطلب', value: '#' + rows[0].id, inline: true }, { name: 'بواسطة', value: req.user.username, inline: true }
    ] });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/company/requests/:id/reject', checkPermission('company_edit'), async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT sr.*, ci.title AS service_title FROM service_requests sr LEFT JOIN company_items ci ON sr.service_id = ci.id WHERE sr.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'الطلب غير موجود' });
    const notes = typeof req.body.notes === 'string' ? req.body.notes.substring(0, 500) : '';
    await db.execute("UPDATE service_requests SET status = 'rejected', admin_id = ?, reviewed_at = NOW() WHERE id = ?", [req.user.id, req.params.id]);
    await db.execute('INSERT INTO notifications (user_id, title, message, type, link, sender_id) VALUES (?, ?, ?, ?, ?, ?)',
      [rows[0].user_id, 'تم رفض طلب خدمتك', 'طلبك على خدمة «' + (rows[0].service_title || '') + '» ما تم قبوله' + (notes ? ' — السبب: ' + notes : ''), 'warning', '/company', req.user.id]);
    notifyCompany({ title: '❌ رفض طلب خدمة — ' + (rows[0].service_title || ''), color: 0xef4444, fields: [
      { name: 'رقم الطلب', value: '#' + rows[0].id, inline: true }, { name: 'بواسطة', value: req.user.username, inline: true }
    ].concat(notes ? [{ name: 'السبب', value: notes, inline: false }] : []) });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// أسئلة خدمات الشركة (إدارة كاملة — إضافة/حذف)
router.post('/company/questions', checkPermission('company_edit'), async (req, res) => {
  try {
    const serviceId = parseInt(req.body.service_id);
    const question = String(req.body.question || '').trim().slice(0, 500);
    const type = ['text', 'image', 'character_name'].includes(req.body.type) ? req.body.type : 'text';
    const required = req.body.required ? 1 : 0;
    if (!serviceId || !question) return res.status(400).json({ error: 'أكمل السؤال والخدمة' });
    const [mx] = await db.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 AS nxt FROM service_questions WHERE service_id = ?', [serviceId]);
    await db.execute('INSERT INTO service_questions (service_id, question, type, required, sort_order) VALUES (?, ?, ?, ?, ?)',
      [serviceId, question, type, required, Number(mx[0].nxt)]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/company/questions/:id', checkPermission('company_edit'), async (req, res) => {
  try {
    await db.execute('DELETE FROM service_questions WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// بكجات خدمات الشركة (اختيارية — باقات بأسعار)
router.post('/company/packages', checkPermission('company_edit'), async (req, res) => {
  try {
    const serviceId = parseInt(req.body.service_id);
    const name = String(req.body.name || '').trim().slice(0, 255);
    const price = Math.max(0, Math.round(Number(req.body.price) || 0));
    const days = Math.max(0, Math.round(Number(req.body.days) || 0));
    if (!serviceId || !name) return res.status(400).json({ error: 'أكمل اسم البكج والخدمة' });
    const [mx] = await db.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 AS nxt FROM service_packages WHERE service_id = ?', [serviceId]);
    await db.execute('INSERT INTO service_packages (service_id, name, price, days, sort_order) VALUES (?, ?, ?, ?, ?)',
      [serviceId, name, price, days, Number(mx[0].nxt)]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/company/packages/:id', checkPermission('company_edit'), async (req, res) => {
  try {
    await db.execute('DELETE FROM service_packages WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Service Request from user
router.post('/service-request', require('../../middleware/auth').isAuthenticated, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
    const { service_id, package_id } = req.body;
    await db.execute('INSERT INTO service_requests (service_id, user_id, answers, status, total_price, package_id) VALUES (?, ?, ?, ?, ?, ?)',
      [service_id, req.user.id, JSON.stringify([]), 'pending', 0, package_id || 0]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
// Application Management APIs
// â•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گâ•گ
const path = require('path');
const fs = require('fs');

// Approve application
router.post('/applications/:id/approve', checkPermission('apps_approve'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || id <= 0) return res.status(400).json({ error: 'رقم غير صحيح' });
    const [app] = await db.query('SELECT * FROM submitted_applications WHERE id = ? LIMIT 1', [id]);
    if (!app || !app.length) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (app[0].status !== 'pending') return res.status(400).json({ error: 'يمكن قبول الطلبات المعلقة فقط' });

    await db.query(
      "UPDATE submitted_applications SET status = 'waiting_join', reviewed_by = ?, reviewed_at = NOW(), review_notes = ? WHERE id = ?",
      [req.user.id, req.body.notes || null, id]
    );

    const [typeSetting] = await db.query('SELECT site_role FROM application_settings WHERE application_type = ?', [app[0].application_type]);
    if (typeSetting && typeSetting.length && typeSetting[0].site_role) {
      const [applicant] = await db.query('SELECT role FROM users WHERE id = ?', [app[0].user_id]);
      const adminRoles = ['owner', 'admin', 'moderator', 'support'];
      if (!applicant.length || !adminRoles.includes(applicant[0].role)) {
        await db.query('UPDATE users SET role = ? WHERE id = ?', [typeSetting[0].site_role, app[0].user_id]);
      }
    }

    await db.query(
      "INSERT INTO admin_logs (user_id, username, action, target_type, target_id, details, created_at) VALUES (?, ?, 'approve_application', 'application', ?, ?, NOW())",
      [req.user.id, req.user.username, id, 'Application #' + id + ' approved (waiting_join)']
    );

    res.json({ success: true });
  } catch(e) {
    console.error('Approve app error:', e.message);
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

// Reject application
router.post('/applications/:id/reject', checkPermission('apps_reject'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || id <= 0) return res.status(400).json({ error: 'رقم غير صحيح' });
    const [app] = await db.query('SELECT * FROM submitted_applications WHERE id = ? LIMIT 1', [id]);
    if (!app || !app.length) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (app[0].status !== 'pending') return res.status(400).json({ error: 'يمكن رفض الطلبات المعلقة فقط' });

    const notes = typeof req.body.notes === 'string' ? req.body.notes.substring(0, 1000) : '';
    let cooldownUntil = null;
    const [typeSetting] = await db.query('SELECT rejection_cooldown_hours FROM application_settings WHERE application_type = ?', [app[0].application_type]);
    if (typeSetting && typeSetting.length && typeSetting[0].rejection_cooldown_hours > 0) {
      const hours = typeSetting[0].rejection_cooldown_hours;
      cooldownUntil = new Date(Date.now() + hours * 3600000).toISOString().slice(0, 19).replace('T', ' ');
    }

    await db.query(
      "UPDATE submitted_applications SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), review_notes = ?, cooldown_until = ? WHERE id = ?",
      [req.user.id, notes || null, cooldownUntil, id]
    );

    await db.query(
      "INSERT INTO admin_logs (user_id, username, action, target_type, target_id, details, created_at) VALUES (?, ?, 'reject_application', 'application', ?, ?, NOW())",
      [req.user.id, req.user.username, id, 'Application #' + id + ' rejected' + (notes ? ': ' + notes.substring(0, 100) : '')]
    );

    res.json({ success: true });
  } catch(e) {
    console.error('Reject app error:', e.message);
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

// Delete application
router.post('/applications/:id/delete', checkPermission('apps_delete'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || id <= 0) return res.status(400).json({ error: 'رقم غير صحيح' });
    const [app] = await db.query('SELECT id FROM submitted_applications WHERE id = ? LIMIT 1', [id]);
    if (!app || !app.length) return res.status(404).json({ error: 'الطلب غير موجود' });

    await db.query('DELETE FROM submitted_applications WHERE id = ?', [id]);
    await db.query(
      "INSERT INTO admin_logs (user_id, username, action, target_type, target_id, details, created_at) VALUES (?, ?, 'delete_application', 'application', ?, ?, NOW())",
      [req.user.id, req.user.username, id, 'Application #' + id + ' deleted']
    );

    res.json({ success: true });
  } catch(e) {
    console.error('Delete app error:', e.message);
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

// Get questions for type
router.get('/applications/questions/:type', checkPermission('app_types_view'), async (req, res) => {
  try {
    const type = req.params.type;
    const [qs] = await db.query('SELECT * FROM application_questions WHERE application_type = ? ORDER BY order_index ASC, sort_order ASC', [type]);
    res.json(qs);
  } catch(e) { res.json([]); }
});

// Add question
router.post('/applications/questions', checkPermission('app_types_edit'), async (req, res) => {
  try {
    const { application_type, question, type, required, options, order_index, max_selections } = req.body;
    if (!application_type || !question) return res.status(400).json({ error: 'البيانات ناقصة' });
    const validTypes = ['text','textarea','number','select','radio','multiple_choice','true_false','server_name','image'];
    const qType = validTypes.includes(type) ? type : 'text';
    const opts = typeof options === 'string' ? options.substring(0, 5000) : '';
    const maxSel = (qType === 'multiple_choice' && max_selections) ? parseInt(max_selections) : null;
    const keywordVal = (typeof keyword === 'string' && keyword.trim()) ? keyword.trim().substring(0, 200) : null;
    await db.query(
      'INSERT INTO application_questions (application_type, question, type, required, options, order_index, sort_order, max_selections, keyword) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [application_type, question.substring(0, 500), qType, required ? 1 : 0, opts, parseInt(order_index) || 0, parseInt(order_index) || 0, maxSel, keywordVal]
    );
    res.json({ success: true });
  } catch(e) {
    console.error('Add question error:', e.message);
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

// Delete question
router.delete('/applications/questions/:id', checkPermission('app_types_edit'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'رقم غير صحيح' });
    await db.query('DELETE FROM application_questions WHERE id = ?', [id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'حدث خطأ' }); }
});

// Get settings for type
router.get('/applications/settings/:type', checkPermission('app_types_view'), async (req, res) => {
  try {
    const [s] = await db.query('SELECT * FROM application_settings WHERE application_type = ? LIMIT 1', [req.params.type]);
    res.json(s && s.length ? s[0] : {});
  } catch(e) { res.json({}); }
});

// Update settings for type
router.put('/applications/settings/:type', checkPermission('app_types_edit'), async (req, res) => {
  try {
    const type = req.params.type;
    const { title, status, description, requirements, image, site_role, discord_role_id, discord_role_id_2, discord_role_id_3, required_discord_role_id, rejection_cooldown_hours, notify_enabled } = req.body;
    const sets = [];
    const vals = [];
    if (title !== undefined) { sets.push('title = ?'); vals.push(title.substring(0, 255)); }
    if (status !== undefined) { sets.push('status = ?'); vals.push(['open','closed'].includes(status) ? status : 'closed'); }
    if (description !== undefined) { sets.push('description = ?'); vals.push(description.substring(0, 5000)); }
    if (requirements !== undefined) { sets.push('requirements = ?'); vals.push(requirements.substring(0, 5000)); }
    if (image !== undefined) { sets.push('image = ?'); vals.push(image.substring(0, 255)); }
    if (site_role !== undefined) { sets.push('site_role = ?'); vals.push(site_role.substring(0, 50)); }
    if (discord_role_id !== undefined) { sets.push('discord_role_id = ?'); vals.push(discord_role_id.substring(0, 50)); }
    if (discord_role_id_2 !== undefined) { sets.push('discord_role_id_2 = ?'); vals.push(discord_role_id_2.substring(0, 50)); }
    if (discord_role_id_3 !== undefined) { sets.push('discord_role_id_3 = ?'); vals.push(discord_role_id_3.substring(0, 50)); }
    if (required_discord_role_id !== undefined) { sets.push('required_discord_role_id = ?'); vals.push(required_discord_role_id.substring(0, 50)); }
    if (rejection_cooldown_hours !== undefined) { sets.push('rejection_cooldown_hours = ?'); vals.push(parseInt(rejection_cooldown_hours) || 0); }
    if (notify_enabled !== undefined) { sets.push('notify_enabled = ?'); vals.push(parseInt(notify_enabled) ? 1 : 0); }
    sets.push('updated_at = NOW()');
    vals.push(type);
    await db.query('UPDATE application_settings SET ' + sets.join(', ') + ' WHERE application_type = ?', vals);
    res.json({ success: true });
  } catch(e) {
    console.error('Update settings error:', e.message);
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

// Add type
router.post('/applications/types', checkPermission('app_types_edit'), async (req, res) => {
  try {
    const { application_type, title, description, requirements, image, status } = req.body;
    // حرية كاملة للإدارة (طلب المالك): أي اسم نوع مقبول — مسافات/عربي/رموز عادية —
    // والفحص للسلامة فقط: طول معقول بلا محارف تحكم أو رموز تكسر روابط المسار
    if (!application_type || String(application_type).trim().length === 0 || String(application_type).length > 100 ||
        /[/<>"'`\\\u0000-\u001f\u007f]/.test(application_type)) {
      return res.status(400).json({ error: 'النوع يحتوي رموزاً غير مسموحة أو يتجاوز 100 حرف' });
    }
    const [exists] = await db.query('SELECT id FROM application_settings WHERE application_type = ?', [application_type]);
    if (exists && exists.length) return res.status(400).json({ error: 'هذا النوع موجود بالفعل' });
    await db.query(
      'INSERT INTO application_settings (application_type, title, description, requirements, image, status) VALUES (?, ?, ?, ?, ?, ?)',
      [application_type, (title||'').substring(0,255), (description||'').substring(0,5000), (requirements||'').substring(0,5000), (image||'').substring(0,255), status === 'open' ? 'open' : 'closed']
    );
    res.json({ success: true });
  } catch(e) {
    console.error('Add type error:', e.message);
    res.status(500).json({ error: 'حدث خطأ' });
  }
});

// Update type
router.put('/applications/types/:id', checkPermission('app_types_edit'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { title, description, requirements, image, status } = req.body;
    await db.query(
      'UPDATE application_settings SET title = ?, description = ?, requirements = ?, image = ?, status = ?, updated_at = NOW() WHERE id = ?',
      [(title||'').substring(0,255), (description||'').substring(0,5000), (requirements||'').substring(0,5000), (image||'').substring(0,255), status === 'open' ? 'open' : 'closed', id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'حدث خطأ' }); }
});

// Toggle type status
router.post('/applications/types/status', checkPermission('app_types_edit'), async (req, res) => {
  try {
    const { application_type, status } = req.body;
    const s = ['open','closed'].includes(status) ? status : 'closed';
    await db.query('UPDATE application_settings SET status = ?, updated_at = NOW() WHERE application_type = ?', [s, application_type]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'حدث خطأ' }); }
});

// Delete type
router.delete('/applications/types/:id', checkPermission('app_types_edit'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [type] = await db.query('SELECT application_type FROM application_settings WHERE id = ?', [id]);
    if (!type || !type.length) return res.status(404).json({ error: 'غير موجود' });
    await db.query('DELETE FROM application_questions WHERE application_type = ?', [type[0].application_type]);
    await db.query('DELETE FROM application_settings WHERE id = ?', [id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'حدث خطأ' }); }
});

// ===== Roles & Permissions API =====

// Get all roles
router.get('/roles', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const [roles] = await db.execute('SELECT * FROM roles ORDER BY is_admin_role DESC, sort_order ASC, id ASC');
    const [perms] = await db.execute('SELECT * FROM role_permissions');
    const permissions = {};
    perms.forEach(p => {
      if (!permissions[p.role_id]) permissions[p.role_id] = {};
      permissions[p.role_id][p.page] = { can_access: p.can_access, can_edit: p.can_edit, can_delete: p.can_delete, can_manage: p.can_manage };
    });
    res.json({ roles, permissions });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create role
router.post('/roles', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    const { name, display_name, color, icon, description } = req.body;
    const [result] = await db.execute(
      'INSERT INTO roles (name, display_name, color, icon, description) VALUES (?, ?, ?, ?, ?)',
      [name, display_name, color || '#bc13fe', icon || 'fa-user', description || '']
    );
    const [role] = await db.execute('SELECT * FROM roles WHERE id = ?', [result.insertId]);
    res.json({ success: true, role: role[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Update role (advanced)
router.put('/roles/:id', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    const { name, display_name, color, icon, emoji, description, is_admin_role, is_protected, is_default, is_staff,
            can_assign_roles, page_permissions, element_permissions, punishments } = req.body;
    const roleId = req.params.id;

    // Owner role is fully protected
    const [targetRole] = await db.execute('SELECT name FROM roles WHERE id = ?', [roleId]);
    if (!targetRole.length) return res.status(404).json({ error: 'غير موجود' });
    if (targetRole[0].name === 'owner') {
      return res.status(403).json({ error: 'لا يمكن تعديل رتبة المالك' });
    }

    await db.execute(
      'UPDATE roles SET name=?, display_name=?, color=?, icon=?, emoji=?, description=?, is_admin_role=?, is_protected=?, is_default=?, is_staff=?, can_assign_roles=? WHERE id=?',
      [name, display_name, color, icon, emoji || '', description || '', is_admin_role || 0, is_protected || 0, is_default || 0, is_staff || 0, can_assign_roles || 0, roleId]
    );

    // Update page permissions
    if (page_permissions) {
      await db.execute('DELETE FROM role_page_permissions WHERE role_id = ?', [roleId]);
      for (const [page, perms] of Object.entries(page_permissions)) {
        await db.execute(
          'INSERT INTO role_page_permissions (role_id, page, can_view, can_create, can_edit, can_delete, can_manage, can_export, can_broadcast) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [roleId, page, perms.can_view||0, perms.can_create||0, perms.can_edit||0, perms.can_delete||0, perms.can_manage||0, perms.can_export||0, perms.can_broadcast||0]
        );
      }
    }

    // Update element permissions
    if (element_permissions) {
      await db.execute('DELETE FROM role_element_permissions WHERE role_id = ?', [roleId]);
      for (const key of Object.keys(element_permissions)) {
        const [page, element] = key.split(':');
        await db.execute(
          'INSERT INTO role_element_permissions (role_id, page, element_id, can_view, can_use) VALUES (?, ?, ?, 1, 1)',
          [roleId, page, element]
        );
      }
    }

    // Update punishments
    if (punishments) {
      await db.execute('DELETE FROM role_punishments WHERE role_id = ?', [roleId]);
      await db.execute(
        'INSERT INTO role_punishments (role_id, can_ban, can_mute, can_warn, can_kick, max_ban_level) VALUES (?, ?, ?, ?, ?, ?)',
        [roleId, punishments.can_ban||0, punishments.can_mute||0, punishments.can_warn||0, punishments.can_kick||0, punishments.max_ban_level||0]
      );
    }

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete role
router.delete('/roles/:id', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    const roleId = req.params.id;
    const [role] = await db.execute('SELECT * FROM roles WHERE id = ?', [roleId]);
    if (!role.length) return res.status(404).json({ error: 'غير موجود' });
    if (role[0].is_default) return res.status(400).json({ error: 'لا يمكن حذف الرتبة الافتراضية' });
    if (role[0].is_protected) return res.status(400).json({ error: 'هذه الرتبة محمية' });
    if (role[0].name === 'owner') return res.status(400).json({ error: 'لا يمكن حذف رتبة المالك' });

    await db.execute('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
    await db.execute('DELETE FROM role_page_permissions WHERE role_id = ?', [roleId]);
    await db.execute('DELETE FROM role_element_permissions WHERE role_id = ?', [roleId]);
    await db.execute('DELETE FROM role_punishments WHERE role_id = ?', [roleId]);
    await db.execute('DELETE FROM role_assignments WHERE role_id = ?', [roleId]);
    await db.execute('DELETE FROM role_role_permissions WHERE role_id = ?', [roleId]);
    await db.execute('DELETE FROM role_page_access WHERE role_id = ?', [roleId]);
    await db.execute('DELETE FROM roles WHERE id = ?', [roleId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get role members
router.get('/roles/:id/members', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const roleId = req.params.id;
    const [role] = await db.execute('SELECT name FROM roles WHERE id = ?', [roleId]);
    if (!role.length) return res.json({ members: [] });
    const [members] = await db.execute('SELECT id, username, profile_picture, discord_id, created_at FROM users WHERE TRIM(role) = ?', [role[0].name]);
    res.json({ members });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Assign role to user — DISABLED: use PATCH /api/admin/users/:id instead
router.post('/roles/:id/assign', checkPermission('roles_assign'), async (req, res) => {
  return res.status(403).json({ error: 'تم تعطيل هذا التعيين. استخدم صفحة إدارة المستخدمين (/admin/users) لتعيين الرتب' });
});

// Get user role permissions (for frontend use)
router.get('/user-permissions/:userId', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const [user] = await db.execute('SELECT role FROM users WHERE id = ?', [req.params.userId]);
    if (!user.length) return res.status(404).json({ error: 'غير موجود' });
    
    const [role] = await db.execute('SELECT * FROM roles WHERE name = ?', [user[0].role]);
    if (!role.length) return res.json({ permissions: {} });
    
    const [perms] = await db.execute('SELECT * FROM role_permissions WHERE role_id = ?', [role[0].id]);
    const permissions = {};
    perms.forEach(p => {
      permissions[p.page] = { can_access: p.can_access, can_edit: p.can_edit, can_delete: p.can_delete, can_manage: p.can_manage };
    });

    // Advanced page permissions
    let pagePerms = {};
    try {
      const [pp] = await db.execute('SELECT * FROM role_page_permissions WHERE role_id = ?', [role[0].id]);
      pp.forEach(p => {
        pagePerms[p.page] = { can_view: p.can_view, can_create: p.can_create, can_edit: p.can_edit, can_delete: p.can_delete, can_manage: p.can_manage, can_export: p.can_export, can_broadcast: p.can_broadcast };
      });
    } catch(e) {}

    // Element permissions
    let elemPerms = {};
    try {
      const [ep] = await db.execute('SELECT * FROM role_element_permissions WHERE role_id = ?', [role[0].id]);
      ep.forEach(p => { elemPerms[p.page + ':' + p.element_id] = { can_view: p.can_view, can_use: p.can_use }; });
    } catch(e) {}

    // Punishments
    let punish = {};
    try {
      const [pd] = await db.execute('SELECT * FROM role_punishments WHERE role_id = ?', [role[0].id]);
      if (pd.length) punish = pd[0];
    } catch(e) {}

    // Unified permissions
    let unifiedPerms = {};
    try {
      const [up] = await db.execute('SELECT permission_key, enabled FROM role_role_permissions WHERE role_id = ?', [role[0].id]);
      up.forEach(p => { unifiedPerms[p.permission_key] = p.enabled; });
    } catch(e) {}

    // Side roles
    let sideRoles = [];
    try {
      const [sr] = await db.execute(
        'SELECT sr.* FROM side_roles sr JOIN user_side_roles usr ON sr.id = usr.side_role_id WHERE usr.user_id = ?',
        [req.params.userId]
      );
      sideRoles = sr;
    } catch(e) {}

    res.json({ role: role[0], permissions, pagePerms, elemPerms, punish, unifiedPerms, sideRoles });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Unified Permissions API =====

// Get all permissions for a role
router.get('/roles/:id/all-permissions', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const roleId = req.params.id;
    const [perms] = await db.execute('SELECT permission_key, enabled FROM role_role_permissions WHERE role_id = ?', [roleId]);
    const result = {};
    perms.forEach(p => { result[p.permission_key] = p.enabled; });
    res.json({ permissions: result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Save all permissions for a role (bulk replace)
router.post('/roles/:id/all-permissions', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    const roleId = req.params.id;
    const { permissions } = req.body;

    // Owner role permissions can't be changed
    const [targetRole] = await db.execute('SELECT name FROM roles WHERE id = ?', [roleId]);
    if (!targetRole.length) return res.status(404).json({ error: 'غير موجود' });
    if (targetRole[0].name === 'owner') {
      return res.status(403).json({ error: 'لا يمكن تعديل صلاحيات رتبة المالك' });
    }

    await db.execute('DELETE FROM role_role_permissions WHERE role_id = ?', [roleId]);
    if (permissions && typeof permissions === 'object') {
      for (const [key, enabled] of Object.entries(permissions)) {
        if (key && typeof enabled === 'number') {
          await db.execute(
            'INSERT INTO role_role_permissions (role_id, permission_key, enabled) VALUES (?, ?, ?)',
            [roleId, key, enabled ? 1 : 0]
          );
        }
      }
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Side Roles API =====

// Get all side roles
router.get('/side-roles', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const [roles] = await db.execute('SELECT * FROM side_roles ORDER BY sort_order ASC, id ASC');
    res.json({ sideRoles: roles });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create side role
router.post('/side-roles', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    const { name, display_name, color, icon, emoji } = req.body;
    if (!name || !display_name) return res.status(400).json({ error: 'الاسم مطلوب' });
    const [result] = await db.execute(
      'INSERT INTO side_roles (name, display_name, color, icon, emoji) VALUES (?, ?, ?, ?, ?)',
      [name, display_name, color || '#bc13fe', icon || 'fa-tag', emoji || '']
    );
    const [role] = await db.execute('SELECT * FROM side_roles WHERE id = ?', [result.insertId]);
    res.json({ success: true, sideRole: role[0] });
  } catch(e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'اسم الدور موجود مسبقاً' });
    res.status(500).json({ error: e.message });
  }
});

// Update side role
router.put('/side-roles/:id', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    const { name, display_name, color, icon, emoji, is_active, sort_order } = req.body;
    await db.execute(
      'UPDATE side_roles SET name=?, display_name=?, color=?, icon=?, emoji=?, is_active=?, sort_order=? WHERE id=?',
      [name, display_name, color || '#bc13fe', icon || 'fa-tag', emoji || '', is_active !== undefined ? is_active : 1, sort_order || 0, req.params.id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete side role
router.delete('/side-roles/:id', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    await db.execute('DELETE FROM user_side_roles WHERE side_role_id = ?', [req.params.id]);
    await db.execute('DELETE FROM side_roles WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Assign side role to user
router.post('/side-roles/:id/assign', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });
    await db.execute(
      'INSERT IGNORE INTO user_side_roles (user_id, side_role_id, assigned_by, assigned_at) VALUES (?, ?, ?, NOW())',
      [user_id, req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Remove side role from user
router.post('/side-roles/:id/unassign', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });
    await db.execute('DELETE FROM user_side_roles WHERE user_id = ? AND side_role_id = ?', [user_id, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get users with a side role
router.get('/side-roles/:id/members', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const [members] = await db.execute(
      'SELECT u.id, u.username, u.profile_picture FROM users u JOIN user_side_roles usr ON u.id = usr.user_id WHERE usr.side_role_id = ?',
      [req.params.id]
    );
    res.json({ members });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get side roles for a user
router.get('/users/:id/side-roles', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const [roles] = await db.execute(
      'SELECT sr.* FROM side_roles sr JOIN user_side_roles usr ON sr.id = usr.side_role_id WHERE usr.user_id = ?',
      [req.params.id]
    );
    res.json({ sideRoles: roles });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Reorder roles
router.post('/roles/reorder', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order مطلوب' });
    for (const item of order) {
      await db.execute('UPDATE roles SET sort_order = ? WHERE id = ?', [item.sort_order, item.id]);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Page Access API =====

// Get page access for a role
router.get('/roles/:id/page-access', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT page_path, can_access FROM role_page_access WHERE role_id = ?', [req.params.id]);
    const access = {};
    rows.forEach(r => { access[r.page_path] = r.can_access; });
    res.json({ access });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Save page access for a role (bulk)
router.post('/roles/:id/page-access', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    const roleId = req.params.id;
    const { pages } = req.body;

    // Owner role page access can't be changed
    const [targetRole] = await db.execute('SELECT name FROM roles WHERE id = ?', [roleId]);
    if (!targetRole.length) return res.status(404).json({ error: 'غير موجود' });
    if (targetRole[0].name === 'owner') {
      return res.status(403).json({ error: 'لا يمكن تعديل صلاحيات رتبة المالك' });
    }

    await db.execute('DELETE FROM role_page_access WHERE role_id = ?', [roleId]);
    if (pages && typeof pages === 'object') {
      for (const [path, canAccess] of Object.entries(pages)) {
        if (path) {
          await db.execute(
            'INSERT INTO role_page_access (role_id, page_path, can_access) VALUES (?, ?, ?)',
            [roleId, path, canAccess ? 1 : 0]
          );
        }
      }
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get all pages access for all roles (for rendering)
router.get('/page-access-all', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT role_id, page_path, can_access FROM role_page_access');
    const result = {};
    rows.forEach(r => {
      if (!result[r.role_id]) result[r.role_id] = {};
      result[r.role_id][r.page_path] = r.can_access;
    });
    res.json({ pageAccess: result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Side Role Permissions API =====

router.get('/side-roles/:id/permissions', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const [perms] = await db.execute('SELECT permission_key, enabled FROM side_role_permissions WHERE side_role_id = ?', [req.params.id]);
    const result = {};
    perms.forEach(p => { result[p.permission_key] = p.enabled; });
    res.json({ permissions: result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/side-roles/:id/permissions', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    const { permissions } = req.body;
    await db.execute('DELETE FROM side_role_permissions WHERE side_role_id = ?', [req.params.id]);
    if (permissions && typeof permissions === 'object') {
      for (const [key, enabled] of Object.entries(permissions)) {
        if (key) {
          await db.execute('INSERT INTO side_role_permissions (side_role_id, permission_key, enabled) VALUES (?, ?, ?)', [req.params.id, key, enabled ? 1 : 0]);
        }
      }
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/side-roles/:id/page-access', checkPermission('roles_config_view'), async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT page_path, can_access FROM side_role_page_access WHERE side_role_id = ?', [req.params.id]);
    const result = {};
    rows.forEach(r => { result[r.page_path] = r.can_access; });
    res.json({ pageAccess: result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/side-roles/:id/page-access', checkPermission('roles_config_edit'), async (req, res) => {
  try {
    const { pages } = req.body;
    await db.execute('DELETE FROM side_role_page_access WHERE side_role_id = ?', [req.params.id]);
    if (pages && typeof pages === 'object') {
      for (const [path, canAccess] of Object.entries(pages)) {
        if (path) {
          await db.execute('INSERT INTO side_role_page_access (side_role_id, page_path, can_access) VALUES (?, ?, ?)', [req.params.id, path, canAccess ? 1 : 0]);
        }
      }
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Profile API - Send Warning
router.post('/profile/warnings', async (req, res) => {
  try {
    const { user_id, reason } = req.body;

    // Owner can do anything
    if (req.user.role !== 'owner') {
      const [role] = await db.execute('SELECT id, is_admin_role FROM roles WHERE name = ?', [req.user.role]);
      if (!role.length) return res.status(403).json({ error: 'غير مصرح' });
      if (!role[0].is_admin_role) {
        const [perm] = await db.execute('SELECT enabled FROM role_role_permissions WHERE role_id = ? AND permission_key = "admin_profile_warn"', [role[0].id]);
        if (!perm.length || !perm[0].enabled) return res.status(403).json({ error: 'ليس لديك صلاحية لإرسال تحذيرات' });
      }
    }

    const [target] = await db.execute('SELECT username FROM users WHERE id = ?', [user_id]);
    await db.execute('INSERT INTO admin_warnings (user_id, username, issued_by, issuer_name, reason) VALUES (?, ?, ?, ?, ?)',
      [user_id, target[0]?.username || '', req.user.id, req.user.username, reason]);
    await db.execute('INSERT INTO admin_profile_logs (user_id, username, action, target_name, details) VALUES (?, ?, ?, ?, ?)',
      [user_id, target[0]?.username || '', 'تحذير', req.user.username, reason]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Profile API - Delete Warning
router.delete('/profile/warnings/:id', async (req, res) => {
  try {
    if (req.user.role !== 'owner') {
      const [role] = await db.execute('SELECT id, is_admin_role FROM roles WHERE name = ?', [req.user.role]);
      if (!role.length) return res.status(403).json({ error: 'غير مصرح' });
      if (!role[0].is_admin_role) {
        const [perm] = await db.execute('SELECT enabled FROM role_role_permissions WHERE role_id = ? AND permission_key = "admin_profile_warn"', [role[0].id]);
        if (!perm.length || !perm[0].enabled) return res.status(403).json({ error: 'ليس لديك صلاحية' });
      }
    }
    await db.execute('UPDATE admin_warnings SET is_deleted = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Profile API - Submit Excuse
router.post('/profile/excuses', async (req, res) => {
  try {
    const { user_id, reason, start_date, end_date } = req.body;
    const [target] = await db.execute('SELECT username FROM users WHERE id = ?', [user_id]);
    await db.execute('INSERT INTO admin_excuses (user_id, username, reason, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
      [user_id, target[0]?.username || '', reason, start_date, end_date]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Profile API - Review Excuse
router.post('/profile/excuses/:id/review', checkPermission('admin_profile_view'), async (req, res) => {
  try {
    const { status, reviewer_note } = req.body;
    await db.execute('UPDATE admin_excuses SET status = ?, reviewer_id = ?, reviewer_name = ?, reviewer_note = ?, reviewed_at = NOW() WHERE id = ?',
      [status, req.user.id, req.user.username, reviewer_note || '', req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Bot Actions (Website → Discord) =====
router.post('/bot/action', checkPermission('admin_manage'), async (req, res) => {
  try {
    const { action, target_discord_id, target_name, reason, duration_minutes, role_name } = req.body;
    if (!action || !target_discord_id) {
      return res.status(400).json({ error: 'action and target_discord_id are required' });
    }
    const validActions = ['ban', 'unban', 'kick', 'mute', 'unmute', 'warn', 'add_role', 'remove_role'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    const [result] = await db.execute(
      'INSERT INTO bot_actions (action, target_discord_id, target_name, reason, duration_minutes, role_name, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [action, target_discord_id, target_name || '', reason || '', duration_minutes || 0, role_name || '', 'pending', req.user.id]
    );
    res.json({ success: true, id: result.insertId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/bot/actions', checkPermission('admin_manage'), async (req, res) => {
  try {
    const [actions] = await db.execute('SELECT * FROM bot_actions ORDER BY created_at DESC LIMIT 50');
    res.json({ success: true, actions });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/bot/actions/pending', checkPermission('admin_manage'), async (req, res) => {
  try {
    const [actions] = await db.execute('SELECT * FROM bot_actions WHERE status IN (?, ?) ORDER BY created_at ASC', ['pending', 'processing']);
    res.json({ success: true, actions });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/bot/actions/:id', checkPermission('admin_manage'), async (req, res) => {
  try {
    await db.execute('DELETE FROM bot_actions WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
