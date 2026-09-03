const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Submit support ticket
router.post('/submit', async (req, res) => {
  const { name, email, subject, message, priority } = req.body;

  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }

  try {
    const [result] = await db.execute(
      'INSERT INTO support_tickets (user_id, name, email, subject, message, priority, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [req.user ? req.user.id : null, name, email, subject, message, priority || 'medium', 'open']
    );

    res.json({ success: true, ticket_id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: 'فشل إرسال التذكرة' });
  }
});

module.exports = router;
