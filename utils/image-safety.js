/**
 * utils/image-safety.js — فحص وتنقية صور التذاكر المرفوعة
 * الحماية بمحتوى الملف الفعلي (البصمة) لا بالامتداد:
 *  1) بصمة magic bytes تحدد النوع الحقيقي — أي شيء آخر يُرفض (بما فيها SVG لأنه قد يحمل سكربتات)
 *  2) قص أي بيانات مدسوسة بعد نهاية الصورة الرسمية (IEND للـ PNG / FFD9 للـ JPEG)
 *     فتُقتل ملفات polyglot (صورة + PHP/HTML/ZIP خلفها)
 *  3) اسم عشوائي على السيرفر + امتداد من البصمة لا من اسم الملف الأصلي
 *  4) تُخدم من /uploads/tickets بنوع محدد و nosniff (app.js)
 */

const crypto = require('crypto');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from('IEND', 'ascii');
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

/**
 * يفحص ويقص بايت الملف — يرجع { ok, buf, mime, ext } أو { ok:false, reason }
 */
function sanitizeImage(buf) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length < 24) return { ok: false, reason: 'الملف فارغ أو صغير جداً' };

  // ── PNG ──
  if (buf.subarray(0, 8).equals(PNG_SIG)) {
    const iend = buf.lastIndexOf(IEND);
    if (iend === -1) return { ok: false, reason: 'صورة PNG غير مكتملة' };
    // IEND chunk: 'IEND' + CRC (4) — نحتك عند نهايته ونتجاهل أي ذيل مدسوس
    return { ok: true, buf: buf.subarray(0, iend + 8), mime: 'image/png', ext: 'png' };
  }

  // ── JPEG ──
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const eoi = buf.lastIndexOf(JPEG_EOI);
    if (eoi === -1) return { ok: false, reason: 'صورة JPEG غير مكتملة' };
    return { ok: true, buf: buf.subarray(0, eoi + 2), mime: 'image/jpeg', ext: 'jpg' };
  }

  // ── GIF ──
  if (buf.subarray(0, 3).toString('ascii') === 'GIF' && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return { ok: true, buf, mime: 'image/gif', ext: 'gif' };
  }

  // ── WebP ──
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { ok: true, buf, mime: 'image/webp', ext: 'webp' };
  }

  return { ok: false, reason: 'نوع الملف غير مدعوم — المسموح: PNG / JPG / WEBP / GIF' };
}

/**
 * اسم عشوائي آمن — امتداد من البصمة لا من الملف الأصلي
 */
function randomName(ext) {
  return crypto.randomBytes(16).toString('hex') + '.' + ext;
}

/**
 * تحقق سريع من نوع صورة بلا قص (للاختبارات)
 */
function detectType(buf) {
  const r = sanitizeImage(buf);
  return r.ok ? { mime: r.mime, ext: r.ext } : null;
}

module.exports = { sanitizeImage, randomName, detectType };
