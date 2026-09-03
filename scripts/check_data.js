const mysql = require('mysql2/promise');
async function check() {
  const db = await mysql.createConnection({ host:'localhost', port:3306, user:'root', password:'', database:'walton_family', charset:'utf8mb4' });
  const [products] = await db.execute('SELECT id, name, image, category_type, price_points, stock FROM fs_products');
  console.log('=== PRODUCTS ===');
  products.forEach(p => console.log(p.id + ' | ' + p.name + ' | img: ' + (p.image || 'NONE') + ' | ' + p.category_type + ' | ' + p.price_points + ' pts | stock: ' + p.stock));
  
  const [news] = await db.execute('SELECT id, title, image, type FROM news');
  console.log('\n=== NEWS ===');
  news.forEach(n => console.log(n.id + ' | ' + n.title + ' | img: ' + (n.image || 'NONE') + ' | ' + n.type));
  
  const [settings] = await db.execute("SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('site_bg_url','site_mobile_bg_url','site_logo_url')");
  console.log('\n=== KEY SETTINGS ===');
  settings.forEach(s => console.log(s.setting_key + ': ' + s.setting_value));
  
  await db.end();
}
check().catch(console.error);
