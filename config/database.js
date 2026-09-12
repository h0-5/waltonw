const mysql = require('mysql2/promise');
require('dotenv').config();

function parseUrl(urlStr) {
  const url = new URL(urlStr);
  const sslMode = (url.searchParams.get('ssl-mode') || url.searchParams.get('sslmode') || '').toUpperCase();
  const out = {
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '')
  };
  // SQL خارجي يفرض TLS (مثل Aiven بـ ssl-mode=REQUIRED) — يشغّل SSL تلقائياً.
  // لو حاط CA شهادة بـ MYSQL_CA نتأكد منها، وإلا اتصال مشفر بدون تحقق من الشهادة.
  const ca = process.env.MYSQL_CA || '';
  const wantsSSL = sslMode && sslMode !== 'DISABLED';
  const hostIsLocal = /localhost|127\.0\.0\.1|::1/.test(url.hostname);
  if ((wantsSSL && !hostIsLocal) || (!wantsSSL && process.env.MYSQL_SSL === '1')) {
    out.ssl = ca
      ? { rejectUnauthorized: true, ca }
      : { rejectUnauthorized: false };
  }
  return out;
}

const baseConfig = {
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  /* تخفيف Railway: الاتصالات الخاملة تنسكر بعد دقيقة — ما تنحجز مقاعد/ذاكرة بلا داعي
     (maxIdle أقل من connectionLimit يخلي الذروة ممكنة والراحة موفرة) */
  maxIdle: 4,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  timezone: '+03:00',
  dateStrings: true
};

let dbConfig;
let source = '';

const urlEnv = process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL;
if (urlEnv) {
  dbConfig = { ...parseUrl(urlEnv), ...baseConfig };
  source = `URL: ${urlEnv.replace(/\/\/.*@/, '//***@')}`;
} else {
  dbConfig = {
    host: process.env.DB_HOST || process.env.MYSQLHOST || process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || process.env.MYSQL_PORT || '3306'),
    user: process.env.DB_USER || process.env.MYSQLUSER || process.env.MYSQL_USER || 'root',
    password: process.env.DB_PASS || process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'walton_family',
    ...baseConfig
  };
  source = `HOST: ${dbConfig.host}:${dbConfig.port}, DB: ${dbConfig.database}`;
}

console.log('📦 DB source:', source);

const pool = mysql.createPool(dbConfig);

pool.getConnection()
  .then(conn => {
    console.log('✅ Database connected successfully');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

/* حارس يقظة القاعدة (Aiven free تنام بعد خمول فترتفع أول استعلام بعدها لثوانٍ —
   هذه النبضة كل 45 ثانية تبقيها متيقظة + الاتصالات حارة لأي طلب فوري) */
setInterval(() => {
  pool.query('SELECT 1').catch(() => { /* استمرار الحركة حتى لو انقطع لحظياً */ });
}, 45 * 1000).unref();

pool.dbConfig = dbConfig;

module.exports = pool;
