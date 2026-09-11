/*
 * APIs جرس الإشعارات (نافبار) — نفس مثيل البيانات الذي تكتب فيه الإدارة
 * GET  /            : آخر 20 إشعار للمستخدم (+ ?badge=1 يرجع عدد غير المقروء فقط — استعلام خفيف للبادج)
 * POST /read        : تعليم كل إشعارات المستخدم مقروءة
 * POST /delete-all  : حذف كل إشعارات المستخدم
 * ملاحظة: انفصل عن راوتر الإدارة لأن app.use كان يضاعف المسار (/api/notifications/notifications)
 */
const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { isAuthenticated } = require('../../middleware/auth');

router.get('/', isAuthenticated, async (req, res) => {
  if (!req.user) return res.json({ notifications: [], unread: 0 });
  try {
    /* ?badge=1 — عدد غير المقروء فقط (بادج الجرس عند تحميل الصفحة — أرشق للقاعدة) */
    if (req.query.badge === '1') {
      try {
        const [c] = await db.execute('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]);
        return res.json({ unread: Number(c[0].n) || 0 });
      } catch (e) { return res.json({ unread: 0 }); }
    }
    const [notifications] = await db.execute(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [req.user.id]
    );
    const unread = notifications.filter(n => !Number(n.is_read)).length;
    res.json({ notifications, unread });
  } catch (e) {
    console.error('[notifications-api] list:', e.code || '', e.message);
    res.json({ notifications: [], unread: 0 });
  }
});

router.post('/read', isAuthenticated, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await db.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/delete-all', isAuthenticated, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await db.execute('DELETE FROM notifications WHERE user_id = ?', [req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
