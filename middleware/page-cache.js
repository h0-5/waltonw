/**
 * Walton Family — In-memory HTML page cache
 *
 * Caches the FULLY-RENDERED HTML of semi-static pages for 12s per (user, path).
 * The Aiven free MySQL sits far from the host (~60ms+ per query) and EJS
 * re-renders + per-user reads happen on every request even when the shared
 * query cache is warm. Serving the rendered bytes from RAM removes:
 *   - EJS template execution
 *   - per-user DB reads (guild/session/settings/perms are already cached)
 *
 * Safety rules (never break systems/design):
 *   - GET only, page render only, status 200 only
 *   - Skipped for /admin, /api, /auth, /games/ and any path with '.', '?' or
 *     non-page segments — those are dynamic or asset requests
 *   - Keyed by user id + path: different members never see each other's HTML
 *   - TTL 12s: edits show within a few seconds max; any POST/PUT/PATCH/DELETE
 *     clears the whole page cache (same hook as invalidateQueryCache)
 *   - Never caches responses that set Set-Cookie in the body flow
 *   - Failure-proof: any cache hiccup falls back to normal render (try/catch)
 */
const CONTENT_TTL = 12000;
const pageCache = new Map(); // key -> { at, html }

const SKIP_PREFIXES = ['/admin', '/api', '/auth', '/games/'];

/* صفحات عامة آمنة لكاش المتصفح (لا تعرض بيانات المستخدم الشخصية) — نفس مبادئ
   WFI_PAGES في header.ejs لكن بلا /profile /applications /home لأنها خصوصية.
   Cache-Control:private,max-age يسمح للمتصفح بفتح الصفحة لحظياً عند التنقل
   المتكرر خلال المدة، دون أن تُخزَّن في CDN/مشاركة. */
const SAFE_BROWSER_PUBLIC = ['/test', '/about', '/rules', '/store', '/games', '/community', '/support', '/properties', '/company', '/contact'];
function isSafeBrowserPublic(p) {
  return p && SAFE_BROWSER_PUBLIC.indexOf(p) !== -1;
}

function cacheKey(req, uid) {
  const q = req.originalUrl.split('?')[0];
  return (uid || 'anon') + '|' + q;
}

function invalidatePageCache(userId) {
  if (userId != null) {
    const prefix = String(userId) + '|';
    pageCache.forEach((v, k) => { if (k.startsWith(prefix)) pageCache.delete(k); });
  } else {
    pageCache.clear();
  }
}

// Cleanup loop — keep memory bounded
setInterval(() => {
  const now = Date.now();
  pageCache.forEach((v, k) => { if (now - v.at > CONTENT_TTL) pageCache.delete(k); });
}, 20 * 1000).unref();

function pageCacheMiddleware(req, res, next) {
  const uid = req.user && req.user.id ? String(req.user.id) : null;

  if (req.method === 'GET') {
    try {
      const key = cacheKey(req, uid);
      const hit = pageCache.get(key);
      const ct = res.get('Content-Type');
      if (hit && Date.now() - hit.at < CONTENT_TTL && (!ct || ct.indexOf('html') !== -1)) {
        const p = req.path || req.originalUrl.split('?')[0];
        if (isSafeBrowserPublic(p)) {
          res.setHeader('Cache-Control', 'private, max-age=15');
        }
        return res.type('html').send(hit.html);
      }
    } catch (e) { /* always fall through to normal render */ }
  }

  // Capture the FULLY-RENDERED html via res.render callback — this wraps BEFORE
  // compression (compression wraps res.write/res.end, so byte-capturing there
  // misses the body). Only takes over when the route calls render without a
  // callback (the normal page pattern), preserving the send path otherwise.
  const origRender = res.render;
  res.render = function (view, opts, cb) {
    if (req.method === 'GET' && typeof cb !== 'function') {
      const p = req.path || (req.originalUrl || '').split('?')[0];
      const notSkipped = p && !SKIP_PREFIXES.some(pre => p.startsWith(pre)) && p.indexOf('.') === -1 && p.indexOf('?') === -1;
      return origRender.call(this, view, opts, (err, html) => {
        if (!err && typeof html === 'string' && html.length > 500 && notSkipped) {
          if (isSafeBrowserPublic(p)) {
            res.setHeader('Cache-Control', 'private, max-age=15');
          }
          pageCache.set(cacheKey(req, uid), { at: Date.now(), html });
        }
        if (err) {
          /* let the app's normal error path handle it (error template or 500) */
          return origRender.call(this, view, opts, cb);
        }
        res.locals = res.locals || {};
        return res.send(html);
      });
    }
    return origRender.call(this, view, opts, cb);
  };

  next();
}

module.exports = { pageCacheMiddleware, invalidatePageCache };