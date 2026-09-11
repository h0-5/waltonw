/*
 * نظام استئجار المزارع — شركة والتون
 * خدمة واحدة تحسب على مزرعتين (لكل مزرعة تفعيل مستقل)
 * التدفق (دفع على دفعتين):
 *   حجز → عربون (50% من الإيجار) خلال مهلة الدفع → المستأجر يعلن الدفع → الإدارة تأكد
 *        → الحجز «مؤكد» والبداية متجددة بعد (مهلة النص الثاني = 6 ساعات افتراضياً)
 *        → المستأجر يوصله تنبيه فوراً (قبل بداية الحجز بـ 6 ساعات) يحوّل النص الثاني،
 *          ويقدر يسجل عماله (اسم شخصية كامل + رسوم كل عامل) قبل سداد النص الثاني
 *        → الإدارة تأكد وصول النص الثاني → الحجز «فعال» ويبدأ → وبس عندها يطلع اشعار
 *          «أضيفوه للفاكشن» بالمنشن — باسم المستأجر وبأسماء عماله المؤكدين لدخلهم
 *          دفعة واحدة + تنبيه ساعي يذكر بالأسماء حتى التأكيد
 *        → إذا وصل قبل بداية الحجز بساعة والنص الثاني ما انحول → ينلغي تلقائياً
 *          ويخسر العربون (فلوس أول تحويل)
 *   عند النهاية: إشعار + إزالة المستأجر من الفاكشن بتأكدين
 * القواعد: مهلة دفع العربون 3 ساعات (إلغاء تلقائي) — الإلغاء اليدوي يخسر 50% من
 *          العربون — التمديد فقط قبل انتهاء الحجز بـ 24 ساعة — المدد ثابتة
 *          (1/3/5/7/10/14 يوم) والأسعار نص قابل للتعديل من لوحة الإدارة
 */
const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { isAuthenticated, checkPermission } = require('../../middleware/auth');
const { sendWebhook } = require('../../utils/webhooks');
const webhooks = require('../../config/webhooks');

const DURATIONS = [1, 3, 5, 7, 10, 14];
const PRICE_COL = { 1: 'price_1d', 3: 'price_3d', 5: 'price_5d', 7: 'price_7d', 10: 'price_10d', 14: 'price_14d' };

const STATUS_AR = {
  pending_payment: 'بانتظار دفع العربون',
  pending_confirm: 'بانتظار تأكيد الإدارة',
  confirmed: 'مؤكد — بانتظار النص الثاني',
  active: 'حجز فعال',
  ended: 'منتهي',
  cancelled: 'ملغي',
  expired: 'انتهت المهلة'
};
const RSTATUS_AR = {
  pending_payment: 'بانتظار تحويل النص الثاني',
  pending_confirm: 'بانتظار تأكيد الإدارة',
  confirmed: 'مؤكد',
  rejected: 'مرفوض'
};
/* العازل قبل البداية: النص الثاني لازم ينحول قبل بداية الحجز بساعة على الأقل —
   إذا وصل هالموعد وما انحول، الحجز ينلغي تلقائياً والمستأجر يخسر العربون */
const FORFEIT_BUFFER_HOURS = 1;
const WSTATUS_AR = {
  pending_payment: 'بانتظار الدفع',
  pending_confirm: 'بانتظار تأكيد الإدارة',
  confirmed: 'مؤكد',
  rejected: 'مرفوض',
  cancelled: 'ملغي'
};

/* ── مخطط الجداول (شفاء ذاتي عند أول طلب كل إقلاع) ── */
let schemaReady = false;
async function ensureColumn(table, colName, colDef) {
  const [cols] = await db.query(`SHOW COLUMNS FROM ${table} LIKE '${colName}'`);
  if (!cols.length) await db.query(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
}
async function ensureFarmSchema() {
  if (schemaReady) return;
  await db.query(`CREATE TABLE IF NOT EXISTS farm_config (
    id INT PRIMARY KEY,
    bank_account VARCHAR(64) DEFAULT 'LS271002003014195466',
    farm1_enabled TINYINT(1) DEFAULT 1,
    farm2_enabled TINYINT(1) DEFAULT 1,
    price_1d BIGINT DEFAULT 250000,
    price_3d BIGINT DEFAULT 750000,
    price_5d BIGINT DEFAULT 1250000,
    price_7d BIGINT DEFAULT 1750000,
    price_10d BIGINT DEFAULT 2500000,
    price_14d BIGINT DEFAULT 3500000,
    worker_price BIGINT DEFAULT 100000,
    max_workers INT DEFAULT 5,
    deposit_pct INT DEFAULT 50,
    payment_window_hours INT DEFAULT 3,
    cancel_cutoff_hours INT DEFAULT 6,
    extend_window_hours INT DEFAULT 24,
    remainder_window_hours INT DEFAULT 6,
    ping_mention VARCHAR(32) DEFAULT '@here',
    updated_at DATETIME NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  /* مزارع ديناميكية غير محددة — الإدارة تضيف/تحذف بحرية */
  await db.query(`CREATE TABLE IF NOT EXISTS farm_farms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    enabled TINYINT(1) DEFAULT 1,
    sort_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS farm_bookings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ref VARCHAR(20) DEFAULT '',
    user_id INT NOT NULL,
    username VARCHAR(64) DEFAULT '',
    discord_id VARCHAR(32) DEFAULT '',
    farm_no TINYINT NOT NULL,
    duration_days INT NOT NULL,
    rent_amount BIGINT NOT NULL,
    deposit_amount BIGINT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending_payment',
    payment_deadline DATETIME NULL,
    start_at DATETIME NULL,
    end_at DATETIME NULL,
    faction_added TINYINT(1) DEFAULT 0,
    faction_added_at DATETIME NULL,
    faction_removed TINYINT(1) DEFAULT 0,
    remove_confirm1_by VARCHAR(64) NULL,
    remove_confirm1_at DATETIME NULL,
    remove_confirm2_by VARCHAR(64) NULL,
    remove_confirm2_at DATETIME NULL,
    extend_days INT NULL,
    extend_rent BIGINT NULL,
    extend_deposit BIGINT NULL,
    extend_status VARCHAR(20) DEFAULT '',
    extend_deadline DATETIME NULL,
    cancel_penalty BIGINT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_fb_status (status),
    INDEX idx_fb_user (user_id),
    INDEX idx_fb_farm (farm_no)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS farm_workers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL,
    character_name VARCHAR(64) NOT NULL,
    amount BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending_payment',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    confirmed_at DATETIME NULL,
    INDEX idx_fw_booking (booking_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS farm_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NULL,
    actor VARCHAR(64) DEFAULT '',
    actor_type VARCHAR(10) DEFAULT 'system',
    action VARCHAR(64) DEFAULT '',
    details VARCHAR(255) DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query('INSERT IGNORE INTO farm_config (id) VALUES (1)');
  /* أعمدة «النص الثاني» — الدفع على دفعتين (ترحيل شفاء ذاتي) */
  try {
    await ensureColumn('farm_bookings', 'remainder_amount', 'remainder_amount BIGINT NOT NULL DEFAULT 0');
    await ensureColumn('farm_bookings', 'remainder_status', "remainder_status VARCHAR(20) DEFAULT ''");
    await ensureColumn('farm_bookings', 'remainder_deadline', 'remainder_deadline DATETIME NULL');
    await ensureColumn('farm_config', 'remainder_window_hours', 'remainder_window_hours INT DEFAULT 6');
  } catch (e) { console.error('[farm] remainder cols:', e.message); }
  /* ترحيل من المزارع الثابتة (1/2) إلى الجدول الديناميكي — مرة واحدة */
  try {
    await ensureColumn('farm_bookings', 'farm_id', 'farm_id INT NULL');
    await db.query('UPDATE farm_bookings SET farm_id = farm_no WHERE farm_id IS NULL');
    const [cnt] = await db.query('SELECT COUNT(*) AS n FROM farm_farms');
    if (!Number(cnt[0].n)) {
      const [cfgRows] = await db.query('SELECT farm1_enabled, farm2_enabled FROM farm_config WHERE id = 1');
      const c = cfgRows[0] || {};
      await db.query('INSERT INTO farm_farms (name, enabled, sort_order) VALUES (?, ?, 1), (?, ?, 2)', [
        'المزرعة 1', Number(c.farm1_enabled) === 0 ? 0 : 1,
        'المزرعة 2', Number(c.farm2_enabled) === 0 ? 0 : 1
      ]);
      console.log('🌾 farm_farms seeded from legacy farm1/farm2 config');
    }
  } catch (e) { console.error('[farm] migrate farms:', e.message); }
  schemaReady = true;
}

router.use(async (req, res, next) => {
  try { await ensureFarmSchema(); } catch (e) { console.error('[farm] schema:', e.message); }
  next();
});

/* ── أدوات ── */
function money(n) { return Number(n || 0).toLocaleString('en-US'); }

function toIso(s) {
  if (!s) return null;
  if (s instanceof Date) return s.toISOString();
  // dateStrings:true → 'YYYY-MM-DD HH:MM:SS' بتوقيت +03 (timezone في config/database)
  const d = new Date(String(s).replace(' ', 'T') + '+03:00');
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function pickWebhookKey() {
  if (webhooks.WH_FARM) return 'WH_FARM';
  if (webhooks.WH_COMPANY) return 'WH_COMPANY';
  return null;
}

function farmNotify(payload) {
  const key = pickWebhookKey();
  if (!key) return;
  sendWebhook(key, Object.assign({ footer: 'Walton Family — Farm System' }, payload)).catch(() => {});
}

async function logEvent(bookingId, actor, actorType, action, details) {
  try {
    await db.execute('INSERT INTO farm_events (booking_id, actor, actor_type, action, details) VALUES (?, ?, ?, ?, ?)',
      [bookingId || null, actor || '', actorType || 'system', action || '', details || '']);
  } catch (e) {}
}

/* تنبيه المستأجر: إشعار داخل الموقع + رسالة ديسكورد خاصة (إذا البوت فعال) */
async function renterNotify(userId, title, message) {
  try {
    await db.execute('INSERT INTO notifications (user_id, title, message, is_read, created_at) VALUES (?, ?, ?, 0, NOW())',
      [userId, title, message]);
  } catch (e) {}
  try {
    const bot = require('../../bot/client');
    bot.sendNotificationDM(userId, title, message).catch(() => {});
  } catch (e) {}
}

async function getConfig() {
  const [rows] = await db.execute('SELECT * FROM farm_config WHERE id = 1');
  if (!rows.length) {
    await db.query('INSERT IGNORE INTO farm_config (id) VALUES (1)');
    const [rows2] = await db.execute('SELECT * FROM farm_config WHERE id = 1');
    return rows2[0];
  }
  return rows[0];
}

function priceOf(cfg, days) { return Number(cfg[PRICE_COL[days]] || 0); }

/* المزرعة مشغولة إذا: عربون بانتظار تأكيد + بانتظار دفع (بمهلة سارية) + حجز مؤكد
   (محجوز لصاحبه حتى يسدد النص الثاني) + حجز فعال لم ينتهِ */
const BUSY_WHERE = `(status = 'pending_confirm'
  OR (status = 'pending_payment' AND payment_deadline > NOW())
  OR status = 'confirmed'
  OR (status = 'active' AND end_at > NOW()))`;

async function farmsBusy() {
  const [rows] = await db.execute(`SELECT farm_id FROM farm_bookings WHERE ${BUSY_WHERE} AND farm_id IS NOT NULL`);
  const m = {};
  rows.forEach(r => { m[Number(r.farm_id)] = true; });
  return m;
}

async function getFarms() {
  const [rows] = await db.execute('SELECT * FROM farm_farms ORDER BY sort_order ASC, id ASC');
  return rows;
}

/* ── حالة الخدمة (تُستخدم في API وصفحة الشركة) ── */
async function getPublicState(userId) {
  const cfg = await getConfig();
  const [farmsRaw, busy] = await Promise.all([getFarms(), farmsBusy()]);
  const farms = farmsRaw.map(f => ({
    id: f.id,
    name: f.name,
    enabled: Number(f.enabled) === 1,
    free: !busy[f.id]
  }));
  const state = {
    serviceOpen: farms.some(f => f.enabled),
    anyFree: farms.some(f => f.enabled && f.free),
    farms,
    config: {
      bank_account: cfg.bank_account,
      prices: DURATIONS.map(d => ({ days: d, price: priceOf(cfg, d) })),
      worker_price: Number(cfg.worker_price),
      max_workers: Number(cfg.max_workers),
      deposit_pct: Number(cfg.deposit_pct),
      payment_window_hours: Number(cfg.payment_window_hours),
      cancel_cutoff_hours: Number(cfg.cancel_cutoff_hours),
      extend_window_hours: Number(cfg.extend_window_hours),
      remainder_window_hours: Number(cfg.remainder_window_hours || 6)
    },
    myBookings: []
  };
  if (userId) state.myBookings = await serializeUserBookings(userId, cfg);
  return state;
}

function deadlineLeft(deadlineStr) {
  const iso = toIso(deadlineStr);
  if (!iso) return 0;
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

async function serializeUserBookings(userId, cfg) {
  const [rows] = await db.execute(
    'SELECT b.*, f.name AS farm_name FROM farm_bookings b LEFT JOIN farm_farms f ON b.farm_id = f.id WHERE b.user_id = ? ORDER BY b.id DESC LIMIT 12', [userId]);
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [wrows] = await db.execute(`SELECT * FROM farm_workers WHERE booking_id IN (${ids.map(() => '?').join(',')})`, ids);
  const now = Date.now();
  return rows.map(b => {
    const workers = wrows.filter(w => w.booking_id === b.id).map(w => ({
      id: w.id, name: w.character_name, amount: Number(w.amount),
      status: w.status, statusLabel: WSTATUS_AR[w.status] || w.status
    }));
    const liveWorkers = workers.filter(w => ['pending_payment', 'pending_confirm', 'confirmed'].includes(w.status)).length;
    const extPending = b.extend_status === 'pending_payment' || b.extend_status === 'pending_confirm';
    const endMs = toIso(b.end_at) ? new Date(toIso(b.end_at)).getTime() : 0;
    const extendWindow = b.status === 'active' && endMs > 0 &&
      now >= endMs - Number(cfg.extend_window_hours) * 3600e3 && now < endMs;
    const startMs = toIso(b.start_at) ? new Date(toIso(b.start_at)).getTime() : 0;
    const cancelBeforeStart = startMs > 0 && now <= startMs - Number(cfg.cancel_cutoff_hours) * 3600e3;
    /* النص الثاني: يظهر لحجوزات «مؤكد» — الموعد الأخير للتحويل = قبل البداية بساعة */
    const rDeadlineIso = toIso(b.remainder_deadline);
    const rDeadlineMs = rDeadlineIso ? new Date(rDeadlineIso).getTime() : 0;
    const forfeitIso = rDeadlineIso ? new Date(rDeadlineMs - FORFEIT_BUFFER_HOURS * 3600e3).toISOString() : null;
    const remainder = b.status === 'confirmed' ? {
      amount: Number(b.rent_amount) - Number(b.deposit_amount),
      status: b.remainder_status || 'pending_payment',
      statusLabel: RSTATUS_AR[b.remainder_status || 'pending_payment'] || (b.remainder_status || 'pending_payment'),
      start_iso: rDeadlineIso,
      forfeit_iso: forfeitIso,
      forfeit_left: forfeitIso ? Math.max(0, Math.floor((new Date(forfeitIso).getTime() - now) / 1000)) : 0
    } : null;
    return {
      id: b.id, ref: b.ref, farm_no: Number(b.farm_no), farm_id: Number(b.farm_id) || 0,
      farm_name: b.farm_name || ('مزرعة #' + b.farm_no), duration_days: Number(b.duration_days),
      rent_amount: Number(b.rent_amount), deposit_amount: Number(b.deposit_amount),
      status: b.status, statusLabel: STATUS_AR[b.status] || b.status,
      created_iso: toIso(b.created_at), start_iso: toIso(b.start_at), end_iso: toIso(b.end_at),
      deadline_iso: toIso(b.payment_deadline), deadline_left: deadlineLeft(b.payment_deadline),
      faction_added: Number(b.faction_added) === 1, faction_removed: Number(b.faction_removed) === 1,
      cancel_penalty: Number(b.cancel_penalty),
      remainder,
      extend: b.extend_days ? {
        days: Number(b.extend_days), rent: Number(b.extend_rent), deposit: Number(b.extend_deposit),
        status: b.extend_status, deadline_iso: toIso(b.extend_deadline), deadline_left: deadlineLeft(b.extend_deadline)
      } : null,
      workers,
      can: {
        pay: b.status === 'pending_payment',
        payRemainder: b.status === 'confirmed' && (b.remainder_status || 'pending_payment') === 'pending_payment',
        cancel: b.status === 'pending_payment' || b.status === 'pending_confirm' || b.status === 'confirmed' || (b.status === 'active' && cancelBeforeStart),
        cancelPenalty: b.status === 'pending_confirm' || b.status === 'confirmed' || (b.status === 'active' && cancelBeforeStart)
          ? Math.round(Number(b.deposit_amount) / 2) : 0,
        extend: extendWindow && !extPending,
        addWorker: (b.status === 'confirmed' || b.status === 'active') && liveWorkers < Number(cfg.max_workers)
      }
    };
  });
}

/* ═══════════ نقاط المستخدم ═══════════ */

// حالة الخدمة
router.get('/state', async (req, res) => {
  try {
    const state = await getPublicState(req.user ? req.user.id : null);
    res.json(state);
  } catch (e) {
    console.error('[farm] state:', e.message);
    res.status(500).json({ error: 'خطأ بجلب حالة الخدمة' });
  }
});

// حجز مزرعة
router.post('/book', isAuthenticated, async (req, res) => {
  try {
    const days = parseInt(req.body.duration_days);
    if (!DURATIONS.includes(days)) return res.status(400).json({ error: 'المدة غير متاحة — المدد الثابتة فقط (1/3/5/7/10/14 يوم)' });
    const farms = await getFarms();
    if (!farms.some(f => Number(f.enabled) === 1)) {
      return res.status(400).json({ error: 'الخدمة مقفلة حالياً' });
    }
    // حجز قائم واحد لكل مستأجر
    const [mine] = await db.execute(
      `SELECT id, ref FROM farm_bookings WHERE user_id = ? AND ${BUSY_WHERE} LIMIT 1`, [req.user.id]);
    if (mine.length) return res.status(400).json({ error: `عندك حجز قائم بالفعل (${mine[0].ref})` });

    const busy = await farmsBusy();
    const farmRow = farms.find(f => Number(f.enabled) === 1 && !busy[f.id]);
    if (!farmRow) return res.status(400).json({ error: 'غير متوفر' }); // بدون اقتراح مواعيد مستقبلية
    const farmNo = farmRow.id;
    const cfg = await getConfig();

    const rent = priceOf(cfg, days);
    const deposit = Math.round(rent * Number(cfg.deposit_pct) / 100);
    // الحجز بدون فلوس ممنوع — الأسعار لازم تكون مضبوطة من الإدارة قبل أي حجز
    if (!(rent > 0) || !(deposit > 0)) {
      return res.status(400).json({ error: 'أسعار الخدمة غير مضبوطة من إدارة الشركة — ما ينعكس إنشاء الحجز حالياً' });
    }
    // ضد الحجز المجاني المتكرر: تجاوز المهلة مرتين خلال 24 ساعة = ما ينحجز مرة ثانية حتى تراجع الإدارة
    const [spam] = await db.execute(
      "SELECT COUNT(*) AS n FROM farm_bookings WHERE user_id = ? AND status = 'expired' AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)",
      [req.user.id]);
    if (Number(spam[0].n) >= 2) {
      return res.status(400).json({ error: 'عندك حجوزات انتهت مهلتها بدون دفع خلال آخر 24 ساعة — راجع إدارة الشركة قبل الحجز مرة ثانية' });
    }
    const [ins] = await db.execute(
      `INSERT INTO farm_bookings (ref, user_id, username, discord_id, farm_no, farm_id, duration_days, rent_amount, deposit_amount, status, payment_deadline)
       VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', DATE_ADD(NOW(), INTERVAL ? HOUR))`,
      [req.user.id, req.user.username || '', req.user.discord_id || '', farmRow.id, farmRow.id, days, rent, deposit, Number(cfg.payment_window_hours)]);
    const ref = 'WT-F-' + (1000 + ins.insertId);
    await db.execute('UPDATE farm_bookings SET ref = ? WHERE id = ?', [ref, ins.insertId]);
    await logEvent(ins.insertId, req.user.username, 'user', 'book', `حجز ${days} يوم — إيجار ${money(rent)}$ — عربون ${money(deposit)}$ — مهلة ${cfg.payment_window_hours} ساعات`);

    // إشعار للإدارة (الشخص الكبير) بمنشن مباشر — كل حجز جديد يوصل بالويبهوك
    farmNotify({
      title: '🌾 حجز مزرعة جديد — بانتظار العربون',
      color: 0xbc13fe,
      content: cfg.ping_mention,
      fields: [
        { name: 'المرجع', value: ref, inline: true },
        { name: 'المستأجر', value: String(req.user.username), inline: true },
        { name: 'المزرعة', value: farmRow.name, inline: true },
        { name: 'المدة', value: days + ' يوم', inline: true },
        { name: 'الإيجار', value: money(rent) + '$', inline: true },
        { name: 'العربون المطلوب', value: money(deposit) + '$', inline: true },
        { name: 'بنك الشركة', value: cfg.bank_account, inline: false },
        { name: 'مهلة الدفع', value: Number(cfg.payment_window_hours) + ' ساعات من الآن', inline: false }
      ]
    });
    res.json({ success: true, ref, deposit, rent, farm_no: farmRow.id, farm_name: farmRow.name, message: `تم إنشاء الحجز ${ref} على ${farmRow.name} — حوّل العربون ${money(deposit)}$ على بنك الشركة واضغط «دفعت العربون» — وبعد تأكيده حوّل النص الثاني قبل بداية الحجز` });
  } catch (e) {
    console.error('[farm] book:', e.message);
    res.status(500).json({ error: 'خطأ بإنشاء الحجز' });
  }
});

// المستأجر أعلن أنو حوّل العربون
router.post('/bookings/:id/mark-paid', isAuthenticated, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM farm_bookings WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'الحجز غير موجود' });
    const b = rows[0];
    if (b.status !== 'pending_payment') return res.status(400).json({ error: 'هذا الحجز مو بانتظار الدفع' });
    await db.execute("UPDATE farm_bookings SET status = 'pending_confirm' WHERE id = ?", [b.id]);
    await logEvent(b.id, req.user.username, 'user', 'mark_paid', 'أعلن تحويل العربون — بانتظار تأكيد الإدارة');
    const cfg = await getConfig();
    farmNotify({
      title: '💰 المستأجر أعلن تحويل العربون — يلزم التحقق',
      color: 0xf5c453,
      content: cfg.ping_mention,
      fields: [
        { name: 'المرجع', value: b.ref, inline: true },
        { name: 'المستأجر', value: b.username, inline: true },
        { name: 'العربون', value: money(b.deposit_amount) + '$', inline: true },
        { name: 'بنك الشركة', value: cfg.bank_account, inline: false },
        { name: 'الإجراء', value: 'لوحة الإدارة ← إدارة الخدمات ← تأكيد استلام العربون', inline: false }
      ]
    });
    res.json({ success: true, message: 'تم — راح تراجع الإدارة وصول المبلغ وتأكد حجزك' });
  } catch (e) {
    console.error('[farm] mark-paid:', e.message);
    res.status(500).json({ error: 'خطأ' });
  }
});

// المستأجر أعلن تحويل النص الثاني (باقي الإيجار) — لازم يكون قبل ساعة من بداية الحجز
router.post('/bookings/:id/remainder-mark-paid', isAuthenticated, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM farm_bookings WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'الحجز غير موجود' });
    const b = rows[0];
    if (b.status !== 'confirmed') return res.status(400).json({ error: 'هذا الحجز مو بانتظار النص الثاني' });
    if ((b.remainder_status || 'pending_payment') !== 'pending_payment') return res.status(400).json({ error: 'أعلنت الدفع مسبقاً — بانتظار تأكيد الإدارة' });
    const dl = toIso(b.remainder_deadline);
    if (dl && Date.now() > new Date(dl).getTime() - FORFEIT_BUFFER_HOURS * 3600e3) {
      return res.status(400).json({ error: 'انتهى موعد تحويل النص الثاني (قبل بداية الحجز بساعة) — راجع إدارة الشركة' });
    }
    await db.execute("UPDATE farm_bookings SET remainder_status = 'pending_confirm' WHERE id = ?", [b.id]);
    await logEvent(b.id, req.user.username, 'user', 'remainder_paid', 'أعلن تحويل النص الثاني — بانتظار تأكيد الإدارة');
    const cfg = await getConfig();
    farmNotify({
      title: '💰 المستأجر أعلن تحويل النص الثاني — يلزم التحقق',
      color: 0xf5c453,
      content: cfg.ping_mention,
      fields: [
        { name: 'المرجع', value: b.ref, inline: true },
        { name: 'المستأجر', value: b.username, inline: true },
        { name: 'النص الثاني', value: money(b.remainder_amount) + '$', inline: true },
        { name: 'بنك الشركة', value: cfg.bank_account, inline: false },
        { name: 'الإجراء', value: 'لوحة الإدارة ← إدارة الخدمات ← تأكيد استلام النص الثاني', inline: false }
      ]
    });
    res.json({ success: true, message: 'تم — راح تراجع الإدارة وصول النص الثاني وينبدأ حجزك' });
  } catch (e) {
    console.error('[farm] remainder-mark-paid:', e.message);
    res.status(500).json({ error: 'خطأ' });
  }
});

// إلغاء الحجز (المستأجر) — خسارة 50% من العربون إذا كان معلن الدفع/مبدوء، وآخر موعد قبل البداية بـ 6 ساعات
router.post('/bookings/:id/cancel', isAuthenticated, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM farm_bookings WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'الحجز غير موجود' });
    const b = rows[0];
    const cfg = await getConfig();
    let penalty = 0;
    if (b.status === 'pending_payment') {
      penalty = 0; // ما دفع شي بعد
    } else if (b.status === 'pending_confirm' || b.status === 'confirmed') {
      penalty = Math.round(Number(b.deposit_amount) / 2); // 50% من العربون
    } else if (b.status === 'active') {
      const start = toIso(b.start_at);
      const cutoff = start ? new Date(start).getTime() - Number(cfg.cancel_cutoff_hours) * 3600e3 : 0;
      if (!(Date.now() <= cutoff)) {
        return res.status(400).json({ error: `ما ينعكس الإلغاء — الإلغاء متاح فقط قبل بدء الحجز بـ ${cfg.cancel_cutoff_hours} ساعات على الأقل` });
      }
      penalty = Math.round(Number(b.deposit_amount) / 2);
    } else {
      return res.status(400).json({ error: 'هذا الحجز ما ينلغى' });
    }
    await db.execute("UPDATE farm_bookings SET status = 'cancelled', cancel_penalty = ? WHERE id = ?", [penalty, b.id]);
    await logEvent(b.id, req.user.username, 'user', 'cancel', penalty > 0 ? `ألغى الحجز — خسر ${money(penalty)}$ من العربون` : 'ألغى الحجز قبل الدفع — بدون خسارة');
    farmNotify({
      title: '🚫 إلغاء حجز مزرعة',
      color: 0xef4444,
      fields: [
        { name: 'المرجع', value: b.ref, inline: true },
        { name: 'المستأجر', value: b.username, inline: true },
        { name: 'الخسارة', value: penalty > 0 ? money(penalty) + '$ (50% من العربون)' : 'بدون خسارة — قبل الدفع', inline: true },
        { name: 'المرتجع للعميل', value: penalty > 0 ? money(Number(b.deposit_amount) - penalty) + '$' : '—', inline: true }
      ]
    });
    res.json({ success: true, message: penalty > 0 ? `تم إلغاء الحجز — خسرت ${money(penalty)}$ من العربون والباقي ${money(Number(b.deposit_amount) - penalty)}$ راح يرجع لك` : 'تم إلغاء الحجز — بدون أي خسارة' });
  } catch (e) {
    console.error('[farm] cancel:', e.message);
    res.status(500).json({ error: 'خطأ' });
  }
});

// طلب تمديد — فقط قبل انتهاء الحجز بـ 24 ساعة (داخل النافذة)
router.post('/bookings/:id/extend', isAuthenticated, async (req, res) => {
  try {
    const days = parseInt(req.body.duration_days);
    if (!DURATIONS.includes(days)) return res.status(400).json({ error: 'المدة غير متاحة' });
    const [rows] = await db.execute('SELECT * FROM farm_bookings WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'الحجز غير موجود' });
    const b = rows[0];
    const cfg = await getConfig();
    if (b.status !== 'active') return res.status(400).json({ error: 'التمديد متاح للحجوزات الفعالة فقط' });
    if (b.extend_status === 'pending_payment' || b.extend_status === 'pending_confirm') {
      return res.status(400).json({ error: 'عندك طلب تمديد قائم بالفعل' });
    }
    const endMs = toIso(b.end_at) ? new Date(toIso(b.end_at)).getTime() : 0;
    if (!endMs) return res.status(400).json({ error: 'خطأ بوقت النهاية' });
    const w = Number(cfg.extend_window_hours);
    if (Date.now() < endMs - w * 3600e3) return res.status(400).json({ error: `التمديد متاح فقط خلال آخر ${w} ساعة قبل انتهاء الحجز` });
    if (Date.now() >= endMs) return res.status(400).json({ error: 'الحجز انتهى — ما ينعكس التمديد' });
    // المزرعة لازم تكون فاضية بعد النهاية (احتياط — ما تنحجز مستقبلاً)
    const [clash] = await db.execute(
      `SELECT id FROM farm_bookings WHERE farm_id = ? AND id != ? AND (status = 'pending_confirm' OR status = 'confirmed' OR (status = 'pending_payment' AND payment_deadline > NOW())) LIMIT 1`,
      [b.farm_id, b.id]);
    if (clash.length) return res.status(400).json({ error: 'المزرعة محجوزة بعد انتهاء حجزك — غير متوفر التمديد' });

    const rent = priceOf(cfg, days);
    const deposit = Math.round(rent * Number(cfg.deposit_pct) / 100);
    await db.execute(
      `UPDATE farm_bookings SET extend_days = ?, extend_rent = ?, extend_deposit = ?, extend_status = 'pending_payment', extend_deadline = DATE_ADD(NOW(), INTERVAL ? HOUR) WHERE id = ?`,
      [days, rent, deposit, Number(cfg.payment_window_hours), b.id]);
    await logEvent(b.id, req.user.username, 'user', 'extend_req', `طلب تمديد ${days} يوم — عربون ${money(deposit)}$`);
    farmNotify({
      title: '⏳ طلب تمديد حجز — بانتظار العربون',
      color: 0xbc13fe,
      content: cfg.ping_mention,
      fields: [
        { name: 'المرجع', value: b.ref, inline: true },
        { name: 'المستأجر', value: b.username, inline: true },
        { name: 'التمديد', value: days + ' يوم', inline: true },
        { name: 'العربون المطلوب', value: money(deposit) + '$', inline: true },
        { name: 'بنك الشركة', value: cfg.bank_account, inline: false }
      ]
    });
    res.json({ success: true, message: `تم إنشاء طلب التمديد — حوّل العربون ${money(deposit)}$ واضغط «دفعت عربون التمديد»` });
  } catch (e) {
    console.error('[farm] extend:', e.message);
    res.status(500).json({ error: 'خطأ' });
  }
});

// المستأجر أعلن دفع عربون التمديد
router.post('/bookings/:id/extend-mark-paid', isAuthenticated, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM farm_bookings WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'الحجز غير موجود' });
    const b = rows[0];
    if (b.extend_status !== 'pending_payment') return res.status(400).json({ error: 'ما في تمديد بانتظار الدفع' });
    await db.execute("UPDATE farm_bookings SET extend_status = 'pending_confirm' WHERE id = ?", [b.id]);
    await logEvent(b.id, req.user.username, 'user', 'extend_paid', 'أعلن دفع عربون التمديد — بانتظار تأكيد الإدارة');
    farmNotify({
      title: '💰 المستأجر أعلن دفع عربون التمديد — يلزم التحقق',
      color: 0xf5c453,
      content: (await getConfig()).ping_mention,
      fields: [
        { name: 'المرجع', value: b.ref, inline: true },
        { name: 'المستأجر', value: b.username, inline: true },
        { name: 'عربون التمديد', value: money(b.extend_deposit) + '$', inline: true }
      ]
    });
    res.json({ success: true, message: 'تم — راح تراجع الإدارة وصول المبلغ' });
  } catch (e) {
    console.error('[farm] extend-mark-paid:', e.message);
    res.status(500).json({ error: 'خطأ' });
  }
});

// إضافة عامل — لازم اسم الشخصية كاملة وصحيحة كما في السيرفر
const NAME_RE = /^[A-Za-z]{2,16}_[A-Za-z]{2,16}(_[A-Za-z]{2,16})?$/;
router.post('/bookings/:id/workers', isAuthenticated, async (req, res) => {
  try {
    const name = String(req.body.character_name || '').trim();
    if (!NAME_RE.test(name)) {
      return res.status(400).json({ error: 'اكتب اسم الشخصية كاملة وصحيحة كما هو بالسيرفر (مثال: Hadi_Walton)' });
    }
    const [rows] = await db.execute('SELECT * FROM farm_bookings WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'الحجز غير موجود' });
    const b = rows[0];
    if (!['confirmed', 'active'].includes(b.status)) return res.status(400).json({ error: 'إضافة العمال متاحة بعد تأكيد استلام العربون — سجل عمالك قبل سداد النص الثاني ليجي أسماءهم بإشعار الإضافة' });
    const cfg = await getConfig();
    const [wrows] = await db.execute("SELECT COUNT(*) n FROM farm_workers WHERE booking_id = ? AND status IN ('pending_payment','pending_confirm','confirmed')", [b.id]);
    if (Number(wrows[0].n) >= Number(cfg.max_workers)) return res.status(400).json({ error: `الحد الأقصى ${cfg.max_workers} عمال` });
    const [dup] = await db.execute("SELECT id FROM farm_workers WHERE booking_id = ? AND character_name = ? AND status IN ('pending_payment','pending_confirm','confirmed')", [b.id, name]);
    if (dup.length) return res.status(400).json({ error: 'هذا الاسم مضاف بالفعل' });
    await db.execute('INSERT INTO farm_workers (booking_id, character_name, amount) VALUES (?, ?, ?)', [b.id, name, Number(cfg.worker_price)]);
    await logEvent(b.id, req.user.username, 'user', 'worker_add', `إضافة عامل: ${name} — ${money(cfg.worker_price)}$`);
    farmNotify({
      title: '👷 طلب إضافة عامل — بانتظار الدفع',
      color: 0xbc13fe,
      content: cfg.ping_mention,
      fields: [
        { name: 'المرجع', value: b.ref, inline: true },
        { name: 'المستأجر', value: b.username, inline: true },
        { name: 'اسم العامل', value: name, inline: true },
        { name: 'المبلغ', value: money(cfg.worker_price) + '$', inline: true }
      ]
    });
    res.json({ success: true, message: `تم إضافة العامل ${name} — حوّل ${money(cfg.worker_price)}$ واضغط «دفعت»` });
  } catch (e) {
    console.error('[farm] worker add:', e.message);
    res.status(500).json({ error: 'خطأ' });
  }
});

// المستأجر أعلن دفع مبلغ العامل
router.post('/workers/:id/mark-paid', isAuthenticated, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT w.*, b.user_id, b.ref FROM farm_workers w JOIN farm_bookings b ON w.booking_id = b.id WHERE w.id = ?', [req.params.id]);
    if (!rows.length || Number(rows[0].user_id) !== Number(req.user.id)) return res.status(404).json({ error: 'غير موجود' });
    const w = rows[0];
    if (w.status !== 'pending_payment') return res.status(400).json({ error: 'مو بانتظار الدفع' });
    await db.execute("UPDATE farm_workers SET status = 'pending_confirm' WHERE id = ?", [w.id]);
    await logEvent(w.booking_id, req.user.username, 'user', 'worker_paid', `أعلن دفع العامل ${w.character_name}`);
    farmNotify({
      title: '💰 أعلن المستأجر دفع مبلغ العامل — يلزم التحقق',
      color: 0xf5c453,
      content: (await getConfig()).ping_mention,
      fields: [
        { name: 'المرجع', value: w.ref, inline: true },
        { name: 'اسم العامل', value: w.character_name, inline: true },
        { name: 'المبلغ', value: money(w.amount) + '$', inline: true }
      ]
    });
    res.json({ success: true, message: 'تم — راح تراجع الإدارة وصول المبلغ' });
  } catch (e) {
    console.error('[farm] worker mark-paid:', e.message);
    res.status(500).json({ error: 'خطأ' });
  }
});

// حذف عامل قبل الدفع (تصحيح اسم مثلاً)
router.delete('/workers/:id', isAuthenticated, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT w.*, b.user_id FROM farm_workers w JOIN farm_bookings b ON w.booking_id = b.id WHERE w.id = ?', [req.params.id]);
    if (!rows.length || Number(rows[0].user_id) !== Number(req.user.id)) return res.status(404).json({ error: 'غير موجود' });
    if (rows[0].status !== 'pending_payment') return res.status(400).json({ error: 'ما ينحذف بعد إعلان الدفع' });
    await db.execute('DELETE FROM farm_workers WHERE id = ?', [rows[0].id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'خطأ' });
  }
});

/* ═══════════ نقاط الإدارة ═══════════ */

const adminRouter = express.Router();
adminRouter.use(checkPermission('company_edit'));

// بيانات الإدارة
adminRouter.get('/data', async (req, res) => {
  try {
    const cfg = await getConfig();
    const [bookings] = await db.execute(
      'SELECT b.*, f.name AS farm_name FROM farm_bookings b LEFT JOIN farm_farms f ON b.farm_id = f.id ORDER BY b.id DESC LIMIT 150');
    const [workers] = await db.execute('SELECT * FROM farm_workers ORDER BY id DESC LIMIT 300');
    const [events] = await db.execute('SELECT * FROM farm_events ORDER BY id DESC LIMIT 100');
    const [farmsRaw, busy] = await Promise.all([getFarms(), farmsBusy()]);
    res.json({
      config: cfg,
      busy,
      // إذا ما في ويبهوك مضبوط (WH_FARM/WH_COMPANY) كل إشعارات الإدارة تنصك بصمت — نحذر الإدارة بهذي العلامة
      webhook_ok: !!(webhooks.WH_FARM || webhooks.WH_COMPANY),
      farms: farmsRaw.map(f => ({
        id: f.id, name: f.name, enabled: Number(f.enabled) === 1,
        busy: !!busy[f.id], sort_order: Number(f.sort_order) || 0
      })),
      bookings: bookings.map(b => ({
        ...b,
        farm_name: b.farm_name || ('#' + (b.farm_id || b.farm_no)),
        statusLabel: STATUS_AR[b.status] || b.status,
        created_iso: toIso(b.created_at), start_iso: toIso(b.start_at), end_iso: toIso(b.end_at),
        deadline_iso: toIso(b.payment_deadline), deadline_left: deadlineLeft(b.payment_deadline),
        faction_added: Number(b.faction_added) === 1, faction_removed: Number(b.faction_removed) === 1,
        extend_deadline_iso: toIso(b.extend_deadline)
      })),
      workers: workers.map(w => ({ ...w, statusLabel: WSTATUS_AR[w.status] || w.status })),
      events
    });
  } catch (e) {
    console.error('[farm] admin data:', e.message);
    res.status(500).json({ error: 'خطأ' });
  }
});

// حفظ إعدادات الخدمة (الأسعار نص قابل للتعديل — المزارع تُدار من مدير المزارع)
adminRouter.post('/config', async (req, res) => {
  try {
    const b = req.body;
    const num = (v, def, max) => {
      const n = Math.round(Number(v));
      return isFinite(n) && n >= 0 && n <= (max || 9999999999) ? n : def;
    };
    const cfg = await getConfig();
    const vals = [
      String(b.bank_account || cfg.bank_account).slice(0, 64),
      num(b.price_1d, priceOf(cfg, 1)), num(b.price_3d, priceOf(cfg, 3)), num(b.price_5d, priceOf(cfg, 5)),
      num(b.price_7d, priceOf(cfg, 7)), num(b.price_10d, priceOf(cfg, 10)), num(b.price_14d, priceOf(cfg, 14)),
      num(b.worker_price, Number(cfg.worker_price)),
      Math.min(num(b.max_workers, Number(cfg.max_workers), 20), 20),
      Math.min(Math.max(num(b.deposit_pct, Number(cfg.deposit_pct), 100), 0), 100),
      Math.min(num(b.payment_window_hours, Number(cfg.payment_window_hours), 72), 72),
      Math.min(num(b.cancel_cutoff_hours, Number(cfg.cancel_cutoff_hours), 72), 72),
      Math.min(num(b.extend_window_hours, Number(cfg.extend_window_hours), 72), 72),
      Math.min(Math.max(num(b.remainder_window_hours, Number(cfg.remainder_window_hours || 6), 72), 1), 72),
      String(b.ping_mention || cfg.ping_mention).slice(0, 32)
    ];
    await db.execute(
      `UPDATE farm_config SET bank_account=?,
       price_1d=?, price_3d=?, price_5d=?, price_7d=?, price_10d=?, price_14d=?,
       worker_price=?, max_workers=?, deposit_pct=?, payment_window_hours=?,
       cancel_cutoff_hours=?, extend_window_hours=?, remainder_window_hours=?, ping_mention=?, updated_at=NOW() WHERE id=1`, vals);
    await logEvent(null, req.user.username, 'admin', 'config', 'تحديث إعدادات خدمة المزارع');
    res.json({ success: true });
  } catch (e) {
    console.error('[farm] config:', e.message);
    res.status(500).json({ error: 'خطأ بالحفظ' });
  }
});

/* ── إدارة المزارع (إضافة/تعديل/حذف غير محددة) ── */
adminRouter.post('/farms', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'اكتب اسم المزرعة' });
    const [mx] = await db.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 AS nxt FROM farm_farms');
    const [ins] = await db.execute('INSERT INTO farm_farms (name, enabled, sort_order) VALUES (?, 1, ?)', [name, Number(mx[0].nxt)]);
    await logEvent(null, req.user.username, 'admin', 'farm_add', `إضافة مزرعة: ${name}`);
    farmNotify({ title: '🏡 إضافة مزرعة جديدة', color: 0x34d399, fields: [
      { name: 'الاسم', value: name, inline: true }, { name: 'بواسطة', value: req.user.username, inline: true }
    ] });
    res.json({ success: true, id: ins.insertId });
  } catch (e) { console.error('[farm] farm add:', e.message); res.status(500).json({ error: 'خطأ بالإضافة' }); }
});

adminRouter.put('/farms/:id', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM farm_farms WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'المزرعة غير موجودة' });
    const f = rows[0];
    const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 100) : f.name;
    if (!name) return res.status(400).json({ error: 'الاسم ما ينعكس فاضي' });
    const enabled = req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : Number(f.enabled);
    await db.execute('UPDATE farm_farms SET name = ?, enabled = ? WHERE id = ?', [name, enabled, f.id]);
    await logEvent(f.id, req.user.username, 'admin', 'farm_update',
      `تعديل مزرعة: ${name} — ${enabled ? 'مفعلة' : 'موقوفة'}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'خطأ بالتعديل' }); }
});

adminRouter.delete('/farms/:id', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM farm_farms WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'المزرعة غير موجودة' });
    const [busy] = await db.execute(`SELECT id FROM farm_bookings WHERE farm_id = ? AND ${BUSY_WHERE} LIMIT 1`, [rows[0].id]);
    if (busy.length) return res.status(400).json({ error: 'لا تنحذف — عليها حجز قائم حالياً' });
    await db.execute('DELETE FROM farm_farms WHERE id = ?', [rows[0].id]);
    await logEvent(null, req.user.username, 'admin', 'farm_delete', `حذف مزرعة: ${rows[0].name}`);
    farmNotify({ title: '🗑️ حذف مزرعة', color: 0xef4444, fields: [
      { name: 'الاسم', value: rows[0].name, inline: true }, { name: 'بواسطة', value: req.user.username, inline: true }
    ] });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'خطأ بالحذف' }); }
});

async function getBooking(id) {
  const [rows] = await db.execute(
    'SELECT b.*, f.name AS farm_name FROM farm_bookings b LEFT JOIN farm_farms f ON b.farm_id = f.id WHERE b.id = ?', [id]);
  return rows[0] || null;
}

// تأكيد استلام العربون → الحجز «مؤكد» — البداية متجددة بعد مهلة النص الثاني (6 ساعات افتراضياً)
// ولا يطلع اشعار الإضافة للفاكشن إلا بعد تأكيد وصول النص الثاني
adminRouter.post('/bookings/:id/confirm-payment', async (req, res) => {
  try {
    const b = await getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'غير موجود' });
    if (b.status !== 'pending_confirm') return res.status(400).json({ error: 'الحجز مو بانتظار تأكيد الدفع' });
    const cfg = await getConfig();
    const remainder = Math.max(0, Number(b.rent_amount) - Number(b.deposit_amount));
    const rHours = Math.max(1, Number(cfg.remainder_window_hours) || 6);
    await db.execute(
      "UPDATE farm_bookings SET status = 'confirmed', remainder_amount = ?, remainder_status = 'pending_payment', remainder_deadline = DATE_ADD(NOW(), INTERVAL ? HOUR) WHERE id = ?",
      [remainder, rHours, b.id]);
    await logEvent(b.id, req.user.username, 'admin', 'confirm_payment',
      `تأكيد استلام العربون — الحجز مؤكد والبداية متجددة بعد ${rHours} ساعات إذا انسدد النص الثاني (${money(remainder)}$)`);
    /* تنبيه المستأجر — يوصله قبل بداية حجزه بـ rHours (6 ساعات افتراضياً) */
    const startStr = new Date(Date.now() + rHours * 3600e3 + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    const lastPayStr = new Date(Date.now() + (rHours - FORFEIT_BUFFER_HOURS) * 3600e3 + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    renterNotify(b.user_id, '⏰ تنبيه قبل بداية حجز مزرعتك بـ ' + rHours + ' ساعات',
      `عربون حجزك ${b.ref} انستلم ✅ — حجزك راح يبدأ بعد ${rHours} ساعات (${startStr}). ` +
      `لازم تحوّل النص الثاني ${money(remainder)}$ على بنك الشركة ${cfg.bank_account} قبل ${lastPayStr} — ` +
      `إذا ما حوّلته قبل بداية الحجز بساعة ينلغي الحجز وتخسر العربون ${money(b.deposit_amount)}$`);
    farmNotify({
      title: '✅ تم تأكيد استلام العربون — الحجز مؤكد',
      color: 0x34d399,
      description: `البداية متجددة بعد ${rHours} ساعات — بانتظار تحويل النص الثاني (${money(remainder)}$). ` +
        'اشعار الإضافة للفاكشن ما راح يطلع إلا بعد تأكيد وصول النص الثاني.',
      fields: [
        { name: 'المرجع', value: b.ref, inline: true },
        { name: 'المستأجر', value: b.username, inline: true },
        { name: 'المزرعة', value: b.farm_name || String(b.farm_no), inline: true },
        { name: 'المدة', value: b.duration_days + ' يوم', inline: true },
        { name: 'النص الثاني المطلوب', value: money(remainder) + '$', inline: true },
        { name: 'بداية الحجز المتجددة', value: startStr, inline: true },
        { name: 'بنك الشركة', value: cfg.bank_account, inline: false },
        { name: '⚠️ قبل البداية بساعة', value: `إذا ما انحول النص الثاني ينلغي الحجز ويخسر العربون (${money(b.deposit_amount)}$) — الإدارة تنبهل بالساعة`, inline: false }
      ]
    });
    res.json({ success: true });
  } catch (e) {
    console.error('[farm] confirm-payment:', e.message);
    res.status(500).json({ error: 'خطأ' });
  }
});

// تأكيد استلام النص الثاني → الحجز يبدأ + بس عندها يطلع اشعار الإضافة للفاكشن
adminRouter.post('/bookings/:id/confirm-remainder', async (req, res) => {
  try {
    const b = await getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'غير موجود' });
    if (b.status !== 'confirmed') return res.status(400).json({ error: 'الحجز مو بانتظار النص الثاني' });
    if ((b.remainder_status || 'pending_payment') !== 'pending_confirm') return res.status(400).json({ error: 'المستأجر ما أعلن تحويل النص الثاني بعد' });
    await db.execute(
      "UPDATE farm_bookings SET status = 'active', remainder_status = 'confirmed', start_at = NOW(), end_at = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id = ?",
      [Number(b.duration_days), b.id]);
    await logEvent(b.id, req.user.username, 'admin', 'confirm_remainder', `تأكيد استلام النص الثاني — انسدد كامل الإيجار وبدأ الحجز ${b.duration_days} يوم`);
    const cfg = await getConfig();
    const endStr = new Date(Date.now() + Number(b.duration_days) * 864e5 + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    /* أسماء العمال — المؤكدين يضافون مع المستأجر دفعة واحدة، والباقي يجي إشعارهم بعد دفعهم */
    let wAdd = [], wWait = [];
    try {
      const [wrows] = await db.execute(
        "SELECT character_name, status FROM farm_workers WHERE booking_id = ? AND status IN ('confirmed','pending_payment','pending_confirm') ORDER BY id ASC", [b.id]);
      wrows.forEach(w => {
        if (w.status === 'confirmed') wAdd.push(w.character_name);
        else wWait.push(w.character_name);
      });
    } catch (e) { console.error('[farm] workers for add:', e.message); }
    const addFields = [
      { name: 'المرجع', value: b.ref, inline: true },
      { name: 'المستأجر', value: b.username, inline: true },
      { name: 'المزرعة', value: b.farm_name || String(b.farm_no), inline: true },
      { name: 'المدة', value: b.duration_days + ' يوم', inline: true },
      { name: 'ينتهي', value: endStr, inline: true },
      { name: '👷 عمال يضافون معه (' + wAdd.length + ')', value: wAdd.length ? wAdd.join(' ، ') : 'لا يوجد', inline: false }
    ];
    if (wWait.length) addFields.push({ name: '⏳ عمال بانتظار تأكيد دفعهم (' + wWait.length + ')', value: wWait.join(' ، ') + ' — راح يجي إشعار خاص فيهم بعد تأكيد دفعهم', inline: false });
    farmNotify({
      title: '✅ انسدد كامل الإيجار — الحجز فعال',
      color: 0x34d399,
      content: cfg.ping_mention + ' لازم تضيفون المستأجر' + (wAdd.length ? ' وعماله' : '') + ' للفاكشن — تنبيه ساعي راح يذكر حتى التأكيد',
      fields: addFields
    });
    renterNotify(b.user_id, '🌾 بدأ حجز مزرعتك',
      `تم تأكيد استلام النص الثاني — حجزك ${b.ref} فعال الآن. بانتظار إضافتك لفاكشن العائلة من إدارة الشركة.`);
    res.json({ success: true });
  } catch (e) {
    console.error('[farm] confirm-remainder:', e.message);
    res.status(500).json({ error: 'خطأ' });
  }
});

// رفض النص الثاني (ما وصل) → إلغاء الحجز وخسارة المستأجر للعربون (فلوس أول تحويل)
adminRouter.post('/bookings/:id/reject-remainder', async (req, res) => {
  try {
    const b = await getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'غير موجود' });
    if (b.status !== 'confirmed') return res.status(400).json({ error: 'الحجز مو بانتظار النص الثاني' });
    if (!['pending_payment', 'pending_confirm'].includes(b.remainder_status || 'pending_payment')) return res.status(400).json({ error: 'ما ينعكس الرفض' });
    await db.execute(
      "UPDATE farm_bookings SET status = 'cancelled', remainder_status = 'rejected', cancel_penalty = ? WHERE id = ?",
      [Number(b.deposit_amount), b.id]);
    await logEvent(b.id, req.user.username, 'admin', 'reject_remainder',
      `رفض النص الثاني — انلغي الحجز وخسر المستأجر العربون (${money(b.deposit_amount)}$)`);
    farmNotify({
      title: '🚫 ما انأكد وصول النص الثاني — انلغي الحجز',
      color: 0xef4444,
      description: `المزرعة رجعت متاحة — المستأجر خسر العربون (${money(b.deposit_amount)}$) حسب نظام الشركة`,
      fields: [
        { name: 'المرجع', value: b.ref, inline: true },
        { name: 'المستأجر', value: b.username, inline: true },
        { name: 'بواسطة', value: req.user.username, inline: true }
      ]
    });
    renterNotify(b.user_id, '🚫 انلغي حجز مزرعتك',
      `ما انأكد وصول النص الثاني لحجزك ${b.ref} قبل الموعد — انلغي الحجز وخسرت العربون ${money(b.deposit_amount)}$ حسب نظام الشركة.`);
    res.json({ success: true });
  } catch (e) {
    console.error('[farm] reject-remainder:', e.message);
    res.status(500).json({ error: 'خطأ' });
  }
});

// تأكيد إضافة المستأجر للفاكشن (يوقف التنبيه الساعي)
adminRouter.post('/bookings/:id/faction-add', async (req, res) => {
  try {
    const b = await getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'غير موجود' });
    if (b.status !== 'active') return res.status(400).json({ error: 'الحجز مو فعال' });
    if (Number(b.faction_added) === 1) return res.status(400).json({ error: 'مؤكد مسبقاً' });
    await db.execute('UPDATE farm_bookings SET faction_added = 1, faction_added_at = NOW() WHERE id = ?', [b.id]);
    await logEvent(b.id, req.user.username, 'admin', 'faction_add', `تأكيد إضافة المستأجر ${b.username} للفاكشن`);
    farmNotify({ title: '🎖️ المستأجر انضاف للفاكشن', color: 0x34d399, fields: [
      { name: 'المرجع', value: b.ref, inline: true }, { name: 'المستأجر', value: b.username, inline: true }
    ] });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'خطأ' }); }
});

// تأكيد إزالة المستأجر المنتهي — تأكدين
adminRouter.post('/bookings/:id/remove-confirm-1', async (req, res) => {
  try {
    const b = await getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'غير موجود' });
    if (b.status !== 'ended') return res.status(400).json({ error: 'الحجز مو منتهي' });
    if (Number(b.faction_removed) === 1) return res.status(400).json({ error: 'مؤكد مسبقاً' });
    if (b.remove_confirm1_by) return res.status(400).json({ error: 'التأكيد الأول منجز — نفذ التأكيد الثاني' });
    await db.execute('UPDATE farm_bookings SET remove_confirm1_by = ?, remove_confirm1_at = NOW() WHERE id = ?', [req.user.username, b.id]);
    await logEvent(b.id, req.user.username, 'admin', 'remove_confirm_1', 'التأكيد الأول لإزالة المستأجر المنتهي');
    farmNotify({ title: '1️⃣ تأكيد أول — إزالة المستأجر المنتهي من الفاكشن', color: 0xeab308, fields: [
      { name: 'المرجع', value: b.ref, inline: true }, { name: 'المستأجر', value: b.username, inline: true },
      { name: 'بواسطة', value: req.user.username, inline: true }
    ], description: 'يلزم التأكيد الثاني لإتمام الإزالة' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'خطأ' }); }
});

adminRouter.post('/bookings/:id/remove-confirm-2', async (req, res) => {
  try {
    const b = await getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'غير موجود' });
    if (b.status !== 'ended') return res.status(400).json({ error: 'الحجز مو منتهي' });
    if (Number(b.faction_removed) === 1) return res.status(400).json({ error: 'مؤكد مسبقاً' });
    if (!b.remove_confirm1_by) return res.status(400).json({ error: 'نفذ التأكيد الأول أولاً' });
    await db.execute('UPDATE farm_bookings SET faction_removed = 1, remove_confirm2_by = ?, remove_confirm2_at = NOW() WHERE id = ?', [req.user.username, b.id]);
    await logEvent(b.id, req.user.username, 'admin', 'remove_confirm_2', 'التأكيد الثاني — انتهت إزالة المستأجر المنتهي');
    farmNotify({ title: '2️⃣ تمت إزالة المستأجر المنتهي من الفاكشن (تأكيد نهائي)', color: 0x34d399, fields: [
      { name: 'المرجع', value: b.ref, inline: true }, { name: 'المستأجر', value: b.username, inline: true },
      { name: 'بواسطة', value: req.user.username, inline: true }
    ] });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'خطأ' }); }
});

// تأكيد دفع عربون التمديد
adminRouter.post('/bookings/:id/confirm-extension', async (req, res) => {
  try {
    const b = await getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'غير موجود' });
    if (b.extend_status !== 'pending_confirm') return res.status(400).json({ error: 'ما في تمديد بانتظار التأكيد' });
    await db.execute("UPDATE farm_bookings SET end_at = DATE_ADD(end_at, INTERVAL ? DAY), extend_status = 'confirmed' WHERE id = ?",
      [Number(b.extend_days), b.id]);
    await logEvent(b.id, req.user.username, 'admin', 'confirm_extension', `تمديد ${b.extend_days} يوم — النهاية الجديدة مسجلة`);
    farmNotify({ title: '⏱️ تم تأكيد التمديد — زادت مدة الحجز', color: 0x34d399, fields: [
      { name: 'المرجع', value: b.ref, inline: true }, { name: 'المستأجر', value: b.username, inline: true },
      { name: 'التمديد', value: b.extend_days + ' يوم', inline: true }
    ] });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'خطأ' }); }
});

// إبطال حجز معلق يدوياً (قبل مهلته)
adminRouter.post('/bookings/:id/release', async (req, res) => {
  try {
    const b = await getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'غير موجود' });
    if (!['pending_payment', 'pending_confirm'].includes(b.status)) return res.status(400).json({ error: 'الحجز مو معلق' });
    await db.execute("UPDATE farm_bookings SET status = 'expired' WHERE id = ?", [b.id]);
    await logEvent(b.id, req.user.username, 'admin', 'release', 'إبطال حجز معلق يدوياً');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'خطأ' }); }
});

// إنهاء حجز فعال يدوياً
adminRouter.post('/bookings/:id/force-end', async (req, res) => {
  try {
    const b = await getBooking(req.params.id);
    if (!b) return res.status(404).json({ error: 'غير موجود' });
    if (b.status !== 'active') return res.status(400).json({ error: 'الحجز مو فعال' });
    await db.execute("UPDATE farm_bookings SET status = 'ended', end_at = NOW() WHERE id = ?", [b.id]);
    await logEvent(b.id, req.user.username, 'admin', 'force_end', 'إنهاء يدوي لحجز فعال');
    farmNotify({ title: '⏹️ إنهاء يدوي لحجز مزرعة', color: 0xef4444, fields: [
      { name: 'المرجع', value: b.ref, inline: true }, { name: 'المستأجر', value: b.username, inline: true }
    ], description: 'يلزم تأكيدا إزالة المستأجر من الفاكشن' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'خطأ' }); }
});

// تأكيد دفع عامل
adminRouter.post('/workers/:id/confirm', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT w.*, b.ref, b.username AS renter FROM farm_workers w JOIN farm_bookings b ON w.booking_id = b.id WHERE w.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'غير موجود' });
    const w = rows[0];
    if (w.status !== 'pending_confirm') return res.status(400).json({ error: 'العامل مو بانتظار التأكيد' });
    await db.execute("UPDATE farm_workers SET status = 'confirmed', confirmed_at = NOW() WHERE id = ?", [w.id]);
    await logEvent(w.booking_id, req.user.username, 'admin', 'worker_confirm', `تأكيد دفع العامل ${w.character_name}`);
    const cfg = await getConfig();
    farmNotify({
      title: '✅ تم تأكيد دفع العامل',
      color: 0x34d399,
      content: cfg.ping_mention + ' أضيفوا العامل للفاكشن',
      fields: [
        { name: 'المرجع', value: w.ref, inline: true },
        { name: 'اسم العامل', value: w.character_name, inline: true },
        { name: 'المبلغ', value: money(w.amount) + '$', inline: true },
        { name: 'المستأجر', value: w.renter, inline: true }
      ]
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'خطأ' }); }
});

// رفض عامل (اسم خاطئ مثلاً — يرجع المبلغ)
adminRouter.post('/workers/:id/reject', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM farm_workers WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'غير موجود' });
    if (!['pending_payment', 'pending_confirm'].includes(rows[0].status)) return res.status(400).json({ error: 'ما ينعكس الرفض' });
    await db.execute("UPDATE farm_workers SET status = 'rejected' WHERE id = ?", [rows[0].id]);
    await logEvent(rows[0].booking_id, req.user.username, 'admin', 'worker_reject', `رفض العامل ${rows[0].character_name}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'خطأ' }); }
});

router.use('/admin', adminRouter);

/* ═══════════ المهام الدورية ═══════════ */

// نبضة كل دقيقة: إلغاء تلقائي لتجاوز المهلة + إنهاء الحجوزات المنتهية + إبطال تمديدات غير المسددة
async function processTick() {
  // 1) انتهت مهلة الدفع
  const [expired] = await db.execute("SELECT * FROM farm_bookings WHERE status = 'pending_payment' AND payment_deadline <= NOW()");
  if (expired.length) {
    await db.execute("UPDATE farm_bookings SET status = 'expired' WHERE status = 'pending_payment' AND payment_deadline <= NOW()");
    const cfgE = await getConfig();
    for (const b of expired) {
      await logEvent(b.id, 'system', 'system', 'expire', `تجاوز مهلة الدفع (${b.payment_deadline}) — أُلغي تلقائياً`);
      farmNotify({ title: '⌛ انتهت مهلة الدفع — أُلغي الحجز تلقائياً', color: 0xef4444, fields: [
        { name: 'المرجع', value: b.ref, inline: true }, { name: 'المستأجر', value: b.username, inline: true },
        { name: 'المهلة', value: Number(cfgE.payment_window_hours) + ' ساعات', inline: true }
      ] });
    }
  }
  // 2) انتهت مهلة دفع تمديد
  const [extExp] = await db.execute("SELECT * FROM farm_bookings WHERE extend_status = 'pending_payment' AND extend_deadline <= NOW()");
  if (extExp.length) {
    await db.execute("UPDATE farm_bookings SET extend_days = NULL, extend_rent = NULL, extend_deposit = NULL, extend_status = '', extend_deadline = NULL WHERE extend_status = 'pending_payment' AND extend_deadline <= NOW()");
    for (const b of extExp) {
      await logEvent(b.id, 'system', 'system', 'extend_expire', 'تجاوز مهلة دفع عربون التمديد — أُلغي طلب التمديد');
      farmNotify({ title: '⌛ انتهت مهلة دفع التمديد — أُلغي طلب التمديد', color: 0xef4444, fields: [
        { name: 'المرجع', value: b.ref, inline: true }, { name: 'المستأجر', value: b.username, inline: true }
      ] });
    }
  }
  // 3) حجوزات وصلت نهايتها
  const [ended] = await db.execute(
    "SELECT b.*, f.name AS farm_name FROM farm_bookings b LEFT JOIN farm_farms f ON b.farm_id = f.id WHERE b.status = 'active' AND b.end_at <= NOW()");
  if (ended.length) {
    await db.execute("UPDATE farm_bookings SET status = 'ended' WHERE status = 'active' AND end_at <= NOW()");
    for (const b of ended) {
      await logEvent(b.id, 'system', 'system', 'end', 'وصل الحجز نهايته');
      farmNotify({
        title: '🏁 انتهى حجز المزرعة',
        color: 0xf5c453,
        description: `يلزم إزالة المستأجر المنتهي من الفاكشن — **تأكيدين** من لوحة الإدارة ← إدارة الخدمات`,
        fields: [
          { name: 'المرجع', value: b.ref, inline: true },
          { name: 'المستأجر', value: b.username, inline: true },
          { name: 'المزرعة', value: b.farm_name || String(b.farm_no), inline: true },
          { name: 'أُضيف للفاكشن؟', value: Number(b.faction_added) === 1 ? 'نعم' : 'لا', inline: true }
        ]
      });
    }
  }
  // 4) النص الثاني ما انحول قبل بداية الحجز بساعة → إلغاء تلقائي وخسارة العربون
  const [forfeit] = await db.execute(
    `SELECT b.*, f.name AS farm_name FROM farm_bookings b LEFT JOIN farm_farms f ON b.farm_id = f.id
     WHERE b.status = 'confirmed'
     AND (b.remainder_status = '' OR b.remainder_status = 'pending_payment' OR b.remainder_status IS NULL)
     AND b.remainder_deadline IS NOT NULL
     AND DATE_SUB(b.remainder_deadline, INTERVAL ${FORFEIT_BUFFER_HOURS} HOUR) <= NOW()`);
  if (forfeit.length) {
    const ids = forfeit.map(b => b.id);
    await db.execute(
      `UPDATE farm_bookings SET status = 'cancelled', remainder_status = '', cancel_penalty = deposit_amount
       WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    for (const b of forfeit) {
      await logEvent(b.id, 'system', 'system', 'remainder_forfeit',
        `النص الثاني ما انحول قبل بداية الحجز بساعة — انلغي تلقائياً وخسر العربون (${money(b.deposit_amount)}$)`);
      farmNotify({
        title: '❌ ما انحول النص الثاني — انلغي الحجز تلقائياً',
        color: 0xef4444,
        description: `وصل قبل بداية الحجز بساعة وما انحول النص الثاني — المزرعة رجعت متاحة والمستأجر خسر العربون (${money(b.deposit_amount)}$)`,
        fields: [
          { name: 'المرجع', value: b.ref, inline: true },
          { name: 'المستأجر', value: b.username, inline: true },
          { name: 'المزرعة', value: b.farm_name || String(b.farm_no), inline: true }
        ]
      });
      renterNotify(b.user_id, '❌ انلغي حجز مزرعتك',
        `وصل قبل بداية حجزك ${b.ref} ساعة وما انحول النص الثاني (${money(Number(b.rent_amount) - Number(b.deposit_amount))}$) — ` +
        `انلغي الحجز تلقائياً وخسرت العربون ${money(b.deposit_amount)}$ حسب نظام الشركة.`);
    }
  }
}

// تنبيه ساعي: مستأجرين فعالين لسا ما انضافوا للفاكشن
async function pingFactionAdds() {
  const [rows] = await db.execute("SELECT * FROM farm_bookings WHERE status = 'active' AND faction_added = 0");
  if (!rows.length) return;
  const cfg = await getConfig();
  /* أسماء العمال المؤكدين لكل حجز — تذكر الإدارة يدخلهم مع المستأجر */
  const wmap = {};
  try {
    const ids = rows.map(b => b.id);
    const [wrows] = await db.execute(
      `SELECT booking_id, character_name FROM farm_workers WHERE booking_id IN (${ids.map(() => '?').join(',')}) AND status = 'confirmed'`, ids);
    wrows.forEach(w => { const k = Number(w.booking_id); (wmap[k] = wmap[k] || []).push(w.character_name); });
  } catch (e) {}
  for (const b of rows) {
    const startMs = toIso(b.start_at) ? new Date(toIso(b.start_at)).getTime() : 0;
    const hours = startMs ? Math.max(0, Math.floor((Date.now() - startMs) / 3600e3)) : 0;
    const wNames = wmap[Number(b.id)] || [];
    farmNotify({
      title: '📣 تنبيه ساعي — مستأجر بانتظار إضافته للفاكشن',
      color: 0xbc13fe,
      content: cfg.ping_mention,
      fields: [
        { name: 'المرجع', value: b.ref, inline: true },
        { name: 'المستأجر', value: b.username, inline: true },
        { name: 'من بداية الحجز', value: hours + ' ساعة', inline: true },
        { name: '👷 العمال', value: wNames.length ? wNames.join(' ، ') : '—', inline: true }
      ]
    });
  }
}

function startFarmCron() {
  if (process.env.FARM_CRON === 'off') return;
  const cron = require('node-cron');
  cron.schedule('* * * * *', () => { processTick().catch(e => console.error('[farm-cron]', e.message)); });
  cron.schedule('5 * * * *', () => { pingFactionAdds().catch(e => console.error('[farm-cron]', e.message)); });
  console.log('🌾 Farm cron: tick every minute + faction-add ping hourly');
}

module.exports = { router, ensureFarmSchema, startFarmCron, getPublicState, processTick };
