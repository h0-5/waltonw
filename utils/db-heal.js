/* شفاء ذاتي لنظام الأخبار — يوحّد اتجاهي schema القديمين لجدول news
 * ------------------------------------------------------------------
 * الخلفية: الكود انقسم تاريخياً على تخطيطين للجدول:
 *  - التخطيط القديم: author_id + is_published (لوحة الإدارة والـ CRUD يعتمدونها)
 *  - التخطيط الكامل: created_by + is_hidden + type + expires_at (الرئيسية تعتمدها)
 * و migrate() اللي يضيف الأعمدة الناقصة يتخطى كله لما schema_version محدّث
 * (نفس علة users.in_guild و rule_stages السابقة) — فقاعدة قديمة تبقى ناقصة
 * والأخبار تختفي من الرئيسية وإضافة خبر يرمي خطأ.
 * هذا الملف يفحص information_schema مرة رخيصة ويضيف اللي ناقص ويوحّد البيانات،
 * ويُستدعى من start() كل إقلاع ومن مسارات الأخبار عند خطأ عمود ناقص.
 */
const db = require('../config/database');

const isBadField = (e) =>
  !!(e && (e.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(e.message || '')));

async function ensureNewsSchema() {
  /* الجدول نفسه إن كان مفقوداً كلياً (قاعدة جديدة بتخطي migrate) */
  const [tbl] = await db.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'news'"
  );
  if (!tbl[0].n) {
    await db.query(`CREATE TABLE IF NOT EXISTS news (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255),
      content TEXT,
      type VARCHAR(50) DEFAULT 'news',
      image TEXT,
      author_id INT,
      is_published TINYINT(1) DEFAULT 1,
      is_hidden TINYINT(1) DEFAULT 0,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    return;
  }

  /* الأعمدة اللي يعتمد عليها الكود فعلياً (الرئيسية + اللوحة) — بلا أعمدة زائدة */
  const [cols] = await db.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'news'"
  );
  const have = new Set(cols.map(c => c.COLUMN_NAME));
  const add = async (col, ddl) => {
    if (have.has(col)) return false;
    await db.query(`ALTER TABLE news ADD COLUMN ${ddl}`);
    have.add(col);
    return true;
  };

  const addedHidden = await add('is_hidden', 'is_hidden TINYINT(1) DEFAULT 0');
  await add('type', "type VARCHAR(50) DEFAULT 'news'");
  await add('expires_at', 'expires_at DATETIME');
  const addedAuthor = await add('author_id', 'author_id INT');
  await add('is_published', 'is_published TINYINT(1) DEFAULT 1');

  /* ترحيل بيانات الاتجاهين بعد إضافة العمود الناقص فقط (لا يلمس صفوف سليمة):
     - قاعدة كاملة (created_by): انقل الكاتب إلى author_id ليشتغل JOIN اللوحة
     - مسودات is_published=0: خلّي is_hidden=1 حتى لا تنشر على الرئيسية */
  if (addedAuthor && have.has('created_by')) {
    await db.query('UPDATE news SET author_id = created_by WHERE author_id IS NULL AND created_by IS NOT NULL');
  }
  if (addedHidden && have.has('is_published')) {
    await db.query('UPDATE news SET is_hidden = 1 WHERE is_published = 0');
  }
}

module.exports = { ensureNewsSchema, isBadField };
