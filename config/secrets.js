require('dotenv').config();

module.exports = {
  // Server
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT) || 3000,
  HOST: process.env.HOST || 'localhost',

  // Database
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT) || 3306,
  DB_NAME: process.env.DB_NAME || 'walton_family',
  DB_USER: process.env.DB_USER || 'root',
  DB_PASS: process.env.DB_PASS || '',

  // Session
  SESSION_SECRET: process.env.SESSION_SECRET || 'walton_family_secret',
  SESSION_MAX_AGE: parseInt(process.env.SESSION_MAX_AGE) || 2592000000,

  // Discord OAuth2
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI: process.env.DISCORD_REDIRECT_URI,

  // Secrets
  SECRET_BOT_API: process.env.SECRET_BOT_API || 'walton_secret_2026',
  SECRET_WEBHOOK: process.env.SECRET_WEBHOOK || 'walton_bot_webhook_2025',
  SECRET_CRON: process.env.SECRET_CRON || 'walton_cron_secret_2026',

  // Site Settings
  SITE_NAME: process.env.SITE_NAME || 'Walton Family',
  SITE_URL: process.env.SITE_URL || 'http://localhost:3000',
  SITE_ACCENT_COLOR: process.env.SITE_ACCENT_COLOR || '#f97316',

  // Rate Limiting
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX) || 60,
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000
};
