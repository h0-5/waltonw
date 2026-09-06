const session = require('express-session');

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'walton_family_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 2592000000,
    sameSite: 'lax'
  },
  name: 'wf_session'
};

module.exports = sessionConfig;
