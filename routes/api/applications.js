const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../../config/database');
const { isAuthenticated } = require('../../middleware/auth');
const { sendWebhook } = require('../../utils/webhooks');

const UPLOAD_DIR = path.join(__dirname, '../../public/uploads/applications');
const EXT_MAP = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

router.post('/submit', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (!user || !user.discord_id) {
      return res.status(400).json({ success: false, error: 'يجب تسجيل الدخول عبر ديسكورد أولاً' });
    }

    const type = (req.body && req.body.type || '').trim();
    if (!type) {
      return res.status(400).json({ success: false, error: 'نوع التقديم غير محدد' });
    }

    const [appSettings] = await db.execute(
      'SELECT * FROM application_settings WHERE application_type = ?',
      [type]
    );
    if (!appSettings.length) {
      return res.status(404).json({ success: false, error: 'التقديم غير موجود' });
    }
    if (appSettings[0].status !== 'open') {
      return res.status(400).json({ success: false, error: 'التقديم مغلق حالياً' });
    }

    let pending = [];
    try {
      pending = (await db.execute(
        "SELECT id FROM submitted_applications WHERE user_id = ? AND application_type = ? AND status = 'pending'",
        [user.id, type]
      ))[0];
    } catch (e) {}
    if (pending.length) {
      return res.status(400).json({ success: false, error: 'لديك طلب معلق قيد المراجعة بالفعل' });
    }

    let rejected = [];
    try {
      rejected = (await db.execute(
        'SELECT cooldown_until FROM submitted_applications WHERE user_id = ? AND application_type = ? AND status = "rejected" ORDER BY id DESC LIMIT 1',
        [user.id, type]
      ))[0];
    } catch (e) {}
    if (rejected.length && rejected[0].cooldown_until && new Date(rejected[0].cooldown_until) > new Date()) {
      return res.status(400).json({ success: false, error: 'فترة التهدئة ما زالت نشطة لطلبك السابق' });
    }

    const [questions] = await db.execute(
      'SELECT id, type, required, options, max_selections FROM application_questions WHERE application_type = ?',
      [type]
    );

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const answers = {};

    for (const q of questions) {
      const qid = String(q.id);
      const single = req.body['answers[' + qid + ']'];
      const multi = req.body['answers_multiple[' + qid + '][]'];
      const imgUrl = (req.body['answers_img_url[' + qid + ']'] || '').trim();
      const file = req.files && req.files['answers_img_' + qid];

      if (file) {
        const ext = EXT_MAP[file.mimetype] || '.png';
        const fname = 'app_' + user.id + '_' + Date.now() + '_' + qid + ext;
        await file.mv(path.join(UPLOAD_DIR, fname));
        answers[qid] = '/uploads/applications/' + fname;
      } else if (imgUrl) {
        answers[qid] = imgUrl;
      } else if (multi) {
        answers[qid] = Array.isArray(multi) ? multi : [multi];
      } else if (single !== undefined && single !== '') {
        answers[qid] = single;
      }
    }

    await db.execute(
      'INSERT INTO submitted_applications (user_id, application_type, answers, status, created_at) VALUES (?, ?, ?, ?, NOW())',
      [user.id, type, JSON.stringify(answers), 'pending']
    );

    sendWebhook('WH_APPLICATIONS', {
      title: '📝 تقديم جديد',
      description: `**${user.username}** أرسل طلباً جديداً`,
      color: 0x780ecf,
      fields: [{ name: 'النوع', value: type, inline: true }, { name: 'الحالة', value: 'معلق', inline: true }]
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[applications submit]', err.message);
    return res.status(500).json({ success: false, error: 'حدث خطأ أثناء إرسال الطلب، حاول مرة أخرى' });
  }
});

module.exports = router;