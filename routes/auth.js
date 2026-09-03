const express = require('express');
const router = express.Router();
const passport = require('../config/auth');

// Login page
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  const error = req.query.error || '';
  res.render('pages/login', { title: 'تسجيل الدخول', error });
});

// Discord auth
router.get('/discord', (req, res, next) => {
  passport.authenticate('discord', {
    scope: ['identify', 'email', 'guilds', 'guilds.members.read'],
    prompt: 'consent'
  })(req, res, next);
});

// Discord callback
router.get('/discord/callback', (req, res, next) => {
  passport.authenticate('discord', (err, user, info) => {
    console.log('===== OAUTH CALLBACK =====');
    console.log('Time:', new Date().toISOString());
    console.log('Error:', err ? err.stack : 'none');
    console.log('User:', user ? user.username : 'none');
    console.log('Info:', JSON.stringify(info));
    console.log('Query:', JSON.stringify(req.query));
    console.log('==========================');
    
    if (err) {
      return res.redirect('/auth/login?error=server_error');
    }
    if (!user) {
      return res.redirect('/auth/login?error=failed');
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('Session login error:', loginErr);
        return res.redirect('/auth/login?error=login_failed');
      }
      const returnTo = req.session.returnTo || '/';
      delete req.session.returnTo;
      return res.redirect(returnTo);
    });
  })(req, res, next);
});

// Logout
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) console.error('Logout error:', err);
    req.session.destroy((err) => {
      if (err) console.error('Session destroy error:', err);
      res.clearCookie('wf_session');
      res.redirect('/auth/login');
    });
  });
});

module.exports = router;
