const mysql = require('mysql2/promise');

async function fixData() {
  console.log('=== FIXING DATA MIGRATION ===\n');

  const oldDb = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: '',
    database: 'walton_family', charset: 'utf8mb4'
  });

  const newDb = await mysql.createConnection({
    host: 'localhost', port: 3306, user: 'root', password: '',
    database: 'walton_family', charset: 'utf8mb4', multipleStatements: true
  });

  const tablesToFix = [
    'users', 'fs_products', 'application_settings', 'bot_points',
    'discount_codes', 'properties', 'orders', 'order_items', 'ticket_replies',
    'game_rps_stats', 'game_quiz_sessions', 'game_mafia_sessions', 'game_mafia_players',
    'game_impostor_sessions', 'game_impostor_players', 'game_trivia_sessions',
    'game_trivia_players', 'game_uno_sessions', 'game_uno_players',
    'aviator_rounds', 'aviator_bets', 'multipliers', 'warnings_log',
    'points_ledger', 'purchases_log', 'product_logs', 'service_requests',
    'broadcast_rate_lock', 'site_banners', 'multi_discounts', 'Logs'
  ];

  for (const tbl of tablesToFix) {
    try {
      const [cnt] = await oldDb.execute('SELECT COUNT(*) as c FROM `' + tbl + '`');
      if (cnt[0].c === 0) {
        console.log('⏭️  ' + tbl + ': empty');
        continue;
      }

      const [cols] = await oldDb.execute('SHOW COLUMNS FROM `' + tbl + '`');
      const colNames = cols.map(c => c.Field);
      const [rows] = await oldDb.execute('SELECT ' + colNames.map(c => '`' + c + '`').join(', ') + ' FROM `' + tbl + '`');

      // Check if table exists in new DB
      try {
        await newDb.execute('SELECT 1 FROM `' + tbl + '` LIMIT 1');
      } catch(e) {
        // Table doesn't exist, create it
        const [createTbl] = await oldDb.execute('SHOW CREATE TABLE `' + tbl + '`');
        const createSQL = createTbl[0]['Create Table'];
        await newDb.execute(createSQL);
        console.log('📝 Created table: ' + tbl);
      }

      // Clear and insert
      await newDb.execute('DELETE FROM `' + tbl + '`');
      if (rows.length > 0) {
        const ph = colNames.map(() => '?').join(', ');
        const insSQL = 'INSERT INTO `' + tbl + '` (' + colNames.map(c => '`' + c + '`').join(', ') + ') VALUES (' + ph + ')';
        for (const row of rows) {
          const vals = colNames.map(c => row[c] === undefined ? null : row[c]);
          await newDb.execute(insSQL, vals);
        }
        console.log('✅ ' + tbl + ': ' + rows.length + ' rows');
      }
    } catch(e) {
      console.log('❌ ' + tbl + ': ' + e.message.substring(0, 60));
    }
  }

  // Final stats
  console.log('\n=== FINAL STATS ===');
  const [totalUsers] = await newDb.execute('SELECT COUNT(*) as c FROM users');
  const [totalProducts] = await newDb.execute('SELECT COUNT(*) as c FROM fs_products');
  const [totalNews] = await newDb.execute('SELECT COUNT(*) as c FROM news');
  const [totalRules] = await newDb.execute('SELECT COUNT(*) as c FROM rules');
  const [totalSettings] = await newDb.execute('SELECT COUNT(*) as c FROM site_settings');
  const [totalMessages] = await newDb.execute('SELECT COUNT(*) as c FROM community_messages');
  const [totalNotifications] = await newDb.execute('SELECT COUNT(*) as c FROM notifications');
  const [totalLogs] = await newDb.execute('SELECT COUNT(*) as c FROM admin_logs');
  const [totalApps] = await newDb.execute('SELECT COUNT(*) as c FROM submitted_applications');
  const [totalDiscounts] = await newDb.execute('SELECT COUNT(*) as c FROM discount_codes');

  console.log('Users:', totalUsers[0].c);
  console.log('Products:', totalProducts[0].c);
  console.log('News:', totalNews[0].c);
  console.log('Rules:', totalRules[0].c);
  console.log('Settings:', totalSettings[0].c);
  console.log('Messages:', totalMessages[0].c);
  console.log('Notifications:', totalNotifications[0].c);
  console.log('Logs:', totalLogs[0].c);
  console.log('Applications:', totalApps[0].c);
  console.log('Discounts:', totalDiscounts[0].c);

  await oldDb.end();
  await newDb.end();
  console.log('\nDone!');
}

fixData().catch(console.error);
