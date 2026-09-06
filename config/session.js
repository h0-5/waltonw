const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const db = require('./database');

const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: parseInt(process.env.SESSION_MAX_AGE) || 2592000000,
  createDatabaseTable: true,
  schema: {
    tableName: 'wf_sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
}, db);

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'walton_family_secret',
  store: sessionStore,
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
