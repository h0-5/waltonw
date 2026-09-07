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

function trackVisit(req, res, next) {
  let shouldTrack = false;
  let isBotVisit = false;
  let trackAnyStatus = false;
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

    const writes = isBotVisit
      ? [db.execute(
          'INSERT INTO bot_visits (visit_date, path, views) VALUES (CURDATE(), ?, 1) ON DUPLICATE KEY UPDATE views = views + 1',
          [cleanPath]
        )]
      : [
        db.execute(
          'INSERT INTO site_visits (visit_date, path, views) VALUES (CURDATE(), ?, 1) ON DUPLICATE KEY UPDATE views = views + 1',
          [cleanPath]
        ),
        db.execute(
          'INSERT IGNORE INTO visit_uniques (visit_date, visitor_id) VALUES (CURDATE(), ?)',
          [vid]
        )
      ];

    ensureTables()
      .then(() => Promise.all(writes))
      .then(() => {
        writeFailStreak = 0;
        // Occasional housekeeping: purge unique-visitor rows older than 120 days
        if (!isBotVisit && Math.random() < 0.02) {
          db.execute('DELETE FROM visit_uniques WHERE visit_date < DATE_SUB(CURDATE(), INTERVAL 120 DAY)')
            .catch(() => {});
        }
      })
      .catch(err => {
        // Analytics must never break the site — but make failures visible
        // (throttled) in the logs so problems like missing tables get noticed.
        writeFailStreak++;
        const now = Date.now();
        if (now - lastFailLog > 30000) {
          lastFailLog = now;
          console.error('[analytics] write failed (x' + writeFailStreak + '):', err.message);
        }
      });
  });

  next();
}

module.exports = { trackVisit, ensureTables };
