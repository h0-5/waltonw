/**
 * Walton Family — Visit Analytics Middleware
 * Tracks daily page views per path + unique visitors (cookie-based).
 * - Fire-and-forget DB writes (never blocks or breaks the request)
 * - Skips: admins panel, APIs, auth, static assets, bots
 * - Self-initializes its tables on first use
 */
const crypto = require('crypto');
const db = require('../config/database');

let initPromise = null;
let writeFailStreak = 0;
let lastFailLog = 0;
function ensureTables() {
  if (!initPromise) {
    initPromise = (async () => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS site_visits (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          visit_date DATE NOT NULL,
          path VARCHAR(191) NOT NULL,
          views INT UNSIGNED NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_date_path (visit_date, path),
          INDEX idx_visit_date (visit_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS visit_uniques (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          visit_date DATE NOT NULL,
          visitor_id VARCHAR(64) NOT NULL,
          UNIQUE KEY uq_date_visitor (visit_date, visitor_id),
          INDEX idx_vu_date (visit_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS bot_visits (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          visit_date DATE NOT NULL,
          path VARCHAR(191) NOT NULL,
          views INT UNSIGNED NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_bot_date_path (visit_date, path),
          INDEX idx_bot_visit_date (visit_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    })().catch(err => {
      console.error('[analytics] table init failed:', err.message);
      initPromise = null; // allow retry on next request
      throw err;
    });
  }
  return initPromise;
}

// Real bots/crawlers/tools only. In-app browsers (Discord/WhatsApp/Telegram) are
// REAL PEOPLE opening links from chat — they must count as human visits.
// Bare tokens like 'discord'/'whatsapp'/'telegram'/'bing'/'preview'/'node'
// caused false positives (in-app browsers, Safari Technology Preview...).
const BOT_RE = /bot|crawl|spider|slurp|bingbot|curl|wget|headless|lighthouse|facebookexternalhit|python-requests|axios|node-fetch|go-http-client|okhttp|libwww|java\/|httpclient|scrapy|semrush|ahrefs|mj12bot|dotbot|petalbot|phantomjs|selenium|puppeteer|playwright|pingdom|uptimerobot|monitor/i;
const SKIP_PREFIXES = [
  '/admin', '/api', '/auth', '/css/', '/js/', '/images/', '/fonts/',
  '/uploads/', '/favicon', '/robots.txt', '/site.webmanifest', '/manifest'
];

function getCookie(header, name) {
  if (!header) return null;
  const parts = header.split(';');
  for (let i = 0; i < parts.length; i++) {
    const idx = parts[i].indexOf('=');
    if (idx === -1) continue;
    if (parts[i].slice(0, idx).trim() === name) {
      try { return decodeURIComponent(parts[i].slice(idx + 1).trim()); }
      catch (e) { return parts[i].slice(idx + 1).trim(); }
    }
  }
  return null;
}

/* ── تحزئة الكتابة (تخفيف Railway) ──
   كل زيارة كانت تبعث 1-2 INSERT للقاعدة على مسار الطلب. الحين: العدادات تتجمع بالذاكرة
   وتنمسك دفعة واحدة كل 30 ثانية (upsert مجمّع لكل مسار + IGNORE مجمّع للزوار) —
   نفس الأرقام بالضبط (فقد محتمل ≤30 ثانية عند إعادة نشر فقط) بدون أي حمل على الطلبات */
const bufSiteViews = new Map();   // 'date|path' -> count
const bufBotViews = new Map();    // 'date|path' -> count
const bufUniques = new Set();     // 'date|vid'
const BUF_LIMIT = 20000;          // حاجم RAM لو القاعدة طاحت فترة طويلة
let flushing = false;

function bufKey(prefix, path) { return prefix + '|' + path; }
/* تاريخ اليوم بتوقيت +03 — نفس سلوك CURDATE() بالقاعدة (timezone +03:00) عشان الأيام تستمر بنفس الفواصل */
function localDate() { return new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); }

async function flushAnalytics(force) {
  if (flushing) return;
  if (!bufSiteViews.size && !bufBotViews.size && !bufUniques.size) return;
  flushing = true;
  const siteRows = [];
  bufSiteViews.forEach((n, k) => { const i = k.indexOf('|'); siteRows.push([k.slice(0, i), k.slice(i + 1), n]); });
  const botRows = [];
  bufBotViews.forEach((n, k) => { const i = k.indexOf('|'); botRows.push([k.slice(0, i), k.slice(i + 1), n]); });
  const uniqRows = [];
  bufUniques.forEach(k => { const i = k.indexOf('|'); uniqRows.push([k.slice(0, i), k.slice(i + 1)]); });
  if (force) { bufSiteViews.clear(); bufBotViews.clear(); bufUniques.clear(); }

  try {
    await ensureTables();
    const upsert = (table, rows) => {
      if (!rows.length) return Promise.resolve();
      const chunks = [];
      for (let i = 0; i < rows.length; i += 100) chunks.push(rows.slice(i, i + 100));
      return chunks.reduce((p, chunk) => p.then(() => db.execute(
        `INSERT INTO ${table} (visit_date, path, views) VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')}
         ON DUPLICATE KEY UPDATE views = views + VALUES(views)`,
        chunk.flat()
      )), Promise.resolve());
    };
    await upsert('site_visits', siteRows);
    await upsert('bot_visits', botRows);
    if (uniqRows.length) {
      for (let i = 0; i < uniqRows.length; i += 200) {
        const chunk = uniqRows.slice(i, i + 200);
        await db.execute(
          `INSERT IGNORE INTO visit_uniques (visit_date, visitor_id) VALUES ${chunk.map(() => '(?, ?)').join(', ')}`,
          chunk.flat()
        );
      }
    }
    if (!force) {
      /* نحسم فقط ما كان في اللقطة — اللي تجمّع أثناء الكتابة يبقى للدورة الجاية (بدون فقد) */
      const settle = (buf, rows) => rows.forEach(([d, p, n]) => {
        const k = d + '|' + p;
        const left = (buf.get(k) || 0) - n;
        if (left > 0) buf.set(k, left); else buf.delete(k);
      });
      settle(bufSiteViews, siteRows);
      settle(bufBotViews, botRows);
      uniqRows.forEach(([d, v]) => bufUniques.delete(d + '|' + v));
    }
    writeFailStreak = 0;
    // تنظيف دوري خفيف — نفس النسبة السابقة
    if (Math.random() < 0.02) {
      db.execute('DELETE FROM visit_uniques WHERE visit_date < DATE_SUB(CURDATE(), INTERVAL 120 DAY)').catch(() => {});
    }
  } catch (err) {
    writeFailStreak++;
    const now = Date.now();
    if (now - lastFailLog > 30000) {
      lastFailLog = now;
      console.error('[analytics] flush failed (x' + writeFailStreak + '):', err.message);
    }
  } finally {
    flushing = false;
  }
}

const flushTimer = setInterval(() => { flushAnalytics(false).catch(() => {}); }, 30 * 1000);
flushTimer.unref();
// تفريغ أخير عند الإيقاف المهذب — أقل فقد ممكن عند إعادة النشر
function flushOnExit() { try { flushAnalytics(true).catch(() => {}); } catch (e) {} }
process.once('SIGTERM', flushOnExit);
process.once('SIGINT', flushOnExit);

function trackVisit(req, res, next) {
  let shouldTrack = false;
  let isBotVisit = false;
  let trackAnyStatus = false;
  let isRealNavigation = true;
  let cleanPath = '/';
  let vid = null;

  try {
    if (req.method === 'GET') {
      const p = req.path || '';
      const skipped = SKIP_PREFIXES.some(pre => p === pre || p.startsWith(pre));
      if (!skipped && !p.includes('.')) {
        const ua = req.headers['user-agent'] || '';
        isBotVisit = !ua || ua.length < 10 || BOT_RE.test(ua);
        // Record ANY visitor — bots and humans alike
        // Bots are recorded even on non-200 (probes hitting 404s = security signal)
        shouldTrack = true;
        if (isBotVisit) trackAnyStatus = true;
        cleanPath = (p.length > 180 ? p.slice(0, 180) : p) || '/';

        /* ── تمييز التنقل الحقيقي عن السحب الخلفي (إصلاح مضاعفة الزيارات) ──
           السحب الخلفي بالافتتاحية (fetch) والأدوات الآلية يرسلون نفس GET —
           الفارق الموثوق: ترويسات Sec-Fetch (كل المتصفحات الحديثة):
             - التنقل الحقيقي: sec-fetch-dest: document
             - fetch/prefetch: sec-fetch-dest: empty (+sec-purpose: prefetch للسحب المسبق)
           المتصفحات القديمة بلا Sec-Fetch: التنقل يرسل Accept يبدأ text/html
           بينما fetch الافتراضي يرسل Accept عام — نفس الفصل بدون ترويسات.
           البوتات تظل تُسجَّل كلها (إشارة أمنية) بغض النظر عن النوع. */
        if (!isBotVisit) {
          const sp = String(req.headers['sec-purpose'] || '').toLowerCase();
          const sfd = String(req.headers['sec-fetch-dest'] || '').toLowerCase();
          if (sp === 'prefetch' || sp === 'prerender') isRealNavigation = false;
          else if (sfd) isRealNavigation = (sfd === 'document');
          else isRealNavigation = /text\/html/i.test(String(req.headers.accept || ''));
        }

        // Unique visitor id (1-year cookie) — humans only
        if (!isBotVisit) {
          vid = getCookie(req.headers.cookie, 'wf_vid');
          if (!vid || vid.length > 64) {
            vid = crypto.randomBytes(16).toString('hex');
          }
          res.cookie('wf_vid', vid, {
            maxAge: 365 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            sameSite: 'lax',
            path: '/'
          });
        }
      }
    }
  } catch (e) { /* never break the request */ }

  res.on('finish', () => {
    if (!shouldTrack) return;
    if (req.method !== 'GET') return;
    if (res.statusCode !== 200 && !trackAnyStatus) return;

    // تجميع بالذاكرة فقط — الصفر استعلامات على مسار الطلب
    if (bufSiteViews.size + bufBotViews.size < BUF_LIMIT) {
      /* زيارات البوتات: كلها تُسجَّل — زيارات البشر: التنقل الحقيقي فقط
         (السحب الخلفي للصفحات يصل السيرفر لكنه لا يُحسب زيارة) */
      if (!isBotVisit && !isRealNavigation) return;
      const target = isBotVisit ? bufBotViews : bufSiteViews;
      const k = bufKey(localDate(), cleanPath);
      target.set(k, (target.get(k) || 0) + 1);
      if (!isBotVisit && vid && bufUniques.size < BUF_LIMIT) bufUniques.add(localDate() + '|' + vid);
    }
  });

  next();
}

module.exports = { trackVisit, ensureTables, flushAnalytics };
