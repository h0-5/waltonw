const mysql = require('mysql2/promise');
require('dotenv').config();

function parseUrl(urlStr) {
  const url = new URL(urlStr);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.replace(/^\//, '')
  };
}

const baseConfig = {
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
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

pool.dbConfig = dbConfig;

module.exports = pool;
