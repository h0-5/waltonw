require('dotenv').config();
const db = require('../config/database');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const PROXY_BASE = process.env.DISCORD_PROXY_BASE || 'https://dawn-sun-102d.abdllafa1.workers.dev';

const roleCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getBotBaseUrl() {
  try {
    const [rows] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'bot_base_url' LIMIT 1");
    if (rows.length && rows[0].setting_value) {
      return rows[0].setting_value;
    }
  } catch(e) {}
  return 'http://fi8.bot-hosting.net:21346';
}

async function checkDiscordRole(discordUserId, roleId) {
  if (!discordUserId || !roleId) return false;

  const cacheKey = `${discordUserId}_${roleId}`;
  const cached = roleCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;

  try {
    const https = require('https');
    const url = `${PROXY_BASE}?target=${encodeURIComponent(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discordUserId}`)}&bot_token=${encodeURIComponent(BOT_TOKEN)}`;

    const result = await new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 8000 }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });

    if (result && result.roles) {
      const hasRole = result.roles.includes(roleId);
      roleCache.set(cacheKey, { value: hasRole, ts: Date.now() });
      return hasRole;
    }
  } catch(e) {
    console.error('Discord role check error:', e.message);
  }

  return false;
}

async function getDiscordMemberRoles(discordUserId) {
  if (!discordUserId) return [];

  try {
    const https = require('https');
    const url = `${PROXY_BASE}?target=${encodeURIComponent(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discordUserId}`)}&bot_token=${encodeURIComponent(BOT_TOKEN)}`;

    const result = await new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 8000 }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });

    return (result && result.roles) ? result.roles : [];
  } catch(e) {
    return [];
  }
}

module.exports = { checkDiscordRole, getDiscordMemberRoles, getBotBaseUrl, GUILD_ID };
