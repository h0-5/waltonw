const REQUIRED_GUILD_ID = '1476232552564916387';
const JOIN_LINK = 'https://discord.gg/dkhSKu8hHF';

const isAuthenticated = (req, res, next) => {
  if (req.user) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  return res.redirect('/auth/login');
};

const isInGuild = async (req, res, next) => {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }

  try {
    const axios = require('axios');
    const db = require('../config/database');
    
    // Check cached result first
    const [cached] = await db.execute('SELECT in_guild FROM users WHERE id = ?', [req.user.id]);
    if (cached.length > 0 && cached[0].in_guild === 1) {
      return next();
    }

    const token = req.user.accessToken || req.session.accessToken;

    console.log('=== Guild Check ===');
    console.log('User:', req.user.username);
    console.log('Token exists:', !!token);

    if (!token) {
      return res.render('pages/not-in-server', {
        title: 'انضم لسيرفرنا',
        joinLink: JOIN_LINK,
        error: 'access_token_missing'
      });
    }

    const response = await axios.get('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const guilds = response.data;
    console.log('Guilds found:', guilds.length);
    console.log('Required guild:', REQUIRED_GUILD_ID);
    
    const isInServer = guilds.some(g => g.id === REQUIRED_GUILD_ID);
    console.log('Is in server:', isInServer);

    // Cache the result in database
    await db.execute('UPDATE users SET in_guild = ? WHERE id = ?', [isInServer ? 1 : 0, req.user.id]);

    if (!isInServer) {
      return res.render('pages/not-in-server', {
        title: 'انضم لسيرفرنا',
        joinLink: JOIN_LINK,
        error: 'not_in_server'
      });
    }

    return next();
  } catch (err) {
    console.error('Guild check error:', err.message);
    if (err.response) {
      console.error('Discord API error:', err.response.status, err.response.data);
    }
    return res.render('pages/not-in-server', {
      title: 'انضم لسيرفرنا',
      joinLink: JOIN_LINK,
      error: 'check_failed'
    });
  }
};

const isAdmin = (req, res, next) => {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/auth/login');
  }
  const adminRoles = ['owner', 'developer', 'founder', 'vice_founder', 'chairman', 'present_member', 'vice_president', 'leadership', 'admin', 'moderator', 'support'];
  if (adminRoles.includes(req.user.role)) {
    return next();
  }
  return res.status(403).render('pages/error', {
    title: 'غير مصرح',
    error: 'ليس لديك صلاحية للوصول لهذه الصفحة'
  });
};

module.exports = { isAuthenticated, isInGuild, isAdmin, REQUIRED_GUILD_ID };
