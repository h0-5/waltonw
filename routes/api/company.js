/*
 * APIs خدمات الشركة (طلبات الخدمات المفتوحة — ملابس/سيارات/خدمات مستقبلية)
 * POST /service-request : تقديم طلب مع إجابات الأسئلة + صور (FormData)
 * GET  /my-requests     : طلبات المستخدم مع حالاتها
 * الإشعارات: ويبهوك قناة الشركة + تنبيه للإدارة عند كل طلب جديد
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../../config/database');
const { isAuthenticated } = require('../../middleware/auth');
const { sendWebhook } = require('../../utils/webhooks');
const webhooks = require('../../config/webhooks');

const REQ_STATUS_AR = { pending: 'بانتظار المراجعة', approved: 'مقبول', rejected: 'مرفوض' };
const MAX_PENDING_PER_USER = 5;

function notifyCompany(payload) {
  const key = webhooks.WH_COMPANY ? 'WH_COMPANY' : (webhooks.WH_FARM ? 'WH_FARM' : null);
  if (!key) return;
  sendWebhook(key, Object.assign({ footer: 'Walton Family — Company Services' }, payload)).catch(() => {});
}

function toIso(s) {
  if (!s) return null;
  if (s instanceof Date) return s.toISOString();
  const d = new Date(String(s).replace(' ', 'T') + '+03:00');
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function parseAnswers(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

/* ── تقديم طلب خدمة ── */
router.post('/service-request', isAuthenticated, async (req, res) => {
  try {
    const serviceId = parseInt(req.body.service_id);
    if (!serviceId) return res.status(400).json({ error: 'خدمة غير محددة' });

    const [svc] = await db.execute('SELECT id, title, service_status FROM company_items WHERE id = ?', [serviceId]);
    if (!svc.length) return res.status(404).json({ error: 'الخدمة غير موجودة' });
    if (svc[0].service_status === 'coming_soon') return res.status(400).json({ error: 'هذه الخدمة قريباً — غير متاحة حالياً' });
    if (svc[0].service_status === 'ended') return res.status(400).json({ error: 'هذه الخدمة منتهية حالياً' });

    // حد طلبات معلقة لكل مستخدم (ضد السبام)
    const [pend] = await db.execute(
      "SELECT COUNT(*) AS n FROM service_requests WHERE user_id = ? AND status = 'pending'", [req.user.id]);
    if (Number(pend[0].n) >= MAX_PENDING_PER_USER) {
      return res.status(400).json({ error: `عندك ${MAX_PENDING_PER_USER} طلبات بانتظار المراجعة — انتظر رد الإدارة قبل تقديم طلب جديد` });
    }

    // البكج (اختياري)
    let packageId = parseInt(req.body.package_id) || 0;
    let totalPrice = 0;
    if (packageId) {
      const [pk] = await db.execute('SELECT id, price FROM service_packages WHERE id = ? AND service_id = ?', [packageId, serviceId]);
      if (!pk.length) packageId = 0;
      else totalPrice = Number(pk[0].price) || 0;
    }

    // أسئلة الخدمة → إجابات حقيقية (نصوص + صور)
    const [qs] = await db.execute('SELECT * FROM service_questions WHERE service_id = ? ORDER BY sort_order ASC, id ASC', [serviceId]);
    const answers = [];
    const uploadDir = path.join(__dirname, '../../public/uploads/company');
    for (const q of qs) {
      if (q.type === 'image') {
        const file = req.files && req.files['sq_' + q.id];
        if (file && file.size > 0) {
          const ext = String(file.name || 'img.png').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
          const fname = 'req_' + Date.now() + '_' + Math.floor(Math.random() * 1e4) + '.' + ext;
          fs.mkdirSync(uploadDir, { recursive: true });
          await file.mv(path.join(uploadDir, fname));
          answers.push({ q: q.question, a: '/uploads/company/' + fname, type: 'image' });
        } else {
          answers.push({ q: q.question, a: '', type: 'image' });
        }
      } else {
        const v = String(req.body['sq_' + q.id] || '').trim().slice(0, 1000);
        if (Number(q.required) === 1 && !v) {
          return res.status(400).json({ error: 'أكمل الإجابة على: ' + q.question });
        }
        if (v) answers.push({ q: q.question, a: v, type: q.type === 'character_name' ? 'character_name' : 'text' });
      }
    }

    const [ins] = await db.execute(
      'INSERT INTO service_requests (service_id, user_id, answers, status, total_price, package_id) VALUES (?, ?, ?, ?, ?, ?)',
      [serviceId, req.user.id, JSON.stringify(answers), 'pending', totalPrice, packageId || 0]);

    // ويبهوك للإدارة
    const detail = answers.filter(a => a.type !== 'image' && a.a)
      .map(a => `${a.q}: ${a.a}`).join('\n') || '—';
    const imgsCount = answers.filter(a => a.type === 'image' && a.a).length;
    notifyCompany({
      title: '🛎️ طلب خدمة جديد — ' + svc[0].title,
      color: 0xbc13fe,
      description: detail !== '—' ? detail.substring(0, 500) : '',
      fields: [
        { name: 'رقم الطلب', value: '#' + ins.insertId, inline: true },
        { name: 'المستخدم', value: String(req.user.username || ''), inline: true }
      ].concat(imgsCount ? [{ name: 'مرفقات', value: imgsCount + ' صورة — تشوفها بلوحة الإدارة', inline: false }] : [])
        .concat([{ name: 'المراجعة', value: 'لوحة الإدارة ← الشركة ← طلبات الخدمة', inline: false }])
    });

    res.json({ success: true, id: ins.insertId, message: 'تم إرسال طلبك بنجاح — راح تراجع الإدارة ويتواصلون معك' });
  } catch (e) {
    console.error('[company-api] service-request:', e.message);
    res.status(500).json({ error: 'خطأ بإرسال الطلب' });
  }
});

/* ── طلباتي ── */
router.get('/my-requests', isAuthenticated, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT sr.id, sr.answers, sr.status, sr.total_price, sr.created_at, ci.title AS service_title
       FROM service_requests sr LEFT JOIN company_items ci ON sr.service_id = ci.id
       WHERE sr.user_id = ? ORDER BY sr.id DESC LIMIT 20`, [req.user.id]);
    res.json(rows.map(r => ({
      id: r.id,
      service_title: r.service_title || 'خدمة',
      status: r.status,
      statusLabel: REQ_STATUS_AR[r.status] || r.status,
      total_price: Number(r.total_price) || 0,
      answers: parseAnswers(r.answers),
      created_iso: toIso(r.created_at)
    })));
  } catch (e) {
    console.error('[company-api] my-requests:', e.message);
    res.status(500).json({ error: 'خطأ بجلب طلباتك' });
  }
});

module.exports = router;
