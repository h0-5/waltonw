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

// ═══════════════════════════════════════════
// Application Management APIs
// ═══════════════════════════════════════════
const { isAdmin } = require('../../middleware/auth');
const path = require('path');
const fs = require('fs');

// Approve application
router.post('/applications/:id/approve', isAdmin, async (req, res) => {
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
      await db.query('UPDATE users SET role = ? WHERE id = ?', [typeSetting[0].site_role, app[0].user_id]);
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
router.post('/applications/:id/reject', isAdmin, async (req, res) => {
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
router.post('/applications/:id/delete', isAdmin, async (req, res) => {
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
router.get('/applications/questions/:type', isAdmin, async (req, res) => {
  try {
    const type = req.params.type;
    const [qs] = await db.query('SELECT * FROM application_questions WHERE application_type = ? ORDER BY order_index ASC, sort_order ASC', [type]);
    res.json(qs);
  } catch(e) { res.json([]); }
});

// Add question
router.post('/applications/questions', isAdmin, async (req, res) => {
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
router.delete('/applications/questions/:id', isAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'رقم غير صحيح' });
    await db.query('DELETE FROM application_questions WHERE id = ?', [id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'حدث خطأ' }); }
});

// Get settings for type
router.get('/applications/settings/:type', isAdmin, async (req, res) => {
  try {
    const [s] = await db.query('SELECT * FROM application_settings WHERE application_type = ? LIMIT 1', [req.params.type]);
    res.json(s && s.length ? s[0] : {});
  } catch(e) { res.json({}); }
});

// Update settings for type
router.put('/applications/settings/:type', isAdmin, async (req, res) => {
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
router.post('/applications/types', isAdmin, async (req, res) => {
  try {
    const { application_type, title, description, requirements, image, status } = req.body;
    if (!application_type || !/^[a-zA-Z0-9_\-]+$/.test(application_type)) {
      return res.status(400).json({ error: 'النوع يجب أن يحتوي على أحرف إنجليزية وأرقام فقط' });
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
router.put('/applications/types/:id', isAdmin, async (req, res) => {
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
router.post('/applications/types/status', isAdmin, async (req, res) => {
  try {
    const { application_type, status } = req.body;
    const s = ['open','closed'].includes(status) ? status : 'closed';
    await db.query('UPDATE application_settings SET status = ?, updated_at = NOW() WHERE application_type = ?', [s, application_type]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'حدث خطأ' }); }
});

// Delete type
router.delete('/applications/types/:id', isAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [type] = await db.query('SELECT application_type FROM application_settings WHERE id = ?', [id]);
    if (!type || !type.length) return res.status(404).json({ error: 'غير موجود' });
    await db.query('DELETE FROM application_questions WHERE application_type = ?', [type[0].application_type]);
    await db.query('DELETE FROM application_settings WHERE id = ?', [id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'حدث خطأ' }); }
});

module.exports = router;
