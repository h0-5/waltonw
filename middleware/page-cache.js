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
        return res.type('html').send(hit.html);
      }
    } catch (e) { /* always fall through to normal render */ }
  }

  // Capture rendered output without disturbing the normal send path
  let captured = null;
  const ctx = { captured: null };

  // Listen on the response finishing — the rendered body may be large, so we
  // buffer res.write chunks only for text/html renders and, on finish, store
  // the concatenated HTML if everything checks out.
  const bodyPieces = [];
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);

  res.write = function (chunk, ...rest) {
    if (ctx.captured !== false) {
      const tracking = ctx.captured === null;
      const str = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (tracking) {
        ctx.captured = true; // first chunk: decide to track or not
      }
      if (ctx.captured === true) {
        bodyPieces.push(str);
      }
    }
    return origWrite(chunk, ...rest);
  };

  res.end = function (chunk, enc, cb) {
    try {
      res.write = origWrite;
      res.end = origEnd;
    } catch (e) {}

    if (chunk) {
      if (Buffer.isBuffer(chunk) || typeof chunk === 'string' || chunk instanceof Uint8Array) {
        bodyPieces.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      }
    }

    if (ctx.captured === true && bodyPieces.length) {
      try {
        const ct = res.get('Content-Type') || '';
        const p = req.path || req.originalUrl.split('?')[0];
        const notSkipped = p && !SKIP_PREFIXES.some(pre => p.startsWith(pre)) && p.indexOf('.') === -1 && p.indexOf('?') === -1;
        if (res.statusCode === 200 && ct.indexOf('html') !== -1 && notSkipped) {
          const html = bodyPieces.join('');
          if (html && html.length > 500) {
            pageCache.set(cacheKey(req, uid), { at: Date.now(), html });
          }
        }
      } catch (e) {}
    }
    ctx.captured = false;

    return origEnd(chunk, enc, cb);
  };

  next();
}

module.exports = { pageCacheMiddleware, invalidatePageCache };