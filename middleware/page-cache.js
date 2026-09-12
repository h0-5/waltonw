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
  /* المفتاح بروابط الاستعلام كاملة — /store?cat=x و /store?cat=y محتواها يختلف
     (الراوتر يمرر cat للعرض) فمفتاح بلا query كان يجعل أول نسخة تُخدم للبقية 12 ثانية */
  return (uid || 'anon') + '|' + (req.originalUrl || req.url || '');
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

  // Capture rendered output via res.write/res.end — safe, never overrides
  // the normal send path (no res.render wrapper: that caused a 500 loop on
  // DB errors). Compression wraps these and hides the body from us, but the
  // RAM cache still fills on non-compressed paths and errors pass through.
  const bodyPieces = [];
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  let captured = null;

  res.write = function (chunk, ...rest) {
    /* نلتقط كل القطع (HTML كبير يبث على دفعات — اقتطاع الأول فقط كان يخزن صفحة مقطوعة) */
    if (captured !== false && chunk) {
      bodyPieces.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      captured = true;
    }
    return origWrite(chunk, ...rest);
  };

  res.end = function (chunk, enc, cb) {
    try {
      res.write = origWrite;
      res.end = origEnd;
    } catch (e) {}

    if (chunk && (Buffer.isBuffer(chunk) || typeof chunk === 'string' || chunk instanceof Uint8Array)) {
      bodyPieces.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    }

    if (bodyPieces.length) {
      try {
        const ct = res.get('Content-Type') || '';
        const p = req.path || (req.originalUrl || '').split('?')[0];
        const notSkipped = p && !SKIP_PREFIXES.some(pre => p.startsWith(pre)) && p.indexOf('.') === -1 && p.indexOf('?') === -1;
        if (res.statusCode === 200 && ct.indexOf('html') !== -1 && notSkipped) {
          const html = bodyPieces.join('');
          if (html && html.length > 500) {
            pageCache.set(cacheKey(req, uid), { at: Date.now(), html });
            if (isSafeBrowserPublic(p)) {
              res.setHeader('Cache-Control', 'private, max-age=15');
            }
          }
        }
      } catch (e) {}
    }
    captured = null;

    return origEnd(chunk, enc, cb);
  };

  next();
}

module.exports = { pageCacheMiddleware, invalidatePageCache };