/**
 * Walton Family — Security Guard + الدرع الذكي (Smart Bot Shield)
 * 1. Blocks known attack tools (sqlmap, nikto...) instantly → 403
 * 2. Bot policy: 'log' | 'smart' | 'block'
 *      log   = تسجيل فقط
 *      smart = حظر بوتات UA العامة + فخ البوت + مسبار 404 — ومحركات البحث الموثوقة تمر (نسبة خطأ <1%)
 *      block = حظر كل تصنيف بوت (صارم)
 * 3. Rate + burst + 404-probe flood detection → auto-block IP (DB + memory cache)
 * 4. Honeypot: مسارات فخ لا يطلبها إنسان أبداً — أي طلب لها = سكانر
 * 5. Blocked IPs cached in memory (zero DB cost per request), refreshed every 60s
 * 6. الإعدادات كاملة من لوحة الحماية (site_settings: guard_config) — env احتياط للقيم الافتراضية
 */
const db = require('../config/database');

// ── الإعدادات الافتراضية (env ثم ثوابت) — كلها قابلة للتعديل من لوحة الحماية ──
const DEFAULT_CONFIG = {
  enabled: true,                                        // المفتاح الرئيسي للدرع
  botMode: (process.env.GUARD_BOT_MODE || 'log').toLowerCase(), // log | smart | block
  rateLimit: parseInt(process.env.GUARD_RATE_LIMIT) || 240,     // req/min → حظر
  burstLimit: parseInt(process.env.GUARD_BURST_LIMIT) || 80,    // req/10s → حظر
  autoBlockMinutes: parseInt(process.env.GUARD_AUTO_BLOCK_MINUTES) || 30,
  burstBlockMinutes: parseInt(process.env.GUARD_BURST_BLOCK_MINUTES) || 15,
  probeLimit: 25,                                       // خطأ 404/دقيقة → سلوك سكانر
  probeBlockMinutes: 20,
  honeypot: true,                                       // فخ المسارات الفخية
  honeypotBlockMinutes: 120,
  whitelist: []                                         // IPs ما تنحظر تلقائياً أبداً (الحظر اليدوي يظل)
};

/* إعدادات الذاكرة — تُحمّل من القاعدة عند الإقلاع وتتحدث فوراً عند الحفظ من اللوحة.
   الصفر استعلامات على مسار الطلب (طلب هادي: ما يثقل الموقع ولا يبطئه) */
let cfg = Object.assign({}, DEFAULT_CONFIG);

function clampConfig(raw) {
  const c = Object.assign({}, DEFAULT_CONFIG);
  if (!raw || typeof raw !== 'object') return c;
  c.enabled = raw.enabled !== false;
  if (['log', 'smart', 'block'].includes(raw.botMode)) c.botMode = raw.botMode;
  const num = (v, min, max, dflt) => {
    const n = parseInt(v, 10);
    /* غير رقم → الافتراضي، رقم خارج الحدود → أقرب حد صالح (التقييد لا الإلغاء) */
    if (!Number.isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, n));
  };
  c.rateLimit = num(raw.rateLimit, 30, 5000, DEFAULT_CONFIG.rateLimit);
  c.burstLimit = num(raw.burstLimit, 10, 2000, DEFAULT_CONFIG.burstLimit);
  c.autoBlockMinutes = num(raw.autoBlockMinutes, 5, 1440, DEFAULT_CONFIG.autoBlockMinutes);
  c.burstBlockMinutes = num(raw.burstBlockMinutes, 5, 1440, DEFAULT_CONFIG.burstBlockMinutes);
  c.probeLimit = num(raw.probeLimit, 5, 500, DEFAULT_CONFIG.probeLimit);
  c.probeBlockMinutes = num(raw.probeBlockMinutes, 5, 1440, DEFAULT_CONFIG.probeBlockMinutes);
  c.honeypotBlockMinutes = num(raw.honeypotBlockMinutes, 10, 1440, DEFAULT_CONFIG.honeypotBlockMinutes);
  c.honeypot = raw.honeypot !== false;
  if (Array.isArray(raw.whitelist)) {
    c.whitelist = raw.whitelist.map(x => String(x).trim()).filter(x => /^[\d.a-fA-F:]+$/.test(x) && x.length <= 45).slice(0, 50);
  }
  return c;
}

async function loadGuardSettings() {
  try {
    const [rows] = await db.execute('SELECT setting_value FROM site_settings WHERE setting_key = ?', ['guard_config']);
    if (rows && rows.length && rows[0].setting_value) {
      let raw;
      try { raw = JSON.parse(rows[0].setting_value); } catch (e) { return cfg; }
      cfg = clampConfig(raw);
    }
  } catch (e) { /* القاعدة غير جاهزة بعد — الافتراضيات تكفي */ }
  return cfg;
}

function getGuardConfig() { return cfg; }

/* تحديث من اللوحة: يطبق بالذاكرة فوراً + يخزن بالقاعدة */
async function setGuardConfig(partial) {
  cfg = clampConfig(Object.assign({}, cfg, partial));
  try {
    await db.execute(
      'INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
      ['guard_config', JSON.stringify(cfg), JSON.stringify(cfg)]
    );
  } catch (e) { /* الذاكرة تحمي حتى لو فشل التخزين */ }
  return cfg;
}

// Attack/scanner tools — instant permanent block
const KILL_RE = /sqlmap|nikto|nmap|masscan|zgrab|acunetix|netsparker|dirbuster|wpscan|havij|hydra|libwww|python-requests|go-http-client/i;
// General crawlers/bots
// Real bots/crawlers/tools only — in-app browsers (Discord/WhatsApp/Telegram)
// are real people, NOT bots. Bare 'discord|whatsapp|telegram|bing|preview'
// caused false positives and would block real users if bot mode blocks.
const BOT_RE = /bot|crawl|spider|slurp|bingbot|facebookexternalhit|headless|lighthouse|semrush|ahrefs|mj12bot|dotbot|petalbot|yandex|baidu|sogou|curl|wget|python-requests|go-http-client|scrapy|phantomjs|selenium|puppeteer|playwright|okhttp|libwww/i;
/* محركات بحث موثوقة — تُسجَّل ولا تُحظر حتى بالوضع الصارم (فهرسة صفحات الدخول العامة) */
const SEARCH_BOT_RE = /googlebot|bingbot|duckduckbot|slurp|yandexbot|yandeximages|baiduspider|applebot/i;

/* ── فخ البوت (Honeypot): مسارات لا يطلبها إنسان حقيقي أبداً ──
   روابط مخفية (display:none) بصفحة الدخول تشير إليها — العنكبوت الآمن يتبعها فيُحظر
   فوراً، والإنسان ما يشوفها أصلاً فلا يلمسها (نسبة خطأ ≈ 0). الماسحات الضوئية
   التي تجرب مسارات شائعة تسقط فيها مباشرة. */
const TRAP_RE = /^\/(wp-login\.php|wp-admin|phpmyadmin|\.env|\.git\/|backup\.zip|database\.sql|config\.php\.bak|admin\/config\.php|xmlrpc\.php|shell\.php|aspnet_client\/)/i;

let initPromise = null;
function ensureTables() {
  if (!initPromise) {
    initPromise = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS blocked_ips (
          ip VARCHAR(64) PRIMARY KEY,
          reason VARCHAR(191) NOT NULL DEFAULT 'unknown',
          user_agent VARCHAR(255) DEFAULT '',
          blocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NULL,
          INDEX idx_blocked_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    })().catch(err => {
      console.error('[guard] table init failed:', err.message);
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}
ensureTables().catch(() => {});
loadGuardSettings().catch(() => {});

// ── In-memory state ──
const blockedCache = new Map();   // ip -> expires epoch ms (null = permanent)
const minuteWin = new Map();      // ip -> { count, start }
const burstWin = new Map();       // ip -> { count, start }
const probeWin = new Map();       // ip -> { count, start }  خطأ 404/دقيقة
const botUAStats = new Map();     // ua -> hits (in-memory, resets on restart)
let lastBotTotal = 0;             // attacks blocked since boot

function isWhitelisted(ip) {
  return Array.isArray(cfg.whitelist) && cfg.whitelist.indexOf(ip) !== -1;
}

function classifyUA(ua) {
  if (!ua || ua.length < 10) return 'bot';
  if (KILL_RE.test(ua)) return 'killer';
  if (BOT_RE.test(ua)) return 'bot';
  return 'human';
}

async function blockIp(ip, reason, ua, minutes) {
  /* الحماية أولًا: الذاكرة فوراً حتى لو علقت القاعدة — التسجيل يجي بعدها */
  blockedCache.set(ip, minutes ? Date.now() + minutes * 60000 : null);
  lastBotTotal++;
  try {
    const expires = minutes ? new Date(Date.now() + minutes * 60000) : null;
    await db.execute(
      `INSERT INTO blocked_ips (ip, reason, user_agent, expires_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), user_agent = VALUES(user_agent), blocked_at = NOW(), expires_at = VALUES(expires_at)`,
      [ip, String(reason).slice(0, 180), String(ua || '').slice(0, 250), expires]
    );
  } catch (e) { /* cache still protects */ }
}

function deny(res, code, msg, retryAfter) {
  if (code === 429) res.setHeader('Retry-After', String(retryAfter || 60));
  res.status(code).type('text').send(msg);
}

function unblockIp(ip) {
  blockedCache.delete(ip);
  probeWin.delete(ip);
  return db.execute('DELETE FROM blocked_ips WHERE ip = ?', [ip]);
}

/* مسبار 404: يُستدعى من finish عند 404 — توقيع السكانر الواضح */
function probeHit(ip) {
  if (!cfg.enabled || isWhitelisted(ip)) return;
  const now = Date.now();
  let w = probeWin.get(ip);
  if (!w || now - w.start > 60000) { w = { count: 0, start: now }; probeWin.set(ip, w); }
  w.count++;
  if (w.count > cfg.probeLimit) {
    probeWin.delete(ip);
    blockIp(ip, '404-probe (' + w.count + ' x404/min — سلوك سكانر)', '', cfg.probeBlockMinutes);
  }
}

// ── Periodic refresh: pull DB blocks into memory + prune counters ──
setInterval(() => {
  ensureTables()
    .then(() => db.execute("SELECT ip, expires_at FROM blocked_ips WHERE expires_at IS NULL OR expires_at > NOW()"))
    .then(([rows]) => {
      const fresh = new Map();
      rows.forEach(r => {
        fresh.set(r.ip, r.expires_at ? new Date(String(r.expires_at).replace(' ', 'T')).getTime() : null);
      });
      // keep live auto-blocks that aren't persisted yet
      blockedCache.forEach((exp, ip) => { if (!fresh.has(ip)) fresh.set(ip, exp); });
      blockedCache.clear();
      fresh.forEach((v, k) => blockedCache.set(k, v));
    })
    .catch(() => {});
  const now = Date.now();
  [minuteWin, burstWin, probeWin].forEach(m => {
    m.forEach((v, k) => {
      if (now - v.start > 120000) m.delete(k);
    });
  });
}, 60000).unref();

// ── The middleware ──
function guard(req, res, next) {
  /* المفتاح الرئيسي مطفي → الدرع كله بمراجعة (ما حتى أدوات الهجوم؟ نعم — مطفي يعني مطفي) */
  if (!cfg.enabled) return next();

  const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
  const ua = req.headers['user-agent'] || '';
  const cls = classifyUA(ua);

  // 0) فخ البوت: مسارات لا يطلبها إنسان — أسرع وأصدق إشارة، قبل أي شيء
  if (cfg.honeypot && !isWhitelisted(ip) && TRAP_RE.test(req.path)) {
    blockIp(ip, 'honeypot-trap: ' + req.path.slice(0, 60), ua, cfg.honeypotBlockMinutes);
    return deny(res, 404, 'Not Found'); // ما نكشف أننا اكتشفناهم
  }

  // 1) Blocked cache (instant, no DB)
  if (blockedCache.has(ip)) {
    const until = blockedCache.get(ip);
    if (until === null || Date.now() < until) return deny(res, 429, 'Too Many Requests — محاولات كثيرة جداً، حاول لاحقاً', 60);
    blockedCache.delete(ip);
  }

  // 2) Attack tools → instant block (permanent) — حتى للقائمة البيضاء (أدوات هجوم لا رحمة)
  if (cls === 'killer') {
    blockIp(ip, 'attack-tool: ' + ua.slice(0, 60), ua, null);
    return deny(res, 403, 'Forbidden');
  }

  // 3) Bot policy — log | smart | block
  if (cls === 'bot') {
    botUAStats.set(ua.slice(0, 120), (botUAStats.get(ua.slice(0, 120)) || 0) + 1);
    if (cfg.botMode === 'block' && !isWhitelisted(ip)) {
      blockIp(ip, 'bot-blocked (mode=block): ' + ua.slice(0, 50), ua, cfg.autoBlockMinutes);
      return deny(res, 403, 'Bots are not allowed here');
    }
    if (cfg.botMode === 'smart' && !isWhitelisted(ip)) {
      /* الوضع الذكي: نحظر بوتات UA العامة — لكن محركات البحث الكبرى تمر مسجلة
         (عناكبها تلتزم robots.txt ولم تُرَ تخريب منها — إبقاؤها يفيد الفهرسة بلا خطر).
         إنسان حقيقي بـUA فيه 'bot'؟ لا يوجد متصفح حقيقي كذلك — وin-app
         browsers (Discord/واتساب/تيليغرام) مستبعدة من BOT_RE أصلاً. */
      if (SEARCH_BOT_RE.test(ua)) {
        // محرك بحث موثوق: يسجل ويمر (ويُحتسب بالفيضان أدناه كالجميع)
      } else {
        blockIp(ip, 'bot-blocked (mode=smart): ' + ua.slice(0, 50), ua, cfg.autoBlockMinutes);
        return deny(res, 403, 'Bots are not allowed here');
      }
    }
    // log mode: bots pass but still rate-counted below
  }

  // 4) Flood detection (applies to everyone, bots included)
  const now = Date.now();

  let min = minuteWin.get(ip);
  if (!min || now - min.start > 60000) { min = { count: 0, start: now }; minuteWin.set(ip, min); }
  min.count++;

  let burst = burstWin.get(ip);
  if (!burst || now - burst.start > 10000) { burst = { count: 0, start: now }; burstWin.set(ip, burst); }
  burst.count++;

  if (isWhitelisted(ip)) return next(); // القائمة البيضاء: تجتاز الفيضان والمسبار (ليس أدوات الهجوم)

  if (burst.count > cfg.burstLimit) {
    blockIp(ip, 'flood-burst (' + burst.count + ' req/10s)', ua, cfg.burstBlockMinutes);
    burstWin.delete(ip);
    return deny(res, 429, 'Too Many Requests — تم حظرك مؤقتاً بسبب الضغط', cfg.burstBlockMinutes * 60);
  }
  if (min.count > cfg.rateLimit) {
    blockIp(ip, 'rate-limit (' + min.count + ' req/min)', ua, cfg.autoBlockMinutes);
    minuteWin.delete(ip);
    return deny(res, 429, 'Too Many Requests — تم حظرك مؤقتاً (' + cfg.autoBlockMinutes + ' دقيقة)', cfg.autoBlockMinutes * 60);
  }

  // 5) مسبار 404 — نسمع النتيجة من finish (بعد ما يعرف الراوتر الرد)
  if (res.on) {
    res.on('finish', () => {
      try { if (res.statusCode === 404) probeHit(ip); } catch (e) {}
    });
  }

  next();
}

module.exports = {
  guard, classifyUA, blockIp, unblockIp, ensureTables, probeHit,
  botUAStats, blockedCache,
  getGuardConfig, setGuardConfig, loadGuardSettings, clampConfig, TRAP_RE, SEARCH_BOT_RE,
  stats: { get blockedTotal() { return lastBotTotal; } },
  KILL_RE, BOT_RE
};
