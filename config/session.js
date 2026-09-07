const session = require('express-session');

let sessionConfig = {
  secret: process.env.SESSION_SECRET || 'walton_family_secret',
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

// Try to use MySQL session store, fallback to memory
try {
  const MySQLStore = require('express-mysql-session')(session);
  const db = require('./database');
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
  }, db);
  sessionConfig.store = sessionStore;
  console.log('✅ MySQL session store loaded');
} catch(e) {
  console.warn('⚠️ MySQL session store failed, using memory:', e.message);
}

module.exports = sessionConfig;
