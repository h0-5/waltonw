const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Admin Users API
router.post('/users/update', async (req, res) => {
  const { user_id, username, email } = req.body;
  try {
    await db.execute('UPDATE users SET username = ?, email = ? WHERE id = ?', [username, email, user_id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/role', async (req, res) => {
  const { user_id, role } = req.body;
  try {
    await db.execute('UPDATE users SET role = ? WHERE id = ?', [role, user_id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/ban', async (req, res) => {
  const { user_id } = req.body;
  try {
    await db.execute('UPDATE users SET is_banned = 1 WHERE id = ?', [user_id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/users/unban', async (req, res) => {
  const { user_id } = req.body;
  try {
    await db.execute('UPDATE users SET is_banned = 0 WHERE id = ?', [user_id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin Products API
router.post('/products/add', async (req, res) => {
  const { name, description, category_type, price_points, price_money, stock } = req.body;
  try {
    await db.execute(
      'INSERT INTO fs_products (name, description, category_type, price_points, price_money, stock, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [name, description, category_type, price_points || 0, price_money || 0, stock || 0]
    );
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/products/delete', async (req, res) => {
  const { product_id } = req.body;
  try {
    await db.execute('DELETE FROM fs_products WHERE id = ?', [product_id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin Settings API
router.post('/settings', async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await db.execute(
        'INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
        [key, value, value]
      );
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Notifications API
router.get('/notifications', async (req, res) => {
  if (!req.user) return res.json({ notifications: [] });
  try {
    const [notifications] = await db.execute(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    res.json({ notifications });
  } catch(e) { res.json({ notifications: [] }); }
});

router.post('/notifications/read', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await db.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Orders API
router.post('/orders/create', async (req, res) => {
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
router.post('/rules', async (req, res) => {
  try {
    const { category, rule_text, sort_order } = req.body;
    await db.execute('INSERT INTO rules (category, rule_text, sort_order) VALUES (?, ?, ?)', [category, rule_text, sort_order || 0]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/rules/:id', async (req, res) => {
  try {
    await db.execute('DELETE FROM rules WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Discounts API
router.post('/discounts', async (req, res) => {
  try {
    const { code, discount_percent, max_uses, expires_at } = req.body;
    await db.execute('INSERT INTO discount_codes (code, discount_percent, max_uses, expires_at) VALUES (?, ?, ?, ?)',
      [code, discount_percent, max_uses || null, expires_at || null]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/discounts/:id', async (req, res) => {
  try {
    await db.execute('DELETE FROM discount_codes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Users Unban API (by URL param)
router.post('/users/:id/unban', async (req, res) => {
  try {
    await db.execute('UPDATE users SET is_banned = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Broadcast API
router.post('/broadcast', async (req, res) => {
  try {
    const { title, message, target } = req.body;
    let whereClause = '';
    if (target === 'admins') whereClause = "AND role IN ('owner','developer','founder','moderator','support')";
    else if (target === 'family') whereClause = "AND role != 'user'";
    
    const [users] = await db.execute(`SELECT id FROM users WHERE 1=1 ${whereClause}`);
    for (const u of users) {
      await db.execute('INSERT INTO notifications (user_id, title, message, is_read, created_at) VALUES (?, ?, ?, 0, NOW())',
        [u.id, title || 'إشعار عام', message]);
    }
    res.json({ success: true, sent: users.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// About Content API
router.post('/about', async (req, res) => {
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

module.exports = router;
