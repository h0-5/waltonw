const { Client, GatewayIntentBits, Events, Partials } = require('discord.js');
const db = require('../config/database');

let client = null;
let isReady = false;
let connectionPromise = null;

async function getBotSettings() {
  try {
    const [rows] = await db.execute(
      "SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('bot_token','bot_guild_id','bot_log_channel_id','bot_welcome_channel_id','bot_enabled')"
    );
    const settings = {};
    rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
    return settings;
  } catch(e) { return {}; }
}

async function connectBot() {
  const settings = await getBotSettings();
  if (!settings.bot_token || settings.bot_enabled !== '1') {
    console.log('🤖 Bot disabled or no token');
    return null;
  }

  if (client && isReady) return client;

  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent,
        ],
        partials: [Partials.Channel],
      });

      client.once(Events.ClientReady, (c) => {
        console.log(`🤖 Bot ready: ${c.user.tag}`);
        isReady = true;
        saveBotStatus('connected', c.user.tag);
      });

      client.on(Events.Error, (err) => {
        console.error('🤖 Bot error:', err.message);
        saveBotStatus('error', err.message);
      });

      client.on(Events.ShardDisconnect, () => {
        isReady = false;
        saveBotStatus('disconnected', 'shard disconnected');
      });

      await client.login(settings.bot_token);
      return client;
    } catch(e) {
      console.error('🤖 Bot login failed:', e.message);
      saveBotStatus('error', e.message);
      client = null;
      isReady = false;
      connectionPromise = null;
      return null;
    }
  })();

  return connectionPromise;
}

function disconnectBot() {
  if (client) {
    client.destroy();
    client = null;
    isReady = false;
    connectionPromise = null;
    saveBotStatus('disconnected', 'manual disconnect');
  }
}

function getClient() { return client; }
function getIsReady() { return isReady; }

async function saveBotStatus(status, details) {
  try {
    await db.execute(
      "INSERT INTO site_settings (setting_key, setting_value) VALUES ('bot_status', ?) ON DUPLICATE KEY UPDATE setting_value = ?",
      [status, status]
    );
    await db.execute(
      "INSERT INTO site_settings (setting_key, setting_value) VALUES ('bot_status_details', ?) ON DUPLICATE KEY UPDATE setting_value = ?",
      [details || '', details || '']
    );
  } catch(e) {}
}

// ===== Discord Helpers =====

async function getGuild() {
  const settings = await getBotSettings();
  if (!client || !isReady || !settings.bot_guild_id) return null;
  try {
    return await client.guilds.fetch(settings.bot_guild_id);
  } catch(e) { return null; }
}

async function getGuildMembers() {
  const guild = await getGuild();
  if (!guild) return [];
  try {
    const members = await guild.members.fetch();
    return Array.from(members.values());
  } catch(e) { return []; }
}

async function getGuildRoles() {
  const guild = await getGuild();
  if (!guild) return [];
  try {
    const roles = await guild.roles.fetch();
    return Array.from(roles.values()).filter(r => r.name !== '@everyone').sort((a, b) => b.position - a.position);
  } catch(e) { return []; }
}

async function banMember(userId, reason, days) {
  const guild = await getGuild();
  if (!guild) return { error: 'Guild not found' };
  try {
    const member = await guild.members.fetch(userId);
    await member.ban({ deleteMessageSeconds: (days || 0) * 86400, reason: reason || 'Banned from website' });
    return { success: true };
  } catch(e) { return { error: e.message }; }
}

async function unbanMember(userId) {
  const guild = await getGuild();
  if (!guild) return { error: 'Guild not found' };
  try {
    await guild.members.unban(userId);
    return { success: true };
  } catch(e) { return { error: e.message }; }
}

async function kickMember(userId, reason) {
  const guild = await getGuild();
  if (!guild) return { error: 'Guild not found' };
  try {
    const member = await guild.members.fetch(userId);
    await member.kick(reason || 'Kicked from website');
    return { success: true };
  } catch(e) { return { error: e.message }; }
}

async function addRoleToMember(userId, roleId) {
  const guild = await getGuild();
  if (!guild) return { error: 'Guild not found' };
  try {
    const member = await guild.members.fetch(userId);
    await member.roles.add(roleId);
    return { success: true };
  } catch(e) { return { error: e.message }; }
}

async function removeRoleFromMember(userId, roleId) {
  const guild = await getGuild();
  if (!guild) return { error: 'Guild not found' };
  try {
    const member = await guild.members.fetch(userId);
    await member.roles.remove(roleId);
    return { success: true };
  } catch(e) { return { error: e.message }; }
}

async function sendDM(userId, message) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(message);
    return { success: true };
  } catch(e) { return { error: e.message }; }
}

async function sendToChannel(channelId, message) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return { error: 'Channel not found or not text-based' };
    await channel.send(message);
    return { success: true };
  } catch(e) { return { error: e.message }; }
}

async function getChannelInfo(channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return null;
    return { id: channel.id, name: channel.name, type: channel.type, guild: channel.guild?.name };
  } catch(e) { return null; }
}

module.exports = {
  connectBot, disconnectBot, getClient, getIsReady, getBotSettings,
  getGuild, getGuildMembers, getGuildRoles,
  banMember, unbanMember, kickMember,
  addRoleToMember, removeRoleFromMember,
  sendDM, sendToChannel, getChannelInfo,
  sendNotificationDM,
};

// Send DM when user gets a website notification (call this after INSERT INTO notifications)
async function sendNotificationDM(userId, title, message) {
  try {
    if (!isReady || !client) return;
    const settings = await getBotSettings();
    if (settings.bot_enabled !== '1') return;
    // Get user's discord_id
    const [rows] = await db.execute('SELECT discord_id FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!rows.length || !rows[0].discord_id) return;
    const discordId = rows[0].discord_id;
    const user = await client.users.fetch(discordId);
    if (!user) return;
    await user.send('**' + (title || 'إشعار') + '**\n' + (message || ''));
  } catch(e) { /* user may have DMs disabled */ }
}
