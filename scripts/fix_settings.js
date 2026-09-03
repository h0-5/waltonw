const mysql = require('mysql2/promise');
async function fix() {
  const db = await mysql.createConnection({ host:'localhost', port:3306, user:'root', password:'', database:'walton_family', charset:'utf8mb4' });
  
  await db.execute("UPDATE site_settings SET setting_value = ? WHERE setting_key = ?", ['/images/site-bg.png', 'site_bg_url']);
  console.log('Fixed: site_bg_url');
  
  await db.execute("UPDATE site_settings SET setting_value = ? WHERE setting_key = ?", ['/images/site-mobile-bg.png', 'site_mobile_bg_url']);
  console.log('Fixed: site_mobile_bg_url');
  
  await db.execute("UPDATE site_settings SET setting_value = ? WHERE setting_key = ?", ['/images/site-logo.webp', 'site_logo_url']);
  console.log('Fixed: site_logo_url');
  
  await db.execute("UPDATE site_settings SET setting_value = ? WHERE setting_key = ?", ['/images/admin-mobile-bg.png', 'admin_mobile_bg_value']);
  console.log('Fixed: admin_mobile_bg_value');
  
  await db.end();
  console.log('Done!');
}
fix().catch(console.error);
