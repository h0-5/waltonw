const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const mysql = require('mysql2');
const pool = require('./database');

const sessionPool = mysql.createPool(pool.dbConfig);

const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: parseInt(process.env.SESSION_MAX_AGE) || 2592000000,
  createDatabaseTable: true,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
}, sessionPool);

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'walton_family_secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 2592000000,
    sameSite: 'lax'
  },
  name: 'wf_session'
};

module.exports = sessionConfig;