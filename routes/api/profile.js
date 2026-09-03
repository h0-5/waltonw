const express = require('express');
const router = express.Router();
const db = require('../../config/database');

// Update profile
router.post('/update', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'غير مصرح' });

  const { username } = req.body;
  if (!username || username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: 'اسم المستخدم يجب أن يكون بين 3 و 30 حرف' });
  }

  const usernameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ error: 'اسم المستخدم يحتوي على أحرف غير مسموحة' });
  }

  try {
    const [existing] = await db.execute(
      'SELECT id FROM users WHERE username = ? AND id != ?',
      [username, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل' });
    }

    await db.execute('UPDATE users SET username = ? WHERE id = ?', [username, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'فشل التحديث' });
  }
});

module.exports = router;
