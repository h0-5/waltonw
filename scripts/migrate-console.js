const mysql = require('mysql2/promise');
(async () => {
  const url = new URL(process.env.DATABASE_URL || process.env.MYSQL_URL);
  const conn = await mysql.createConnection({
    host: url.hostname,
    port: parseInt(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.replace('/', ''),
    multipleStatements: true
  });
  const t = [
    `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, discord_id VARCHAR(50) UNIQUE, username VARCHAR(100), email VARCHAR(255), avatar TEXT, profile_picture TEXT, cover_photo TEXT, role VARCHAR(50) DEFAULT 'user', is_banned TINYINT(1) DEFAULT 0, ban_reason TEXT, is_muted TINYINT(1) DEFAULT 0, total_game_points INT DEFAULT 0, warn_count INT DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS user_sessions (id VARCHAR(128) PRIMARY KEY, expires INT UNSIGNED NOT NULL, data MEDIUMTEXT)`,
    `CREATE TABLE IF NOT EXISTS products (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), description TEXT, price DECIMAL(10,2), image TEXT, category VARCHAR(100), stock INT DEFAULT 0, is_active TINYINT(1) DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, product_id INT, quantity INT DEFAULT 1, total_price DECIMAL(10,2), status VARCHAR(50) DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS news (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), content TEXT, image TEXT, author_id INT, is_published TINYINT(1) DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS tickets (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, subject VARCHAR(255), message TEXT, status VARCHAR(50) DEFAULT 'open', priority VARCHAR(20) DEFAULT 'medium', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS site_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`,
    `CREATE TABLE IF NOT EXISTS roles (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) UNIQUE, level INT DEFAULT 0, color VARCHAR(20) DEFAULT '#ffffff', permissions TEXT)`,
    `CREATE TABLE IF NOT EXISTS rules (id INT AUTO_INCREMENT PRIMARY KEY, category VARCHAR(100), title VARCHAR(255), content TEXT, sort_order INT DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS discounts (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(50) UNIQUE, percentage INT DEFAULT 0, max_uses INT DEFAULT 0, used_count INT DEFAULT 0, expires_at DATETIME, is_active TINYINT(1) DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS banned_users (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, reason TEXT, banned_by INT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS broadcasts (id INT AUTO_INCREMENT PRIMARY KEY, message TEXT, type VARCHAR(50) DEFAULT 'info', is_active TINYINT(1) DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS application_types (id INT AUTO_INCREMENT PRIMARY KEY, application_type VARCHAR(100) UNIQUE, description TEXT, is_active TINYINT(1) DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS application_questions (id INT AUTO_INCREMENT PRIMARY KEY, application_type VARCHAR(100), question TEXT, question_type VARCHAR(50) DEFAULT 'text', is_required TINYINT(1) DEFAULT 1, sort_order INT DEFAULT 0, keyword VARCHAR(200))`,
    `CREATE TABLE IF NOT EXISTS application_submissions (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, application_type VARCHAR(100), answers JSON, status VARCHAR(50) DEFAULT 'pending', reviewed_by INT, review_note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS about_us_content (content_key VARCHAR(100) PRIMARY KEY, content_value TEXT)`,
    `CREATE TABLE IF NOT EXISTS company_items (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), description TEXT, image TEXT, video_url TEXT, category VARCHAR(100), sort_order INT DEFAULT 0, service_status VARCHAR(20) DEFAULT 'active')`,
    `CREATE TABLE IF NOT EXISTS properties (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), description TEXT, image TEXT, details JSON, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
  ];
  for (const s of t) {
    const n = s.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    await conn.query(s);
    console.log('✅ ' + n);
  }
  await conn.end();
  console.log('🎉 ALL DONE');
})();
