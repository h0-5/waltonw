const app = require('./app');
const db = require('./config/database');
const PORT = process.env.PORT || 3000;

async function migrate() {
  console.log('🔄 Running migration...');
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, discord_id VARCHAR(50) UNIQUE, username VARCHAR(100), email VARCHAR(255), avatar TEXT, profile_picture TEXT, cover_photo TEXT, role VARCHAR(50) DEFAULT 'user', is_banned TINYINT(1) DEFAULT 0, ban_reason TEXT, is_muted TINYINT(1) DEFAULT 0, total_game_points INT DEFAULT 0, warn_count INT DEFAULT 0, in_guild TINYINT(1) DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS user_sessions (id VARCHAR(128) PRIMARY KEY, expires INT UNSIGNED NOT NULL, data MEDIUMTEXT, INDEX sessions_expires(expires))`,
    `CREATE TABLE IF NOT EXISTS products (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), description TEXT, price DECIMAL(10,2), image TEXT, category VARCHAR(100), stock INT DEFAULT 0, is_active TINYINT(1) DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, product_id INT, quantity INT DEFAULT 1, total_price DECIMAL(10,2), status VARCHAR(50) DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS news (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), content TEXT, image TEXT, author_id INT, is_published TINYINT(1) DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS tickets (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, subject VARCHAR(255), message TEXT, status VARCHAR(50) DEFAULT 'open', priority VARCHAR(20) DEFAULT 'medium', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS site_settings (setting_key VARCHAR(100) PRIMARY KEY, setting_value TEXT)`,
    `CREATE TABLE IF NOT EXISTS roles (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) UNIQUE, display_name VARCHAR(100), level INT DEFAULT 0, color VARCHAR(20) DEFAULT '#ffffff', icon VARCHAR(50) DEFAULT '', is_admin_role TINYINT(1) DEFAULT 0, is_default TINYINT(1) DEFAULT 0, sort_order INT DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS role_permissions (id INT AUTO_INCREMENT PRIMARY KEY, role_id INT, page VARCHAR(100), can_access TINYINT(1) DEFAULT 1, can_edit TINYINT(1) DEFAULT 0, can_delete TINYINT(1) DEFAULT 0, can_manage TINYINT(1) DEFAULT 0, FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE, UNIQUE KEY unique_role_page (role_id, page))`,
    `CREATE TABLE IF NOT EXISTS rules (id INT AUTO_INCREMENT PRIMARY KEY, category VARCHAR(100), title VARCHAR(255), content TEXT, sort_order INT DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS discounts (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(50) UNIQUE, percentage INT DEFAULT 0, max_uses INT DEFAULT 0, used_count INT DEFAULT 0, expires_at DATETIME, is_active TINYINT(1) DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS banned_users (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, reason TEXT, banned_by INT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS broadcasts (id INT AUTO_INCREMENT PRIMARY KEY, message TEXT, type VARCHAR(50) DEFAULT 'info', is_active TINYINT(1) DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS application_types (id INT AUTO_INCREMENT PRIMARY KEY, application_type VARCHAR(100) UNIQUE, description TEXT, is_active TINYINT(1) DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS application_questions (id INT AUTO_INCREMENT PRIMARY KEY, application_type VARCHAR(100), question TEXT, question_type VARCHAR(50) DEFAULT 'text', is_required TINYINT(1) DEFAULT 1, sort_order INT DEFAULT 0, keyword VARCHAR(200))`,
    `CREATE TABLE IF NOT EXISTS application_submissions (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, application_type VARCHAR(100), answers JSON, status VARCHAR(50) DEFAULT 'pending', reviewed_by INT, review_note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS about_us_content (content_key VARCHAR(100) PRIMARY KEY, content_value TEXT)`,
    `CREATE TABLE IF NOT EXISTS company_items (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), description TEXT, image TEXT, video_url TEXT, category VARCHAR(100), sort_order INT DEFAULT 0, service_status VARCHAR(20) DEFAULT 'active')`,
    `CREATE TABLE IF NOT EXISTS properties (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), description TEXT, image TEXT, details JSON, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS fs_products (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), description TEXT, category_type VARCHAR(50), price_points INT DEFAULT 0, price_money DECIMAL(10,2) DEFAULT 0, stock INT DEFAULT 0, image TEXT, is_active TINYINT(1) DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS support_tickets (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, name VARCHAR(255), email VARCHAR(255), subject VARCHAR(255), message TEXT, priority VARCHAR(20) DEFAULT 'medium', status VARCHAR(20) DEFAULT 'open', admin_id INT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS ticket_replies (id INT AUTO_INCREMENT PRIMARY KEY, ticket_id INT, user_id INT, message TEXT, is_admin TINYINT(1) DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS bot_points (id INT AUTO_INCREMENT PRIMARY KEY, discord_id VARCHAR(50) UNIQUE, points INT DEFAULT 0, total_earned INT DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS discount_codes (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(100) UNIQUE, discount_percent INT DEFAULT 0, max_uses INT DEFAULT 0, current_uses INT DEFAULT 0, expires_at DATETIME, product_id INT, created_by INT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS admin_logs (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, username VARCHAR(100), action VARCHAR(255), target_type VARCHAR(50), target_id INT, target_name VARCHAR(255), details TEXT, ip VARCHAR(45), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS notifications (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, title VARCHAR(255), message TEXT, type VARCHAR(20) DEFAULT 'info', link TEXT, is_read TINYINT(1) DEFAULT 0, sender_id INT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS user_achievements (id INT AUTO_INCREMENT PRIMARY KEY, discord_id VARCHAR(50), achievement_name VARCHAR(100), earned_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS rule_categories (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), icon VARCHAR(50), sort_order INT DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS giveaway_participants (id INT AUTO_INCREMENT PRIMARY KEY, giveaway_id INT, user_id INT, username VARCHAR(100), platform VARCHAR(20) DEFAULT 'site')`,
    `CREATE TABLE IF NOT EXISTS giveaway_winners (id INT AUTO_INCREMENT PRIMARY KEY, giveaway_id INT, user_id INT, username VARCHAR(100), selected_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS application_settings (id INT AUTO_INCREMENT PRIMARY KEY, application_type VARCHAR(100) UNIQUE, status VARCHAR(20) DEFAULT 'open', title VARCHAR(255), description TEXT, requirements TEXT, icon VARCHAR(50), color VARCHAR(20))`,
    `CREATE TABLE IF NOT EXISTS submitted_applications (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, application_type VARCHAR(100), answers JSON, status VARCHAR(20) DEFAULT 'pending', reviewed_by INT, review_note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS service_questions (id INT AUTO_INCREMENT PRIMARY KEY, service_id INT, question TEXT, type VARCHAR(50) DEFAULT 'text', sort_order INT DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS service_packages (id INT AUTO_INCREMENT PRIMARY KEY, service_id INT, name VARCHAR(255), price DECIMAL(10,2), description TEXT, sort_order INT DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS service_requests (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, service_id INT, answers JSON, status VARCHAR(20) DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS sessions (session_id VARCHAR(128) PRIMARY KEY, expires INT UNSIGNED NOT NULL, data MEDIUMTEXT, INDEX sessions_expires(expires))`
  ];

  for (const sql of tables) {
    const name = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    try {
      await db.query(sql);
      console.log(`✅ ${name}`);
    } catch (err) {
      console.error(`❌ ${name}: ${err.message}`);
    }
  }
  console.log('✅ Migration done');

  // Seed default roles
  try {
    const [existing] = await db.query('SELECT COUNT(*) as c FROM roles');
    if (existing[0].c === 0) {
      const defaultRoles = [
        { name: 'owner', display_name: 'المالك', color: '#ef4444', icon: 'fa-crown', level: 100, is_admin_role: 1, is_default: 0 },
        { name: 'admin', display_name: 'مدير', color: '#f97316', icon: 'fa-shield-halved', level: 80, is_admin_role: 1, is_default: 0 },
        { name: 'moderator', display_name: 'مشرف', color: '#eab308', icon: 'fa-gavel', level: 60, is_admin_role: 1, is_default: 0 },
        { name: 'support', display_name: 'دعم فني', color: '#22c55e', icon: 'fa-headset', level: 40, is_admin_role: 1, is_default: 0 },
        { name: 'member', display_name: 'عضو', color: '#3b82f6', icon: 'fa-user', level: 10, is_admin_role: 0, is_default: 1 },
        { name: 'trial', display_name: 'تحت التجربة', color: '#9ca3af', icon: 'fa-user-clock', level: 5, is_admin_role: 0, is_default: 0 },
      ];
      for (const r of defaultRoles) {
        await db.query(
          'INSERT INTO roles (name, display_name, color, icon, level, is_admin_role, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [r.name, r.display_name, r.color, r.icon, r.level, r.is_admin_role, r.is_default]
        );
      }
      console.log('✅ Default roles seeded');
    }
  } catch(e) { console.error('Role seed error:', e.message); }
}

async function start() {
  await migrate();
  app.listen(PORT, () => {
    console.log(`\n  Walton Family Server running on http://localhost:${PORT}\n`);
  });
}

start().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
