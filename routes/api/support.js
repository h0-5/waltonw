/**
 * routes/api/support.js — API تذاكر المستخدم
 * نموذج جديد: قسم (بدل الأولوية) + رسالة ≥20 حرف + صور مرفقة مفحوصة أمنياً
 * القائمة السوداء تفحص قبل كل شيء: شاملة (كل الأقسام) أو قسم محدد،
 * بالمستخدم أو discord_id أو الاسم (يشمل حتى لو انضاف مستقبلاً بنفس الاسم)
 */

const express = require('express');
const { strictLimiter } = require('../../middleware/rateLimiter');
const router = express.Router();
const db = require('../../config/database');
const path = require('path');
const fs = require('fs');
const { sanitizeImage, randomName } = require('../../utils/image-safety');

const MIN_MESSAGE = 20;
const MAX_MESSAGE = 5000;
const MAX_IMAGES = 3;
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'tickets');

/**
 * فحص القائمة السوداء — يرجع صف الحظر أو null
 */
async function getBlacklistHit(discordId, userId, username, categoryId) {
  const [rows] = await db.execute(
    `SELECT * FROM ticket_blacklist
      WHERE (category_id IS NULL OR category_id = ?)
        AND (
          (user_id IS NOT NULL AND user_id = ?)
          OR (discord_id IS NOT NULL AND discord_id = ?)
          OR (username IS NOT NULL AND username = ?)
        )
      ORDER BY (category_id IS NULL) DESC
      LIMIT 1`,
    [categoryId || 0, userId || 0, discordId || '', username || '']
  );
  return rows.length ? rows[0] : null;
}

// Submit support ticket — strictLimiter (v21 audit 1549242103588986951): 5 طلبات/دقيقة ضد سبام النماذج فوق الدرع العام
router.post('/submit', strictLimiter, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'سجل دخول أولاً' });

  const { category_id, message } = req.body;
  const cleanMessage = (message || '').trim();

  // ── تحقق مبكر قبل أي قاعدة بيانات ──
  if (!category_id) return res.status(400).json({ error: 'اختر القسم' });
  if (cleanMessage.length < MIN_MESSAGE) {
    return res.status(400).json({ error: `الرسالة قصيرة — الحد الأدنى ${MIN_MESSAGE} حرف` });
  }
  if (cleanMessage.length > MAX_MESSAGE) {
    return res.status(400).json({ error: `الرسالة طويلة — الحد الأقصى ${MAX_MESSAGE} حرف` });
  }

  try {
    // ── القائمة السوداء (شاملة أو قسم محدد) ──
    const hit = await getBlacklistHit(req.user.discord_id, req.user.id, req.user.username, Number(category_id));
    if (hit) {
      const scoped = hit.category_id !== null;
      return res.status(403).json({
        error: scoped
          ? 'أنت محظور من فتح تذاكر في هذا القسم — راجع الإدارة'
          : 'أنت محظور من فتح التذاكر نهائياً — راجع الإدارة'
      });
    }

    // ── القسم يجب أن يكون موجوداً ومفعلاً ──
    const [cat] = await db.execute('SELECT id, name FROM ticket_categories WHERE id = ? AND is_active = 1', [Number(category_id)]);
    if (!cat.length) return res.status(400).json({ error: 'القسم غير موجود — حدث الصفحة وأعد المحاولة' });

    // ── فحص الصور أمنياً قبل إنشاء التذكرة ──
    let files = req.files ? req.files.images : null;
    const savedImages = [];
    if (files) {
      if (!Array.isArray(files)) files = [files];
      if (files.length > MAX_IMAGES) {
        return res.status(400).json({ error: `الحد الأقصى ${MAX_IMAGES} صور للتذكرة` });
      }
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      for (const f of files) {
        const safe = sanitizeImage(f.data);
        if (!safe.ok) return res.status(400).json({ error: `الصورة مرفوضة: ${safe.reason}` });
        const name = randomName(safe.ext);
        fs.writeFileSync(path.join(UPLOAD_DIR, name), safe.buf);
        savedImages.push({ file_path: '/uploads/tickets/' + name, original_name: (f.name || 'صورة').slice(0, 200), mime: safe.mime, size: safe.buf.length });
      }
    }

    // ── إنشاء التذكرة (email/subject أوقف استخدامهما — أعمدة قديمة تبقى فارغة) ──
    const [result] = await db.execute(
      "INSERT INTO support_tickets (user_id, name, email, subject, message, priority, category_id, status, created_at) VALUES (?, ?, '', '', ?, 'none', ?, 'open', NOW())",
      [req.user.id, req.user.username, cleanMessage, cat[0].id]
    );

    for (const img of savedImages) {
      await db.execute(
        'INSERT INTO ticket_images (ticket_id, file_path, original_name, mime, size) VALUES (?, ?, ?, ?, ?)',
        [result.insertId, img.file_path, img.original_name, img.mime, img.size]
      );
    }

    res.json({ success: true, ticket_id: result.insertId, redirect: '/support/my-tickets' });
  } catch (err) {
    console.error('[support/submit]', err.message);
    res.status(500).json({ error: 'فشل إرسال التذكرة — حاول لاحقاً' });
  }
});

module.exports = router;
