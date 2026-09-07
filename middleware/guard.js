/**
 * Walton Family — Security Guard
 * 1. Blocks known attack tools (sqlmap, nikto...) instantly → 403
 * 2. Bot policy: 'log' (default, recorded only) or 'block' via GUARD_BOT_MODE
 * 3. Rate + burst flood detection → auto-block IP (DB + memory cache)
 * 4. Blocked IPs cached in memory (zero DB cost per request), refreshed every 60s
 *
 * Env knobs:
 *   GUARD_RATE_LIMIT        req/min/IP before auto-block      (default 240)
 *   GUARD_BURST_LIMIT       req/10s/IP before auto-block      (default 80)
 *   GUARD_AUTO_BLOCK_MINUTES  minutes for rate auto-block     (default 30)
 *   GUARD_BURST_BLOCK_MINUTES minutes for burst auto-block    (default 15)
 *   GUARD_BOT_MODE          'log' | 'block'                   (default log)
 */
const db = require('../config/database');

const RATE_LIMIT_PER_MIN = parseInt(process.env.GUARD_RATE_LIMIT) || 240;
const BURST_LIMIT = parseInt(process.env.GUARD_BURST_LIMIT) || 80;
const AUTO_BLOCK_MINUTES = parseInt(process.env.GUARD_AUTO_BLOCK_MINUTES) || 30;
const BURST_BLOCK_MINUTES = parseInt(process.env.GUARD_BURST_BLOCK_MINUTES) || 15;
const BOT_MODE = (process.env.GUARD_BOT_MODE || 'log').toLowerCase();

// Attack/scanner tools — instant permanent-ish block
const KILL_RE = /sqlmap|nikto|nmap|masscan|zgrab|acunetix|netsparker|dirbuster|wpscan|havij|hydra|libwww|python-requests|go-http-client/i;
// General crawlers/bots
const BOT_RE = /bot|crawl|spider|slurp|bing|preview|facebookexternalhit|whatsapp|telegram|discord|headless|lighthouse|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baidu|sogou|curl|wget/i;

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

// ── In-memory state ──
const blockedCache = new Map();   // ip -> expires epoch ms (null = permanent)
const minuteWin = new Map();      // ip -> { count, start }
const burstWin = new Map();       // ip -> { count, start }
const botUAStats = new Map();     // ua -> hits (in-memory, resets on restart)
let lastBotTotal = 0;             // attacks blocked since boot

function classifyUA(ua) {
  if (!ua || ua.length < 10) return 'bot';
  if (KILL_RE.test(ua)) return 'killer';
  if (BOT_RE.test(ua)) return 'bot';
  return 'human';
}

async function blockIp(ip, reason, ua, minutes) {
  try {
    const expires = minutes ? new Date(Date.now() + minutes * 60000) : null;
    await db.execute(
      `INSERT INTO blocked_ips (ip, reason, user_agent, expires_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), user_agent = VALUES(user_agent), blocked_at = NOW(), expires_at = VALUES(expires_at)`,
      [ip, String(reason).slice(0, 180), String(ua || '').slice(0, 250), expires]
    );
  } catch (e) { /* cache still protects */ }
  blockedCache.set(ip, minutes ? Date.now() + minutes * 60000 : null);
  lastBotTotal++;
}

function deny(res, code, msg, retryAfter) {
  if (code === 429) res.setHeader('Retry-After', String(retryAfter || 60));
  res.status(code).type('text').send(msg);
}

function unblockIp(ip) {
  blockedCache.delete(ip);
  return db.execute('DELETE FROM blocked_ips WHERE ip = ?', [ip]);
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
  [minuteWin, burstWin].forEach(m => {
    m.forEach((v, k) => {
      if (now - v.start > 120000) m.delete(k);
    });
  });
}, 60000).unref();

// ── The middleware ──
function guard(req, res, next) {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
  const ua = req.headers['user-agent'] || '';
  const cls = classifyUA(ua);

  // 1) Blocked cache (instant, no DB)
  if (blockedCache.has(ip)) {
    const until = blockedCache.get(ip);
    if (until === null || Date.now() < until) return deny(res, 429, 'Too Many Requests — محاولات كثيرة جداً، حاول لاحقاً', 60);
    blockedCache.delete(ip);
  }

  // 2) Attack tools → instant block (permanent)
  if (cls === 'killer') {
    blockIp(ip, 'attack-tool: ' + ua.slice(0, 60), ua, null);
    return deny(res, 403, 'Forbidden');
  }

  // 3) Bot policy
  if (cls === 'bot') {
    botUAStats.set(ua.slice(0, 120), (botUAStats.get(ua.slice(0, 120)) || 0) + 1);
    if (BOT_MODE === 'block') {
      blockIp(ip, 'bot-blocked (mode=block): ' + ua.slice(0, 50), ua, AUTO_BLOCK_MINUTES);
      return deny(res, 403, 'Bots are not allowed here');
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

  if (burst.count > BURST_LIMIT) {
    blockIp(ip, 'flood-burst (' + burst.count + ' req/10s)', ua, BURST_BLOCK_MINUTES);
    burstWin.delete(ip);
    return deny(res, 429, 'Too Many Requests — تم حظرك مؤقتاً بسبب الضغط', BURST_BLOCK_MINUTES * 60);
  }
  if (min.count > RATE_LIMIT_PER_MIN) {
    blockIp(ip, 'rate-limit (' + min.count + ' req/min)', ua, AUTO_BLOCK_MINUTES);
    minuteWin.delete(ip);
    return deny(res, 429, 'Too Many Requests — تم حظرك مؤقتاً (30 دقيقة)', AUTO_BLOCK_MINUTES * 60);
  }

  next();
}

module.exports = { guard, classifyUA, blockIp, unblockIp, ensureTables, botUAStats, blockedCache, stats: { get blockedTotal() { return lastBotTotal; } }, KILL_RE, BOT_RE };
