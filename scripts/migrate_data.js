const mysql = require('mysql2/promise');

async function migrateData() {
  console.log('=== WALTON FAMILY DATA MIGRATION ===\n');

  // Connect to old database
  let oldDb;
  const targets = [
    { host: 'localhost', db: 'walton_family', user: 'root', pass: '' },
    { host: 'sql200.infinityfree.com', db: 'if0_42789190_waltonwev', user: 'if0_42789190', pass: 'VsQE4GjOxzPye' }
  ];

  for (const t of targets) {
    try {
      console.log('Trying:', t.host + '/' + t.db);
      oldDb = await mysql.createConnection({
        host: t.host, port: 3306, user: t.user, password: t.pass, database: t.db,
        charset: 'utf8mb4', connectTimeout: 8000
      });
      console.log('Connected to:', t.host, '\n');
      break;
    } catch(e) {
      console.log('Failed:', e.message.substring(0, 60));
    }
  }

  if (!oldDb) {
    console.log('Could not connect to old database');
    process.exit(1);
  }

  // New database
  const newDb = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: '', database: 'walton_family',
    charset: 'utf8mb4', multipleStatements: true
  });

  // Migration mapping
  const tables = [
    { old: 'users', new: 'users', fields: 'id, discord_id, username, email, avatar, profile_picture, role, is_banned, ban_reason, is_muted, total_game_points, tickets_closed, last_login, created_at' },
    { old: 'site_settings', new: 'site_settings', fields: 'setting_key, setting_value' },
    { old: 'news', new: 'news', fields: 'id, title, content, type, image, video_url, created_by, created_at, expires_at, giveaway_id, giveaway_data, is_hidden' },
    { old: 'rules', new: 'rules', fields: 'id, category, icon, icon_color, rule_text, sort_order' },
    { old: 'rule_categories', new: 'rule_categories', fields: 'id, name, icon, sort_order' },
    { old: 'fs_products', new: 'fs_products', fields: 'id, name, description, image, category_type, price_points, price_money, stock, is_active, coming_soon, ended, created_at' },
    { old: 'categories', new: 'categories', fields: 'id, name, description, image, slug' },
    { old: 'products', new: 'products', fields: 'id, name, description, price, currency, category_id, stock_quantity, image, seller_id, store_type, is_active, created_at' },
    { old: 'notifications', new: 'notifications', fields: 'id, user_id, title, message, type, link, is_read, created_at' },
    { old: 'support_tickets', new: 'support_tickets', fields: 'id, user_id, name, email, subject, message, priority, status, created_at, updated_at' },
    { old: 'community_messages', new: 'community_messages', fields: 'id, channel_id, user_id, message, message_type, attachment_url, created_at' },
    { old: 'giveaway_participants', new: 'giveaway_participants', fields: 'id, giveaway_id, user_id, username, platform' },
    { old: 'giveaway_winners', new: 'giveaway_winners', fields: 'id, giveaway_id, user_id, username, selected_at, position, winner_number' },
    { old: 'application_settings', new: 'application_settings', fields: 'id, application_type, status, title, description, requirements, icon, color' },
    { old: 'submitted_applications', new: 'submitted_applications', fields: 'id, user_id, application_type, answers, status, created_at' },
    { old: 'bot_points', new: 'bot_points', fields: 'id, discord_id, points, total_earned' },
    { old: 'discount_codes', new: 'discount_codes', fields: 'id, code, discount_percent, max_uses, current_uses, expires_at, product_id, created_by, allowed_roles, created_at' },
    { old: 'admin_logs', new: 'admin_logs', fields: 'id, user_id, username, action, target_type, target_id, target_name, details, ip, created_at' },
    { old: 'about_us_content', new: 'about_us_content', fields: 'content_key, content_value' },
    { old: 'company_items', new: 'company_items', fields: 'id, title, description, image, video_url, category, sort_order, service_status' },
    { old: 'properties', new: 'properties', fields: 'id, title, description, image, created_at' }
  ];

  let totalMigrated = 0;

  for (const t of tables) {
    try {
      // Check if old table exists and has data
      const [oldCount] = await oldDb.execute('SELECT COUNT(*) as c FROM `' + t.old + '`');
      if (oldCount[0].c === 0) {
        console.log('⏭️  ' + t.old + ': empty, skipping');
        continue;
      }

      // Get data from old table
      const [rows] = await oldDb.execute('SELECT ' + t.fields + ' FROM `' + t.old + '`');
      
      if (rows.length === 0) {
        console.log('⏭️  ' + t.old + ': no data');
        continue;
      }

      // Clear new table
      await newDb.execute('DELETE FROM `' + t.new + '`');

      // Get column names from first row
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const insertSQL = 'INSERT INTO `' + t.new + '` (' + columns.join(', ') + ') VALUES (' + placeholders + ')';

      // Insert data
      for (const row of rows) {
        const values = columns.map(c => row[c] === undefined ? null : row[c]);
        await newDb.execute(insertSQL, values);
      }

      totalMigrated += rows.length;
      console.log('✅ ' + t.old + ': ' + rows.length + ' rows migrated');
    } catch(e) {
      console.log('❌ ' + t.old + ': ' + e.message.substring(0, 60));
    }
  }

  // Try additional tables that might exist
  const extraTables = [
    'orders', 'order_items', 'ticket_replies', 'community_levels',
    'discord_role_map', 'discord_cache', 'user_achievements',
    'bot_points_log', 'bot_inventory', 'game_find_link', 'game_crossword',
    'game_quiz_questions', 'game_solo_scores', 'game_rps_stats',
    'fs_box_items', 'fs_user_boxes', 'service_questions', 'service_packages',
    'service_requests', 'multi_discounts', 'site_banners',
    'application_questions', 'application_forms'
  ];

  for (const tableName of extraTables) {
    try {
      const [count] = await oldDb.execute('SELECT COUNT(*) as c FROM `' + tableName + '`');
      if (count[0].c > 0) {
        const [cols] = await oldDb.execute('SHOW COLUMNS FROM `' + tableName + '`');
        const colNames = cols.map(c => c.Field);
        const [rows] = await oldDb.execute('SELECT * FROM `' + tableName + '`');
        
        if (rows.length > 0) {
          try {
            await newDb.execute('DELETE FROM `' + tableName + '`');
            const placeholders = colNames.map(() => '?').join(', ');
            const insertSQL = 'INSERT INTO `' + tableName + '` (' + colNames.join(', ') + ') VALUES (' + placeholders + ')';
            for (const row of rows) {
              const values = colNames.map(c => row[c] === undefined ? null : row[c]);
              await newDb.execute(insertSQL, values);
            }
            totalMigrated += rows.length;
            console.log('✅ ' + tableName + ': ' + rows.length + ' rows migrated');
          } catch(e) {
            console.log('⚠️  ' + tableName + ': table structure mismatch, creating...');
            // Create table from old structure
            const [createTable] = await oldDb.execute('SHOW CREATE TABLE `' + tableName + '`');
            const createSQL = createTable[0]['Create Table'];
            await newDb.execute(createSQL);
            const placeholders = colNames.map(() => '?').join(', ');
            const insertSQL = 'INSERT INTO `' + tableName + '` (' + colNames.join(', ') + ') VALUES (' + placeholders + ')';
            for (const row of rows) {
              const values = colNames.map(c => row[c] === undefined ? null : row[c]);
              await newDb.execute(insertSQL, values);
            }
            totalMigrated += rows.length;
            console.log('✅ ' + tableName + ': ' + rows.length + ' rows migrated (table created)');
          }
        }
      }
    } catch(e) {
      // Table doesn't exist in old DB, skip
    }
  }

  console.log('\n=== MIGRATION COMPLETE ===');
  console.log('Total rows migrated: ' + totalMigrated);

  await oldDb.end();
  await newDb.end();
}

migrateData().catch(console.error);
