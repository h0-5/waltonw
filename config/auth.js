// Passport Discord OAuth2 — safe init
const passport = require('passport');
const db = require('./database');

passport.serializeUser((user, done) => {
  done(null, user.id);
});

/* ── كاش مستخدم الجلسة (تخفيف Railway) ──
   deserializeUser كان يبعث SELECT * FROM users مع كل طلب مسجّل — صفحات + APIs.
   الكاش يوفر استعلاماً كاملاً بكل طلب (45 ثانية TTL) — تغييرات الحظر/الرتبة
   تصلح خلال أقل من دقيقة، واستدعاء clearUserCache يجعلها فورية في مسارات الإدارة */
const USER_CACHE_TTL = 45 * 1000;
const userCache = new Map(); // id -> { row, at }
function clearUserCache(userId) {
  if (userId == null) userCache.clear();
  else userCache.delete(Number(userId));
}
setInterval(() => {
  const now = Date.now();
  userCache.forEach((v, k) => { if (now - v.at > USER_CACHE_TTL) userCache.delete(k); });
}, 30 * 1000).unref();

passport.deserializeUser(async (id, done) => {
  try {
    const hit = userCache.get(Number(id));
    if (hit && (Date.now() - hit.at) < USER_CACHE_TTL) return done(null, hit.row);
    const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [id]);
    if (rows.length > 0) {
      userCache.set(Number(id), { row: rows[0], at: Date.now() });
      if (userCache.size > 800) { // حاجم RAM — أقدم إدخال أولاً
        userCache.delete(userCache.keys().next().value);
      }
      done(null, rows[0]);
    } else {
      userCache.delete(Number(id));
      done(null, null);
    }
  } catch (err) {
    done(err, null);
  }
});

const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
const discordRedirectUri = process.env.DISCORD_REDIRECT_URI;

if (discordClientId && discordClientSecret && discordRedirectUri) {
  const DiscordStrategy = require('passport-discord').Strategy;

  passport.use(new DiscordStrategy({
    clientID: discordClientId,
    clientSecret: discordClientSecret,
    callbackURL: discordRedirectUri,
    scope: ['identify', 'email', 'guilds', 'guilds.members.read']
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const discordId = profile.id;
      const username = profile.username;
      const avatar = profile.avatar ?
        `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` :
        `https://cdn.discordapp.com/embed/avatars/${parseInt(profile.discriminator) % 5}.png`;
      const email = profile.email || null;

      let [existingUser] = await db.execute('SELECT * FROM users WHERE discord_id = ?', [discordId]);

      if (existingUser.length > 0) {
        await db.execute(
          'UPDATE users SET username = ?, profile_picture = ?, last_login = NOW() WHERE discord_id = ?',
          [username, avatar, discordId]
        );
        [existingUser] = await db.execute('SELECT * FROM users WHERE discord_id = ?', [discordId]);
        existingUser[0].accessToken = accessToken;
        return done(null, existingUser[0]);
      }

      const [result] = await db.execute(
        'INSERT INTO users (discord_id, username, profile_picture, email, role, created_at, last_login) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
        [discordId, username, avatar, email, 'user']
      );

      const [newUser] = await db.execute('SELECT * FROM users WHERE id = ?', [result.insertId]);
      newUser[0].accessToken = accessToken;

      try {
        const webhookUrl = process.env.WH_NEW_ACCOUNT;
        if (webhookUrl) {
          const axios = require('axios');
          await axios.post(webhookUrl, {
            content: `🆕 **حساب جديد**\n**الاسم:** ${username}\n**Discord ID:** ${discordId}\n**البريد:** ${email || 'غير محدد'}`
          });
        }
      } catch (webhookErr) {
        console.error('Webhook error:', webhookErr.message);
      }

      return done(null, newUser[0]);
    } catch (err) {
      return done(err, null);
    }
  }));

  console.log('✅ Discord OAuth2 strategy loaded');
} else {
  console.warn('⚠️  Discord OAuth2 not configured — DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, or DISCORD_REDIRECT_URI missing');
}

module.exports = passport;
module.exports.clearUserCache = clearUserCache;
