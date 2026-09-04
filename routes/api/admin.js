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

router.post('/products/edit', async (req, res) => {
  const { product_id, name, description, category_type, price_points, price_money, stock, image } = req.body;
  try {
    await db.execute(
      'UPDATE fs_products SET name=?, description=?, category_type=?, price_points=?, price_money=?, stock=?, image=? WHERE id=?',
      [name, description, category_type, price_points || 0, price_money || 0, stock || 0, image || null, product_id]
    );
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

// Properties API
router.post('/properties', async (req, res) => {
  try {
    const { title, category, sort_order, image_url } = req.body;
    let image = image_url || '';
    if (req.files && req.files.image_file) {
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

router.delete('/properties/:id', async (req, res) => {
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
router.post('/company/items', async (req, res) => {
  try {
    const { title, description, category, video_url, service_status } = req.body;
    let image = '';
    if (req.files && req.files.image_file) {
      const file = req.files.image_file;
      const ext = file.name.split('.').pop();
      const fname = 'co_' + Date.now() + '.' + ext;
      const uploadDir = require('path').join(__dirname, '../../public/uploads/company');
      require('fs').mkdirSync(uploadDir, { recursive: true });
      await file.mv(uploadDir + '/' + fname);
      image = '/uploads/company/' + fname;
    }
    await db.execute('INSERT INTO company_items (title, description, image, video_url, category, service_status, sort_order) VALUES (?, ?, ?, ?, ?, ?, 0)',
      [title, description || '', image, video_url || '', category || 'info', service_status || null]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/company/items/:id', async (req, res) => {
  try {
    await db.execute('DELETE FROM service_questions WHERE service_id = ?', [req.params.id]);
    await db.execute('DELETE FROM service_packages WHERE service_id = ?', [req.params.id]);
    await db.execute('DELETE FROM company_items WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Company Service Request Actions
router.post('/company/requests/:id/approve', async (req, res) => {
  try {
    await db.execute("UPDATE service_requests SET status = 'approved', reviewed_at = NOW() WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/company/requests/:id/reject', async (req, res) => {
  try {
    await db.execute("UPDATE service_requests SET status = 'rejected', reviewed_at = NOW() WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Service Request from user
router.post('/service-request', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
    const { service_id, package_id } = req.body;
    await db.execute('INSERT INTO service_requests (service_id, user_id, answers, status, total_price, package_id) VALUES (?, ?, ?, ?, ?, ?)',
      [service_id, req.user.id, JSON.stringify([]), 'pending', 0, package_id || 0]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
