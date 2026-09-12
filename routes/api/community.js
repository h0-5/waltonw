const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Get messages
router.get('/messages', async (req, res) => {
  try {
    const lastId = parseInt(req.query.lastId) || 0;
    const [messages] = await db.execute(`
      SELECT cm.*, u.username, u.avatar, u.role 
      FROM community_messages cm 
      LEFT JOIN users u ON cm.user_id = u.id 
      WHERE cm.id > ? 
      ORDER BY cm.created_at ASC 
      LIMIT 50
    `, [lastId]);
    res.json({ messages });
  } catch (err) {
    res.json({ messages: [] });
  }
});

// Send message
router.post('/send', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'غير مصرح' });

  const { message } = req.body;
  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'الرسالة فارغة' });
  }

  if (message.length > 1000) {
    return res.status(400).json({ error: 'الرسالة طويلة جداً' });
  }

  try {
    const [result] = await db.execute(
      'INSERT INTO community_messages (channel_id, user_id, message, created_at) VALUES (?, ?, ?, NOW())',
      ['general', req.user.id, message.trim()]
    );

    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: 'فشل الإرسال' });
  }
});

// Get online users
router.get('/online', async (req, res) => {
  try {
    const [users] = await db.execute(`
      SELECT id, username, avatar, role 
      FROM users 
      WHERE last_login > DATE_SUB(NOW(), INTERVAL 30 MINUTE) 
      ORDER BY username ASC 
      LIMIT 50
    `);
    res.json({ users });
  } catch (err) {
    res.json({ users: [] });
  }
});

module.exports = router;
