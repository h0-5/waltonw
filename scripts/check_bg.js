const mysql = require('mysql2/promise');
async function check() {
  const d = await mysql.createConnection({host:'localhost',port:3306,user:'root',password:'',database:'walton_family',charset:'utf8mb4'});
  const keys = ['site_bg_url','site_mobile_bg_url','site_bg_blur','site_overlay_blur','site_mobile_bg_blur','site_accent_color','aurora_effect','bubbles_effect','embers_effect','lightning_effect','particles_effect','rain_effect','snow_effect','stars_effect','snow_enabled','site_name'];
  for (const k of keys) {
    const [r] = await d.execute("SELECT setting_value FROM site_settings WHERE setting_key = ?", [k]);
    console.log(k + ': ' + (r[0] ? r[0].setting_value : 'NOT SET'));
  }
  await d.end();
}
check().catch(console.error);
