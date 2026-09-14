/**
 * utils/tickets-schema.js — شفاء ذاتي لمخطط نظام التذاكر
 * مستقل تماماً عن schema_version (الدرس من الأخبار: القواعد الحية القديمة
 * تتخطى migrate() لعدالة الإصدار فلا تُطبق ALTERات جديدة) — فحص information_schema
 * رخيص كل إقلاع يضمن: الجداول الثلاثة موجودة + عمودا category_id/closed_at موجودان + بذرة أقسام
 */

const db = require('../config/database');
const path = require('path');
const fs = require('fs');

async function ensureColumn(table, column, ddl) {
  try {
    const [cols] = await db.query(
      'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [table, column]
    );
    if (!cols[0].n) {
      await db.query(ddl);
      console.log(`✅ tickets-schema: added missing column ${table}.${column}`);
    }
  } catch (e) {
    console.error(`⚠️ tickets-schema: ensureColumn ${table}.${column} failed:`, e.message);
  }
}

async function ensureTicketSchema() {
  // 1) جدول الأقسام — تصنعها الإدارة من لوحة إدارة التذاكر
  await db.query(
    `CREATE TABLE IF NOT EXISTS ticket_categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      sort_order INT DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // 2) جدول صور التذاكر — ينحذف تلقائياً بعد 48 ساعة من إغلاق التذكرة (cleanup في server.js)
  await db.query(
    `CREATE TABLE IF NOT EXISTS ticket_images (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id INT NOT NULL,
      file_path VARCHAR(255) NOT NULL,
      original_name VARCHAR(255) DEFAULT NULL,
      mime VARCHAR(50) DEFAULT NULL,
      size INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket_images_ticket (ticket_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // 3) القائمة السوداء — شاملة (category_id = NULL يعني كل الأقسام) أو قسم محدد
  //    username تُخزن snapshot حتى يُمنع بنفس الاسم حتى لو انضاف مستقبلاً بحساب جديد
  await db.query(
    `CREATE TABLE IF NOT EXISTS ticket_blacklist (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT DEFAULT NULL,
      discord_id VARCHAR(32) DEFAULT NULL,
      username VARCHAR(64) DEFAULT NULL,
      category_id INT DEFAULT NULL,
      reason VARCHAR(255) DEFAULT NULL,
      created_by INT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_bl_user (user_id),
      INDEX idx_bl_username (username),
      INDEX idx_bl_category (category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  // 4) أعمدة قد تنقص في قواعد حية أُنشئت بكود أقدم
  await ensureColumn('support_tickets', 'category_id', 'ALTER TABLE support_tickets ADD COLUMN category_id INT DEFAULT NULL');
  await ensureColumn('support_tickets', 'closed_at', 'ALTER TABLE support_tickets ADD COLUMN closed_at DATETIME DEFAULT NULL');
  await ensureColumn('ticket_blacklist', 'created_by', 'ALTER TABLE ticket_blacklist ADD COLUMN created_by INT DEFAULT NULL');

  // 5) بذرة أقسام افتراضية أول مرة فقط — الإدارة تحذفها وتعدلها من اللوحة
  try {
    const [rows] = await db.query('SELECT COUNT(*) AS c FROM ticket_categories');
    if (!rows[0].c) {
      await db.query(
        "INSERT INTO ticket_categories (name, sort_order, is_active) VALUES ('استفسار عام', 1, 1), ('شكوى', 2, 1), ('اقتراح', 3, 1)"
      );
      console.log('✅ tickets-schema: seeded 3 default categories');
    }
  } catch (e) {
    console.error('⚠️ tickets-schema: seed failed:', e.message);
  }
}

/**
 * حذف صور التذاكر — بعد 48 ساعة من إغلاق التذكرة (بعد الرد) تنحذف نهائياً من السيرفر والقاعدة
 * تعمل عند الإقلاع ثم كل ساعة — درس التدقيق الأمني: لا unlink لمسار من القاعدة دون قياقة بادئة
 */
async function cleanupExpiredTicketImages() {
  try {
    const [rows] = await db.query(
      `SELECT ti.id, ti.file_path FROM ticket_images ti
        JOIN support_tickets t ON ti.ticket_id = t.id
        WHERE t.status = 'closed' AND t.closed_at IS NOT NULL
          AND t.closed_at < DATE_SUB(NOW(), INTERVAL 48 HOUR)
        LIMIT 500`
    );
    if (!rows.length) return;
    let removed = 0;
    for (const r of rows) {
      // قياقة صارمة: مسارات مجلد الرفع حصراً (يمنع /uploads/../../.env وأي مسار غريب)
      if (typeof r.file_path !== 'string' || r.file_path.indexOf('/uploads/tickets/') !== 0) continue;
      try {
        fs.unlinkSync(path.join(__dirname, '..', 'public', r.file_path.replace(/^\/+/, '')));
        removed++;
      } catch (_) { /* الملف غائب أصلاً — نكمل حذف صفه */ }
    }
    await db.query('DELETE FROM ticket_images WHERE id IN (' + rows.map(() => '?').join(',') + ')', rows.map(r => r.id));
    console.log(`✅ tickets-cleanup: removed ${removed} expired image(s) (closed >48h)`);
  } catch (e) {
    console.error('⚠️ tickets-cleanup failed:', e.message);
  }
}

function startTicketCleanup() {
  cleanupExpiredTicketImages().catch(() => {});
  setInterval(() => { cleanupExpiredTicketImages().catch(() => {}); }, 60 * 60 * 1000).unref();
}

module.exports = { ensureTicketSchema, startTicketCleanup };
