require('dotenv').config();
const db = require('../config/database');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const PROXY_BASE = process.env.DISCORD_PROXY_BASE || 'https://dawn-sun-102d.abdllafa1.workers.dev';

const roleCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function httpsGet(url, headers, timeout) {
  const https = require('https');
  return new Promise(resolve => {
    const opts = { timeout };
    if (headers) opts.headers = headers;
    const req = https.get(url, opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function fetchMemberRoles(discordUserId) {
  const discordApiUrl = `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discordUserId}`;

  // 1) Try direct Discord API call (works on localhost)
  if (BOT_TOKEN) {
    const directResult = await httpsGet(discordApiUrl, { 'Authorization': `Bot ${BOT_TOKEN}` }, 8000);
    if (directResult && directResult.roles) return directResult.roles;
  }

  // 2) Fallback to Cloudflare Worker proxy
  const proxyUrl = `${PROXY_BASE}?target=${encodeURIComponent(discordApiUrl)}&bot_token=${encodeURIComponent(BOT_TOKEN)}`;
  const proxyResult = await httpsGet(proxyUrl, null, 10000);
  if (proxyResult && proxyResult.roles) return proxyResult.roles;

  return null;
}

async function checkDiscordRole(discordUserId, roleId) {
  if (!discordUserId || !roleId) return null;

  const cacheKey = `${discordUserId}_${roleId}`;
  const cached = roleCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;

  try {
    const roles = await fetchMemberRoles(discordUserId);
    if (roles === null) {
      console.error(`[Discord] Could not fetch roles for user ${discordUserId} — API unavailable`);
      return null;
    }
    const hasRole = roles.includes(roleId);
    roleCache.set(cacheKey, { value: hasRole, ts: Date.now() });
    return hasRole;
  } catch(e) {
    console.error('Discord role check error:', e.message);
    return null;
  }
}

async function getDiscordMemberRoles(discordUserId) {
  if (!discordUserId) return [];
  try {
    const roles = await fetchMemberRoles(discordUserId);
    return roles || [];
  } catch(e) {
    return [];
  }
}

module.exports = { checkDiscordRole, getDiscordMemberRoles, getBotBaseUrl: async () => 'http://fi8.bot-hosting.net:21346', GUILD_ID };
