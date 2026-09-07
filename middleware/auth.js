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
    const token = req.user.accessToken || req.session.accessToken;

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
    const isInServer = guilds.some(g => g.id === REQUIRED_GUILD_ID);

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
