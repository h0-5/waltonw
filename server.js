const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const db = require('./config/database');
const PORT = process.env.PORT || 3000;

// Last-resort safety net — Node ≥15 kills the process on an unhandled rejection,
// and one dead async handler must never 500 the whole site. Log loudly, stay up.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err && err.message ? err.message : err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.message ? err.message : err);
});

const server = http.createServer(app);

// Align with Railway proxy keep-alive (prevents random 502s under load)
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// Graceful shutdown — Railway sends SIGTERM on every redeploy
async function shutdown(sig) {
  console.log('\n' + sig + ' received — shutting down gracefully...');
  server.close(() => {
    db.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Socket.IO - Community Chat
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  socket.on('user:online', (userData) => {
    if (userData && userData.id) {
      onlineUsers.set(userData.id, { ...userData, socketId: socket.id, lastSeen: Date.now() });
      io.emit('users:online', Array.from(onlineUsers.values()));
    }
  });

  socket.on('chat:send', async (data) => {
    if (!data || !data.message || !data.userId) return;
    try {
      const [result] = await db.execute(
        'INSERT INTO community_messages (user_id, username, avatar, message, created_at) VALUES (?, ?, ?, ?, NOW())',
        [data.userId, data.username, data.avatar || '', data.message.substring(0, 2000)]
      );
      const msg = {
        id: result.insertId,
        user_id: data.userId,
        username: data.username,
        avatar: data.avatar || '',
        message: data.message.substring(0, 2000),
        created_at: new Date().toISOString()
      };
      io.emit('chat:message', msg);
    } catch(e) { console.error('Chat error:', e.message); }
  });

  socket.on('chat:typing', (userData) => {
    if (userData) socket.broadcast.emit('chat:typing', userData);
  });

  socket.on('disconnect', () => {
    for (const [userId, user] of onlineUsers.entries()) {
      if (user.socketId === socket.id) {
        onlineUsers.delete(userId);
        break;
      }
    }
    io.emit('users:online', Array.from(onlineUsers.values()));
  });
});

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
    `CREATE TABLE IF NOT EXISTS roles (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) UNIQUE, display_name VARCHAR(100), color VARCHAR(20) DEFAULT '#ffffff', icon VARCHAR(50) DEFAULT '', is_admin_role TINYINT(1) DEFAULT 0, is_default TINYINT(1) DEFAULT 0, is_protected TINYINT(1) DEFAULT 0, sort_order INT DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS role_permissions (id INT AUTO_INCREMENT PRIMARY KEY, role_id INT, page VARCHAR(100), can_access TINYINT(1) DEFAULT 1, can_edit TINYINT(1) DEFAULT 0, can_delete TINYINT(1) DEFAULT 0, can_manage TINYINT(1) DEFAULT 0, FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE, UNIQUE KEY unique_role_page (role_id, page))`,
    `CREATE TABLE IF NOT EXISTS rules (id INT AUTO_INCREMENT PRIMARY KEY, category VARCHAR(100), title VARCHAR(255) DEFAULT '', content TEXT, rule_text TEXT, sort_order INT DEFAULT 0, icon VARCHAR(50) DEFAULT '', icon_color VARCHAR(20) DEFAULT '')`,
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
    `CREATE TABLE IF NOT EXISTS rule_stages (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(100), description TEXT, icon VARCHAR(50) DEFAULT 'fa-flag', sort_order INT DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS giveaway_participants (id INT AUTO_INCREMENT PRIMARY KEY, giveaway_id INT, user_id INT, username VARCHAR(100), platform VARCHAR(20) DEFAULT 'site')`,
    `CREATE TABLE IF NOT EXISTS giveaway_winners (id INT AUTO_INCREMENT PRIMARY KEY, giveaway_id INT, user_id INT, username VARCHAR(100), selected_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS application_settings (id INT AUTO_INCREMENT PRIMARY KEY, application_type VARCHAR(100) UNIQUE, status VARCHAR(20) DEFAULT 'open', title VARCHAR(255), description TEXT, requirements TEXT, icon VARCHAR(50), color VARCHAR(20))`,
    `CREATE TABLE IF NOT EXISTS submitted_applications (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, application_type VARCHAR(100), answers JSON, status VARCHAR(20) DEFAULT 'pending', reviewed_by INT, review_note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS service_questions (id INT AUTO_INCREMENT PRIMARY KEY, service_id INT, question TEXT, type VARCHAR(50) DEFAULT 'text', sort_order INT DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS service_packages (id INT AUTO_INCREMENT PRIMARY KEY, service_id INT, name VARCHAR(255), price DECIMAL(10,2), description TEXT, sort_order INT DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS service_requests (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, service_id INT, answers JSON, status VARCHAR(20) DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS sessions (session_id VARCHAR(128) PRIMARY KEY, expires INT UNSIGNED NOT NULL, data MEDIUMTEXT, INDEX sessions_expires(expires))`,
    `CREATE TABLE IF NOT EXISTS community_messages (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, username VARCHAR(100), avatar TEXT, message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS bot_logs (id INT AUTO_INCREMENT PRIMARY KEY, action VARCHAR(255), details TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS product_logs (id INT AUTO_INCREMENT PRIMARY KEY, product_id INT, action VARCHAR(100), details TEXT, user_id INT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS game_reward_log (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, game_name VARCHAR(100), points INT DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS user_activity_log (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, action VARCHAR(255), ip VARCHAR(45), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS giveaways (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), description TEXT, prize VARCHAR(255), type VARCHAR(20) DEFAULT 'normal', winner_count INT DEFAULT 1, status VARCHAR(20) DEFAULT 'active', required_role VARCHAR(50), required_points INT DEFAULT 0, created_by INT, starts_at DATETIME, ends_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS role_element_permissions (id INT AUTO_INCREMENT PRIMARY KEY, role_id INT, page VARCHAR(100), element_type VARCHAR(50) DEFAULT 'button', element_id VARCHAR(100), can_view TINYINT(1) DEFAULT 1, can_use TINYINT(1) DEFAULT 0, FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE, UNIQUE KEY unique_role_element (role_id, page, element_id))`,
    `CREATE TABLE IF NOT EXISTS role_page_permissions (id INT AUTO_INCREMENT PRIMARY KEY, role_id INT, page VARCHAR(100), can_view TINYINT(1) DEFAULT 0, can_create TINYINT(1) DEFAULT 0, can_edit TINYINT(1) DEFAULT 0, can_delete TINYINT(1) DEFAULT 0, can_manage TINYINT(1) DEFAULT 0, can_export TINYINT(1) DEFAULT 0, can_broadcast TINYINT(1) DEFAULT 0, FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE, UNIQUE KEY unique_role_page_p (role_id, page))`,
    `CREATE TABLE IF NOT EXISTS role_assignments (id INT AUTO_INCREMENT PRIMARY KEY, role_id INT, user_id INT, assigned_by INT, reason TEXT, assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME, FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS role_punishments (id INT AUTO_INCREMENT PRIMARY KEY, role_id INT, can_ban TINYINT(1) DEFAULT 0, can_mute TINYINT(1) DEFAULT 0, can_warn TINYINT(1) DEFAULT 0, can_kick TINYINT(1) DEFAULT 0, max_ban_level INT DEFAULT 0, FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE, UNIQUE KEY unique_role_punish (role_id))`,
    `CREATE TABLE IF NOT EXISTS role_role_permissions (id INT AUTO_INCREMENT PRIMARY KEY, role_id INT, permission_key VARCHAR(100), enabled TINYINT(1) DEFAULT 0, FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE, UNIQUE KEY unique_role_perm (role_id, permission_key))`,
    `CREATE TABLE IF NOT EXISTS role_page_access (id INT AUTO_INCREMENT PRIMARY KEY, role_id INT, page_path VARCHAR(100), can_access TINYINT(1) DEFAULT 1, FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE, UNIQUE KEY unique_role_page_access (role_id, page_path))`,
    `CREATE TABLE IF NOT EXISTS side_roles (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50) UNIQUE, display_name VARCHAR(100), color VARCHAR(20) DEFAULT '#bc13fe', icon VARCHAR(50) DEFAULT 'fa-tag', emoji VARCHAR(20) DEFAULT '', is_active TINYINT(1) DEFAULT 1, sort_order INT DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS user_side_roles (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, side_role_id INT, assigned_by INT, assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (side_role_id) REFERENCES side_roles(id) ON DELETE CASCADE, UNIQUE KEY unique_user_side (user_id, side_role_id))`,
    `CREATE TABLE IF NOT EXISTS side_role_permissions (id INT AUTO_INCREMENT PRIMARY KEY, side_role_id INT NOT NULL, permission_key VARCHAR(100) NOT NULL, enabled TINYINT(1) DEFAULT 1, FOREIGN KEY (side_role_id) REFERENCES side_roles(id) ON DELETE CASCADE, UNIQUE KEY unique_sr_perm (side_role_id, permission_key))`,
    `CREATE TABLE IF NOT EXISTS side_role_page_access (id INT AUTO_INCREMENT PRIMARY KEY, side_role_id INT NOT NULL, page_path VARCHAR(100) NOT NULL, can_access TINYINT(1) DEFAULT 1, FOREIGN KEY (side_role_id) REFERENCES side_roles(id) ON DELETE CASCADE, UNIQUE KEY unique_sr_page (side_role_id, page_path))`,
    // Visit analytics + security guard tables (guaranteed creation + visible errors in logs)
    `CREATE TABLE IF NOT EXISTS site_visits (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, visit_date DATE NOT NULL, path VARCHAR(191) NOT NULL, views INT UNSIGNED NOT NULL DEFAULT 0, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_date_path (visit_date, path), INDEX idx_visit_date (visit_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS visit_uniques (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, visit_date DATE NOT NULL, visitor_id VARCHAR(64) NOT NULL, UNIQUE KEY uq_date_visitor (visit_date, visitor_id), INDEX idx_vu_date (visit_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS bot_visits (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, visit_date DATE NOT NULL, path VARCHAR(191) NOT NULL, views INT UNSIGNED NOT NULL DEFAULT 0, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_bot_date_path (visit_date, path), INDEX idx_bot_visit_date (visit_date)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS blocked_ips (ip VARCHAR(64) PRIMARY KEY, reason VARCHAR(191) NOT NULL DEFAULT 'unknown', user_agent VARCHAR(255) DEFAULT '', blocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NULL, INDEX idx_blocked_expires (expires_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS bot_inventory (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, item_key VARCHAR(100) NOT NULL, item_name VARCHAR(255) NOT NULL, quantity INT DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY unique_user_item (user_id, item_key))`,
    `CREATE TABLE IF NOT EXISTS user_boxes (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, box_name VARCHAR(255) NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS admin_warnings (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, username VARCHAR(100), issued_by INT, issuer_name VARCHAR(100), reason TEXT, severity VARCHAR(20) DEFAULT 'medium', is_read TINYINT(1) DEFAULT 0, is_deleted TINYINT(1) DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS admin_excuses (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, username VARCHAR(100), reason TEXT, start_date DATE, end_date DATE, status VARCHAR(20) DEFAULT 'pending', reviewer_id INT, reviewer_name VARCHAR(100), reviewer_note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME)`,
    `CREATE TABLE IF NOT EXISTS admin_profile_logs (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, username VARCHAR(100), action VARCHAR(100), target_name VARCHAR(255), details TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS bot_actions (id INT AUTO_INCREMENT PRIMARY KEY, action VARCHAR(50) NOT NULL, target_discord_id VARCHAR(50), target_name VARCHAR(100), reason TEXT, duration_minutes INT DEFAULT 0, role_name VARCHAR(100), status VARCHAR(20) DEFAULT 'pending', result TEXT, created_by INT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, executed_at DATETIME)`
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

  // Fix: ensure columns exist (table may have been created before these columns were added)
  const userFixes = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS in_guild TINYINT(1) DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_photo TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS total_game_points INT DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS warn_count INT DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_muted TINYINT(1) DEFAULT 0"
  ];
  for (const sql of userFixes) {
    try { await db.query(sql); } catch (e) { /* column already exists */ }
  }
  console.log('✅ users columns verified');

  // Fix roles table - recreate with correct schema
  try {
    const [cols] = await db.query("SHOW COLUMNS FROM roles LIKE 'is_admin_role'");
    if (cols.length === 0) {
      const [existingRoles] = await db.query('SELECT * FROM roles');
      await db.query('DROP TABLE role_permissions');
      await db.query('DROP TABLE roles');
      await db.query(`CREATE TABLE roles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) UNIQUE,
        display_name VARCHAR(100),
        color VARCHAR(20) DEFAULT '#ffffff',
        icon VARCHAR(50) DEFAULT '',
        is_admin_role TINYINT(1) DEFAULT 0,
        is_default TINYINT(1) DEFAULT 0,
        is_protected TINYINT(1) DEFAULT 0,
        sort_order INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      await db.query(`CREATE TABLE IF NOT EXISTS role_permissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        role_id INT,
        page VARCHAR(100),
        can_access TINYINT(1) DEFAULT 1,
        can_edit TINYINT(1) DEFAULT 0,
        can_delete TINYINT(1) DEFAULT 0,
        can_manage TINYINT(1) DEFAULT 0,
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        UNIQUE KEY unique_role_page (role_id, page)
      )`);
      for (const r of existingRoles) {
        await db.query(
          'INSERT INTO roles (name, display_name, color, icon, is_admin_role, is_default, is_protected) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [r.name, r.display_name, r.color || '#ffffff', r.icon || '', r.is_admin_role || 0, r.is_default || 0, r.name === 'owner' ? 1 : 0]
        );
      }
      console.log('✅ roles table recreated with correct schema');
    }
  } catch(e) { console.log('roles fix:', e.message); }

  // Fix schema mismatches
  const alterStatements = [
    { table: 'users', col: 'last_login', sql: "ALTER TABLE users ADD COLUMN last_login DATETIME" },
    { table: 'users', col: 'banned_at', sql: "ALTER TABLE users ADD COLUMN banned_at DATETIME" },
    { table: 'users', col: 'muted_until', sql: "ALTER TABLE users ADD COLUMN muted_until DATETIME" },
    { table: 'news', col: 'type', sql: "ALTER TABLE news ADD COLUMN type VARCHAR(50) DEFAULT 'news'" },
    { table: 'news', col: 'expires_at', sql: "ALTER TABLE news ADD COLUMN expires_at DATETIME" },
    { table: 'news', col: 'is_hidden', sql: "ALTER TABLE news ADD COLUMN is_hidden TINYINT(1) DEFAULT 0" },
    { table: 'orders', col: 'total_amount', sql: "ALTER TABLE orders ADD COLUMN total_amount DECIMAL(10,2) DEFAULT 0" },
    { table: 'orders', col: 'shipping_address', sql: "ALTER TABLE orders ADD COLUMN shipping_address TEXT" },
    { table: 'orders', col: 'payment_method', sql: "ALTER TABLE orders ADD COLUMN payment_method VARCHAR(50) DEFAULT 'points'" },
    { table: 'orders', col: 'notes', sql: "ALTER TABLE orders ADD COLUMN notes TEXT" },
    { table: 'application_settings', col: 'discord_role_id', sql: "ALTER TABLE application_settings ADD COLUMN discord_role_id VARCHAR(50)" },
    { table: 'application_settings', col: 'required_discord_role_id', sql: "ALTER TABLE application_settings ADD COLUMN required_discord_role_id VARCHAR(50)" },
    { table: 'application_settings', col: 'rejection_cooldown_hours', sql: "ALTER TABLE application_settings ADD COLUMN rejection_cooldown_hours INT DEFAULT 0" },
    { table: 'application_settings', col: 'notify_enabled', sql: "ALTER TABLE application_settings ADD COLUMN notify_enabled TINYINT(1) DEFAULT 1" },
    { table: 'application_settings', col: 'updated_at', sql: "ALTER TABLE application_settings ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" },
    { table: 'submitted_applications', col: 'reviewed_at', sql: "ALTER TABLE submitted_applications ADD COLUMN reviewed_at DATETIME" },
    { table: 'submitted_applications', col: 'cooldown_until', sql: "ALTER TABLE submitted_applications ADD COLUMN cooldown_until DATETIME" },
    { table: 'service_requests', col: 'total_price', sql: "ALTER TABLE service_requests ADD COLUMN total_price DECIMAL(10,2) DEFAULT 0" },
    { table: 'service_requests', col: 'package_id', sql: "ALTER TABLE service_requests ADD COLUMN package_id INT" },
    { table: 'service_requests', col: 'admin_id', sql: "ALTER TABLE service_requests ADD COLUMN admin_id INT" },
    { table: 'roles', col: 'description', sql: "ALTER TABLE roles ADD COLUMN description TEXT" },
    { table: 'roles', col: 'can_assign_roles', sql: "ALTER TABLE roles ADD COLUMN can_assign_roles TINYINT(1) DEFAULT 0" },
    { table: 'roles', col: 'is_protected', sql: "ALTER TABLE roles ADD COLUMN is_protected TINYINT(1) DEFAULT 0" },
    { table: 'roles', col: 'emoji', sql: "ALTER TABLE roles ADD COLUMN emoji VARCHAR(20) DEFAULT ''" },
    { table: 'roles', col: 'is_staff', sql: "ALTER TABLE roles ADD COLUMN is_staff TINYINT(1) DEFAULT 0" },
    { table: 'role_punishments', col: 'can_ban', sql: "ALTER TABLE role_punishments ADD COLUMN can_ban TINYINT(1) DEFAULT 0" },
    { table: 'role_punishments', col: 'can_mute', sql: "ALTER TABLE role_punishments ADD COLUMN can_mute TINYINT(1) DEFAULT 0" },
    { table: 'role_punishments', col: 'can_warn', sql: "ALTER TABLE role_punishments ADD COLUMN can_warn TINYINT(1) DEFAULT 0" },
    { table: 'role_punishments', col: 'can_kick', sql: "ALTER TABLE role_punishments ADD COLUMN can_kick TINYINT(1) DEFAULT 0" },
    { table: 'role_punishments', col: 'max_ban_level', sql: "ALTER TABLE role_punishments ADD COLUMN max_ban_level INT DEFAULT 0" },
    { table: 'users', col: 'manage_role', sql: "ALTER TABLE users ADD COLUMN manage_role TINYINT(1) DEFAULT 0" },
    { table: 'users', col: 'event_manager', sql: "ALTER TABLE users ADD COLUMN event_manager TINYINT(1) DEFAULT 0" },
    { table: 'users', col: 'role_updated_at', sql: "ALTER TABLE users ADD COLUMN role_updated_at DATETIME" },
    { table: 'users', col: 'family_joined_at', sql: "ALTER TABLE users ADD COLUMN family_joined_at DATETIME" },
    { table: 'users', col: 'banned_until', sql: "ALTER TABLE users ADD COLUMN banned_until DATETIME" },
    { table: 'users', col: 'banned_by', sql: "ALTER TABLE users ADD COLUMN banned_by INT" },
    { table: 'users', col: 'tickets_closed', sql: "ALTER TABLE users ADD COLUMN tickets_closed INT DEFAULT 0" },
    { table: 'rules', col: 'rule_text', sql: "ALTER TABLE rules ADD COLUMN rule_text TEXT" },
    { table: 'rules', col: 'icon', sql: "ALTER TABLE rules ADD COLUMN icon VARCHAR(50) DEFAULT ''" },
    { table: 'rules', col: 'icon_color', sql: "ALTER TABLE rules ADD COLUMN icon_color VARCHAR(20) DEFAULT ''" },
  ];
  for (const { table, col, sql } of alterStatements) {
    try {
      const [cols] = await db.query(`SHOW COLUMNS FROM ${table} LIKE '${col}'`);
      if (cols.length === 0) {
        await db.query(sql);
        console.log(`✅ ${table}.${col} added`);
      }
    } catch(e) {}
  }
  // Fix existing columns that have no DEFAULT (run unconditionally)
  const modifyStatements = [
    "ALTER TABLE rules MODIFY COLUMN title VARCHAR(255) DEFAULT ''",
    "ALTER TABLE rules MODIFY COLUMN content TEXT",
    "ALTER TABLE rules MODIFY COLUMN icon VARCHAR(50) DEFAULT ''",
    "ALTER TABLE rules MODIFY COLUMN icon_color VARCHAR(20) DEFAULT ''",
  ];
  for (const sql of modifyStatements) {
    try { await db.query(sql); } catch(e) {}
  }
  console.log('✅ Schema fixes done');

  // Fix collation mismatch between users and roles tables
  try {
    await db.query("ALTER TABLE users CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    console.log('✅ users collation fixed');
  } catch(e) { console.log('users collation:', e.message); }
  try {
    await db.query("ALTER TABLE roles CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    console.log('✅ roles collation fixed');
  } catch(e) { console.log('roles collation:', e.message); }

  // Ensure broadcasts.title and broadcasts.expires_at exist
  try {
    const [cols] = await db.query("SHOW COLUMNS FROM broadcasts LIKE 'title'");
    if (cols.length === 0) await db.query("ALTER TABLE broadcasts ADD COLUMN title VARCHAR(255) DEFAULT ''");
  } catch(e) {}
  try {
    const [cols] = await db.query("SHOW COLUMNS FROM broadcasts LIKE 'expires_at'");
    if (cols.length === 0) await db.query("ALTER TABLE broadcasts ADD COLUMN expires_at DATETIME");
  } catch(e) {}
  // Ensure orders.product_id exists (was missing from old DB)
  try {
    const [cols] = await db.query("SHOW COLUMNS FROM orders LIKE 'product_id'");
    if (cols.length === 0) {
      await db.query("ALTER TABLE orders ADD COLUMN product_id INT");
      console.log('✅ orders.product_id added');
    }
  } catch(e) { console.log('orders.product_id:', e.message); }

  // Add is_virtual flag to roles table to hide fake/synced Discord roles
  try {
    const [cols] = await db.query("SHOW COLUMNS FROM roles LIKE 'is_virtual'");
    if (cols.length === 0) {
      await db.query("ALTER TABLE roles ADD COLUMN is_virtual TINYINT(1) DEFAULT 0");
      console.log('✅ roles.is_virtual added');
    }
  } catch(e) {}
  // Mark known virtual/synced roles as hidden
  const virtualRoles = ['developer','founder','vice_founder','chairman','present_member','vice_president','leadership','family_member','company_member','deputy_leadership','executive','deputy_executive','supervisor'];
  try {
    for (const vr of virtualRoles) {
      await db.query("UPDATE roles SET is_virtual = 1 WHERE name = ? AND is_virtual = 0", [vr]);
    }
  } catch(e) {}

  // Seed default roles
  try {
    const [existing] = await db.query('SELECT COUNT(*) as c FROM roles');
    if (existing[0].c === 0) {
      const defaultRoles = [
        { name: 'owner', display_name: 'المالك', color: '#ef4444', icon: 'fa-crown', is_admin_role: 1, is_default: 0, is_protected: 1 },
        { name: 'admin', display_name: 'مدير', color: '#f97316', icon: 'fa-shield-halved', is_admin_role: 1, is_default: 0, is_protected: 0 },
        { name: 'moderator', display_name: 'مشرف', color: '#eab308', icon: 'fa-gavel', is_admin_role: 1, is_default: 0, is_protected: 0 },
        { name: 'support', display_name: 'دعم فني', color: '#22c55e', icon: 'fa-headset', is_admin_role: 1, is_default: 0, is_protected: 0 },
        { name: 'member', display_name: 'عضو', color: '#3b82f6', icon: 'fa-user', is_admin_role: 0, is_default: 1, is_protected: 0 },
        { name: 'trial', display_name: 'تحت التجربة', color: '#9ca3af', icon: 'fa-user-clock', is_admin_role: 0, is_default: 0, is_protected: 0 },
      ];
      for (const r of defaultRoles) {
        await db.query(
          'INSERT INTO roles (name, display_name, color, icon, is_admin_role, is_default, is_protected) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [r.name, r.display_name, r.color, r.icon, r.is_admin_role, r.is_default, r.is_protected]
        );
      }
      console.log('✅ Default roles seeded');
    }
    // Protect owner role
    await db.query("UPDATE roles SET is_protected = 1, is_admin_role = 1 WHERE name = 'owner'");
    await db.query("UPDATE roles SET is_admin_role = 1 WHERE name IN ('admin', 'moderator', 'support')");
    await db.query("UPDATE roles SET is_default = 1 WHERE name = 'member'");
    // Remove level column if it exists
    try { await db.query("ALTER TABLE roles DROP COLUMN level"); console.log('✅ Removed level column'); } catch(e) {}
    try { await db.query("ALTER TABLE roles DROP COLUMN max_role_level"); console.log('✅ Removed max_role_level column'); } catch(e) {}
  } catch(e) { console.error('Role seed error:', e.message); }
}

// Bump this when tables/ALTERs change in migrate() — '6' adds analytics + guard tables
const SCHEMA_VERSION = '10';

async function start() {
  // Skip the ~50-table migration when schema is already current:
  // faster deploys + way less DB load on every Railway restart
  let needMigrate = true;
  try {
    const [rows] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'schema_version'");
    if (rows.length && rows[0].setting_value === SCHEMA_VERSION) needMigrate = false;
  } catch (e) { /* fresh DB → run migration */ }

  if (needMigrate) {
    await migrate();
    try {
      await db.query(
        "INSERT INTO site_settings (setting_key, setting_value) VALUES ('schema_version', ?) ON DUPLICATE KEY UPDATE setting_value = ?",
        [SCHEMA_VERSION, SCHEMA_VERSION]
      );
      console.log('✅ schema_version saved (' + SCHEMA_VERSION + ')');
    } catch (e) { console.log('⚠️ schema_version save failed:', e.message); }
  } else {
    console.log('✅ Schema up-to-date (v' + SCHEMA_VERSION + ') — skipping migration');
  }

  // شفاء ذاتي لأعمدة حرجة قد تنقص قواعد قديمة رقمها محدَّث (الإنتاج: users بدون عمود in_guild
  // لأن الجدول أُنشئ بكود أقدم و migrate يتخطى لعدالة الإصدار) — استعلام information_schema واحد رخيص كل إقلاع
  try {
    const [gcols] = await db.query(
      "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'in_guild'"
    );
    if (!gcols[0].n) {
      await db.query("ALTER TABLE users ADD COLUMN in_guild TINYINT(1) DEFAULT 0");
      console.log('✅ Added missing users.in_guild column');
    }
  } catch (e) { console.log('⚠️ in_guild ensure failed:', e.message); }

  server.listen(PORT, () => {
    console.log(`\n  Walton Family Server running on http://localhost:${PORT}\n`);
    // Auto-connect Discord bot if enabled
    try {
      const bot = require('./bot/client');
      bot.connectBot().catch(() => {});
    } catch(e) {}
  });
}

start().catch(err => {
  console.error('❌ Fatal:', err.message);
  process.exit(1);
});
