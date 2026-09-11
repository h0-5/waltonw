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
/* وسم البناء — يظهر برسالة الخطأ وويبهوك التشخيص حتى نعرف أن نسخة السايت محدّثة فعلاً */
const SVC_BUILD = 'svc-b7';
/* نفس نمط أسماء الشخصيات بنظام المزرعة — الاسم الكامل مطلوب بأسئلة الخدمات */
const NAME_RE = /^[A-Za-z]{2,16}_[A-Za-z]{2,16}(_[A-Za-z]{2,16})?$/;

/* ── شفاء ذاتي لجداول خدمات الشركة (نفس نمط المزارع) ──
   سبب جذري لعلة «خطأ بإرسال الطلب»: migrate() يتخطى على قواعد رقمها محدَّث (schema_version)،
   فأعمدة service_requests المضافة لاحقاً (total_price/package_id/admin_id/reviewed_at)
   ما تنطبق على قاعدة الإنتاج — وكل INSERT يفشل بـ ER_BAD_FIELD_ERROR.
   هذا الضمان ينفذ عند الإقلاع وأول طلب API — بدون مساس بأي بيانات */
let schemaReady = false;
async function ensureColumn(table, col, def) {
  const [c] = await db.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${col}'`);
  if (!c.length) {
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN ${def}`);
    console.log(`✅ company-schema: ${table}.${col} added`);
  }
}
async function ensureCompanySchema() {
  if (schemaReady) return;
  await db.query(`CREATE TABLE IF NOT EXISTS company_items (
    id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), description TEXT, image TEXT,
    video_url TEXT, category VARCHAR(100), sort_order INT DEFAULT 0,
    service_status VARCHAR(20) DEFAULT 'active', icon VARCHAR(100) DEFAULT ''
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS service_questions (
    id INT AUTO_INCREMENT PRIMARY KEY, service_id INT, question TEXT,
    type VARCHAR(50) DEFAULT 'text', sort_order INT DEFAULT 0, required TINYINT(1) DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS service_packages (
    id INT AUTO_INCREMENT PRIMARY KEY, service_id INT, name VARCHAR(255), price DECIMAL(10,2),
    description TEXT, sort_order INT DEFAULT 0, days INT DEFAULT 0,
    image_type VARCHAR(20) DEFAULT 'emoji', image_value VARCHAR(255) DEFAULT ''
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS service_requests (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, service_id INT, answers JSON,
    status VARCHAR(20) DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_price DECIMAL(10,2) DEFAULT 0, package_id INT DEFAULT 0,
    admin_id INT NULL, reviewed_at DATETIME NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  /* أعمدة قد تنقص بقواعد قديمة — كل واحد بمحاولة مستقلة عشان عمود فاشل ما يوقف الباقي
     (تشمل الأعمدة الأساسية حتى لو كان شكل الجدول القديم مختلف تماماً) */
  const cols = [
    ['service_requests', 'user_id', 'user_id INT NULL'],
    ['service_requests', 'service_id', 'service_id INT NULL'],
    ['service_requests', 'answers', 'answers JSON NULL'],
    ['service_requests', 'status', "status VARCHAR(20) DEFAULT 'pending'"],
    ['service_requests', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP'],
    ['service_requests', 'total_price', 'total_price DECIMAL(10,2) DEFAULT 0'],
    ['service_requests', 'package_id', 'package_id INT DEFAULT 0'],
    ['service_requests', 'admin_id', 'admin_id INT NULL'],
    ['service_requests', 'reviewed_at', 'reviewed_at DATETIME NULL'],
    ['service_questions', 'required', 'required TINYINT(1) DEFAULT 0'],
    ['service_questions', 'type', "type VARCHAR(50) DEFAULT 'text'"],
    ['service_questions', 'sort_order', 'sort_order INT DEFAULT 0'],
    ['service_packages', 'days', 'days INT DEFAULT 0'],
    ['service_packages', 'image_type', "image_type VARCHAR(20) DEFAULT 'emoji'"],
    ['service_packages', 'image_value', "image_value VARCHAR(255) DEFAULT ''"],
    ['company_items', 'service_status', "service_status VARCHAR(20) DEFAULT 'active'"],
    ['company_items', 'icon', "icon VARCHAR(100) DEFAULT ''"]
  ];
  for (const [t, c, def] of cols) {
    try { await ensureColumn(t, c, def); } catch (e) { console.error(`[company-schema] ${t}.${c}:`, e.message); }
  }
  schemaReady = true;
}

router.use(async (req, res, next) => {
  try { await ensureCompanySchema(); } catch (e) { console.error('[company-schema]:', e.message); }
  next();
});

function notifyCompany(payload) {
  const key = webhooks.WH_COMPANY ? 'WH_COMPANY' : (webhooks.WH_FARM ? 'WH_FARM' : null);
  if (!key) return;
  sendWebhook(key, Object.assign({ footer: 'Walton Family — Company Services' }, payload)).catch(() => {});
}

/* منشن إشعارات الإدارة — نفس مفتاح المزرعة (منشن واحد للشركة كلها) */
async function notifyMention() {
  try {
    const [rows] = await db.execute('SELECT ping_mention FROM farm_config WHERE id = 1');
    if (rows.length && rows[0].ping_mention) return String(rows[0].ping_mention).slice(0, 32);
  } catch (e) {}
  return '@here';
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

/* تعريفات أعمدة service_requests — تستخدم بالشفاء الذكي عند فشل الإدراج بعمود ناقص */
const REQ_COL_DEFS = {
  user_id: 'user_id INT NULL',
  service_id: 'service_id INT NULL',
  answers: 'answers JSON NULL',
  status: "status VARCHAR(20) DEFAULT 'pending'",
  created_at: 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP',
  total_price: 'total_price DECIMAL(10,2) DEFAULT 0',
  package_id: 'package_id INT DEFAULT 0',
  admin_id: 'admin_id INT NULL',
  reviewed_at: 'reviewed_at DATETIME NULL'
};

/* ويبهوك تشخيصي — يوصل الإدارة تفاصيل أي فشل بتقديم طلب (القناة: سجل الإدارة ثم الشركة ثم المزرعة) */
function reportSvcFailure(req, e, extra) {
  try {
    const key = webhooks.WH_ADMIN_LOG ? 'WH_ADMIN_LOG' : (webhooks.WH_COMPANY ? 'WH_COMPANY' : (webhooks.WH_FARM ? 'WH_FARM' : null));
    if (!key) return;
    const stack = String(e && e.stack || '').split('\n').slice(0, 4).join('\n').substring(0, 900);
    sendWebhook(key, {
      title: '🧪 فشل تقديم طلب خدمة — تشخيص تلقائي',
      color: 0xe74c3c,
      description: stack ? '```' + stack + '```' : '',
      fields: [
        { name: 'البناء', value: SVC_BUILD, inline: true },
        { name: 'الرمز', value: String((e && e.code) || '—').substring(0, 60), inline: true },
        { name: 'الرسالة', value: String((e && e.message) || '—').substring(0, 1000) || '—', inline: false },
        { name: 'SQL', value: String((e && e.sqlMessage) || '—').substring(0, 1000), inline: false },
        { name: 'سياق الطلب', value: 'خدمة: ' + (extra && extra.serviceId || '—') + ' · بكج: ' + (extra && extra.packageId || '—') + ' · مستخدم: ' + String((req.user && req.user.username) || '؟').substring(0, 60) + ' · مرفقات: ' + (req.files ? Object.keys(req.files).length : 0), inline: false }
      ].slice(0, 6),
      footer: 'Walton — تشخيص ' + SVC_BUILD
    }).catch(function() {});
  } catch (x) {}
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
    /* خدمة بدون أسئلة معرّفة: النافذة تعرض 3 حقول افتراضية (d_name/d_phone/d_notes) —
       نحفظها هنا أيضاً عشان الإدارة تشوف إجابات الزبون بدل طلب فاضي */
    if (!qs.length) {
      const dName = String(req.body.sq_d_name || '').trim().slice(0, 1000);
      const dPhone = String(req.body.sq_d_phone || '').trim().slice(0, 1000);
      const dNotes = String(req.body.sq_d_notes || '').trim().slice(0, 1000);
      if (dName) answers.push({ q: 'الاسم الكامل', a: dName, type: 'text' });
      if (dPhone) answers.push({ q: 'رقم الجوال', a: dPhone, type: 'text' });
      if (dNotes) answers.push({ q: 'ملاحظات', a: dNotes, type: 'text' });
    }
    const uploadDir = path.join(__dirname, '../../public/uploads/company');
    for (const q of qs) {
      if (q.type === 'image') {
        const file = req.files && req.files['sq_' + q.id];
        const hasFile = file && file.size > 0;
        if (Number(q.required) === 1 && !hasFile) {
          return res.status(400).json({ error: 'أرفق الصورة المطلوبة: ' + q.question });
        }
        if (hasFile) {
          if (file.truncated) {
            return res.status(400).json({ error: 'الصورة أكبر من الحد المسموح (5 ميجا): ' + q.question });
          }
          if (file.mimetype && String(file.mimetype).indexOf('image/') !== 0) {
            return res.status(400).json({ error: 'الملف المرفق لازم يكون صورة: ' + q.question });
          }
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
        /* اسم الشخصية لازم يكون كامل وصحيح مثل نظام المزرعة — أي خطأ بالاسم مسؤولية صاحبه */
        if (q.type === 'character_name' && v && !NAME_RE.test(v)) {
          return res.status(400).json({ error: 'اكتب اسم الشخصية كاملة وصحيحة كما هو بالسيرفر (مثال: Hadi_Walton) — ' + q.question });
        }
        if (v) answers.push({ q: q.question, a: v, type: q.type === 'character_name' ? 'character_name' : 'text' });
      }
    }

    const insSql = 'INSERT INTO service_requests (service_id, user_id, answers, status, total_price, package_id) VALUES (?, ?, ?, ?, ?, ?)';
    const insParams = [serviceId, req.user.id, JSON.stringify(answers), 'pending', totalPrice, packageId || 0];
    let ins;
    try {
      [ins] = await db.execute(insSql, insParams);
    } catch (ie) {
      /* شفاء ذكي: عمود ناقص انكشف من رسالة الخطأ → نضيفه ونعيد المحاولة مرة واحدة */
      if (ie && (ie.code === 'ER_BAD_FIELD_ERROR') && ie.sqlMessage) {
        const m = /Unknown column '([^']+)'/.exec(String(ie.sqlMessage));
        if (m && REQ_COL_DEFS[m[1]]) {
          console.log('🔧 company-api: عمود ناقص انكشف بالإدراج —', m[1]);
          await ensureColumn('service_requests', m[1], REQ_COL_DEFS[m[1]]);
          [ins] = await db.execute(insSql, insParams);
        } else { throw ie; }
      } else { throw ie; }
    }

    // ويبهوك للإدارة — بمنشن مباشر للشخص الكبير مع كل طلب جديد
    const detail = answers.filter(a => a.type !== 'image' && a.a)
      .map(a => `${a.q}: ${a.a}`).join('\n') || '—';
    const imgsCount = answers.filter(a => a.type === 'image' && a.a).length;
    notifyCompany({
      title: '🛎️ طلب خدمة جديد — ' + svc[0].title,
      color: 0xbc13fe,
      content: await notifyMention(),
      description: detail !== '—' ? detail.substring(0, 500) : '',
      fields: [
        { name: 'رقم الطلب', value: '#' + ins.insertId, inline: true },
        { name: 'المستخدم', value: String(req.user.username || ''), inline: true }
      ].concat(imgsCount ? [{ name: 'مرفقات', value: imgsCount + ' صورة — تشوفها بلوحة الإدارة', inline: false }] : [])
        .concat([{ name: 'المراجعة', value: 'لوحة الإدارة ← الشركة ← طلبات الخدمة', inline: false }])
    });

    res.json({ success: true, id: ins.insertId, message: 'تم إرسال طلبك بنجاح — راح تراجع الإدارة ويتواصلون معك' });
  } catch (e) {
    console.error('[company-api] service-request [' + SVC_BUILD + ']:', e.code || '', e.message);
    reportSvcFailure(req, e, { serviceId: req.body && req.body.service_id, packageId: req.body && req.body.package_id });
    /* رسالة الزبون تتضمن وسم البناء والرمز — أول تجربة من هادي تحدد السبب الفعلي فوراً */
    res.status(500).json({ error: 'خطأ بإرسال الطلب [' + SVC_BUILD + ' · ' + (e.code || 'ERR') + ']' });
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
module.exports.ensureCompanySchema = ensureCompanySchema;
