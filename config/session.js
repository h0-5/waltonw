const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const mysql = require('mysql2');
const { EventEmitter } = require('events');
const pool = require('./database');

const sessionPool = mysql.createPool({
  ...pool.dbConfig,
  connectionLimit: 3, // جلسات فقط — بُكرة صغيرة تكفي (قاعدة بعيدة: الاتصال الجديد غالٍ)
  maxIdle: 3,
  idleTimeout: 300000
});

const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: parseInt(process.env.SESSION_MAX_AGE) || 2592000000,
  createDatabaseTable: true,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
}, sessionPool);

/* ── كاش قراءة ميموري للجلسات (تخفيف Aiven: قاعدة بعيدة ~60ms لكل طلب) ──
   كانت قراءة الجلسة = استعلام MySQL للقاعدة الخارجية على كل طلب للمسجل.
   هنا: القارئات المتكررة تصرف من الذاكرة (ابتداءً <30s) — الجلسات في هذا الموقع
   شبه ثابتة (passport.user id + returnTo فقط)، فالتجمد القصير غير مؤثر.
   أي تعديل (set/destroy/touch) يحدّث الذاكرة فوراً + القاعدة — والكتابة دائماً من
   نفس العملية، فلا يوجد مصدر خارجي يغيّر الجلسات خلف ظهرنا (مقبول حتى 30s).
   إعادة التشغيل فقط تتسبب بزيارة MySQL واحدة لكل مستخدم (مقبول). */
const SESSION_CACHE_TTL = 30 * 1000;
const sessionReadCache = new Map(); // sid -> { data, at }

/* express-session требует EventEmitter من الـ store (يتصل بالـ on('disconnect'))
   — نلحقه بالوراثة ونعيد بث أحداث الخادم الأساسي */
class CachedMySQLStore extends EventEmitter {
  get(sid, cb) {
    const hit = sessionReadCache.get(sid);
    if (hit && (Date.now() - hit.at) < SESSION_CACHE_TTL) return cb(null, hit.data);
    sessionStore.get(sid, (err, data) => {
      if (!err && data) sessionReadCache.set(sid, { data, at: Date.now() });
      cb(err, data);
    });
  }
  set(sid, data, cb) {
    sessionReadCache.set(sid, { data, at: Date.now() });
    sessionStore.set(sid, data, cb);
  }
  destroy(sid, cb) {
    sessionReadCache.delete(sid);
    sessionStore.destroy(sid, cb);
  }
  touch(sid, data, cb) {
    sessionReadCache.set(sid, { data, at: Date.now() });
    if (sessionStore.touch) sessionStore.touch(sid, data, cb);
    else cb();
  }
  all(cb) { sessionStore.all(cb); }
  createSession(req, sess) {
    /* عقد express-session ≥1.19 (index.js سطر 387): store.createSession(req, sess)
       بوسيطين — والدالة مسؤولة عن تحويل sess.cookie لنسخة Cookie وتسبيق req.session
       بنفسها (Store.prototype.createSession). التمرير بوسيط واحد كان يجعل req يدخل
       مكان sess فترمي Store TypeError (reading 'cookie') داخل inflate → caught →
       next(e) → 500 لكل طلب يحمل كوكي جلسة صالح (حلقة 500 الكاملة للموقع).
       الحل: تفويض الوسيطين كما هما للمخزن الحقيقي اللي يرث التنفيذ الصحيح. */
    return sessionStore.createSession(req, sess);
  }
  clear(cb) {
    sessionReadCache.clear();
    sessionStore.clear(cb);
  }
  length(cb) { sessionStore.length(cb); }
}
const cachedSessionStore = new CachedMySQLStore();
// إعادة بث أحداث الاتصال/الانقطاع من الـ store الميانية (التي تعرف متى تغلق القاعدة)
['disconnect', 'connect', 'error'].forEach(ev => {
  sessionStore.on(ev, (...a) => cachedSessionStore.emit(ev, ...a));
});

// Periodic cleanup of stale cache entries
setInterval(() => {
  const now = Date.now();
  sessionReadCache.forEach((v, k) => { if (now - v.at > SESSION_CACHE_TTL) sessionReadCache.delete(k); });
}, 30 * 1000).unref();

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'walton_family_secret',
  store: cachedSessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 2592000000,
    sameSite: 'lax'
  },
  name: 'wf_session'
};

module.exports = sessionConfig;