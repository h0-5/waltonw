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
    })().catch(err => {
      console.error('[analytics] table init failed:', err.message);
      initPromise = null; // allow retry on next request
      throw err;
    });
  }
  return initPromise;
}

const BOT_RE = /bot|crawl|spider|slurp|bing|preview|embed|curl|wget|headless|lighthouse|facebookexternalhit|whatsapp|telegram|discord|python-requests|axios|node|go-http/i;
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
  let cleanPath = '/';
  let vid = null;

  try {
    if (req.method === 'GET') {
      const p = req.path || '';
      const skipped = SKIP_PREFIXES.some(pre => p === pre || p.startsWith(pre));
      if (!skipped && !p.includes('.')) {
        const ua = req.headers['user-agent'] || '';
        if (ua && ua.length >= 10 && !BOT_RE.test(ua)) {
          shouldTrack = true;
          cleanPath = (p.length > 180 ? p.slice(0, 180) : p) || '/';

          // Unique visitor id (1-year cookie)
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
    if (req.method !== 'GET' || res.statusCode !== 200) return;

    ensureTables()
      .then(() => Promise.all([
        db.execute(
          'INSERT INTO site_visits (visit_date, path, views) VALUES (CURDATE(), ?, 1) ON DUPLICATE KEY UPDATE views = views + 1',
          [cleanPath]
        ),
        db.execute(
          'INSERT IGNORE INTO visit_uniques (visit_date, visitor_id) VALUES (CURDATE(), ?)',
          [vid]
        )
      ]))
      .then(() => {
        // Occasional housekeeping: purge unique-visitor rows older than 120 days
        if (Math.random() < 0.02) {
          db.execute('DELETE FROM visit_uniques WHERE visit_date < DATE_SUB(CURDATE(), INTERVAL 120 DAY)')
            .catch(() => {});
        }
      })
      .catch(() => { /* silent — analytics must never break the site */ });
  });

  next();
}

module.exports = { trackVisit, ensureTables };
