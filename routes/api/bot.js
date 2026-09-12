const express = require('express');
const router = express.Router();
const db = require('../../config/database');
const { checkPermission } = require('../../middleware/auth');
const bot = require('../../bot/client');

// ===== Bot Status =====
router.get('/status', checkPermission('bot_manage'), async (req, res) => {
  try {
    const settings = await bot.getBotSettings();
    const ready = bot.getIsReady();
    let guildInfo = null;
    if (ready) {
      const guild = await bot.getGuild();
      if (guild) {
        guildInfo = { name: guild.name, icon: guild.iconURL(), memberCount: guild.memberCount, id: guild.id };
      }
    }
    res.json({ success: true, connected: ready, guild: guildInfo, enabled: settings.bot_enabled === '1' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Connect / Disconnect =====
router.post('/connect', checkPermission('bot_manage'), async (req, res) => {
  try {
    await db.execute("INSERT INTO site_settings (setting_key, setting_value) VALUES ('bot_enabled', '1') ON DUPLICATE KEY UPDATE setting_value = '1'");
    const client = await bot.connectBot();
    if (client) {
      res.json({ success: true, message: 'Bot connected' });
    } else {
      res.json({ success: false, error: 'Failed to connect. Check token.' });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/disconnect', checkPermission('bot_manage'), async (req, res) => {
  try {
    await db.execute("INSERT INTO site_settings (setting_key, setting_value) VALUES ('bot_enabled', '0') ON DUPLICATE KEY UPDATE setting_value = '0'");
    bot.disconnectBot();
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Save Config =====
router.post('/config', checkPermission('bot_manage'), async (req, res) => {
  try {
    const { bot_token, bot_guild_id, bot_log_channel_id, bot_welcome_channel_id } = req.body;
    for (const [key, value] of Object.entries(req.body)) {
      if (value !== undefined && value !== null) {
        await db.execute(
          'INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
          [key, String(value), String(value)]
        );
      }
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Members =====
router.get('/members', checkPermission('bot_manage'), async (req, res) => {
  try {
    const members = await bot.getGuildMembers();
    const roles = await bot.getGuildRoles();
    const membersData = members.map(m => ({
      id: m.id,
      username: m.user.username,
      displayName: m.displayName,
      avatar: m.user.displayAvatarURL({ size: 128 }),
      joinedAt: m.joinedAt,
      roles: m.roles.cache.filter(r => r.name !== '@everyone').map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
      isBanned: m.user.bot ? false : false,
      isOnline: m.presence?.status || 'offline',
    }));
    res.json({ success: true, members: membersData, roles: roles.map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Member Actions =====
router.post('/members/:id/ban', checkPermission('bot_manage'), async (req, res) => {
  try {
    const { reason, days } = req.body;
    const result = await bot.banMember(req.params.id, reason, days);
    if (result.success) {
      await logBotAction(req.user, 'ban_member', req.params.id, reason);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/members/:id/unban', checkPermission('bot_manage'), async (req, res) => {
  try {
    const result = await bot.unbanMember(req.params.id);
    if (result.success) {
      await logBotAction(req.user, 'unban_member', req.params.id, '');
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/members/:id/kick', checkPermission('bot_manage'), async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await bot.kickMember(req.params.id, reason);
    if (result.success) {
      await logBotAction(req.user, 'kick_member', req.params.id, reason);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/members/:id/roles', checkPermission('bot_manage'), async (req, res) => {
  try {
    const { addRoles, removeRoles } = req.body;
    if (addRoles) {
      for (const roleId of addRoles) {
        await bot.addRoleToMember(req.params.id, roleId);
      }
    }
    if (removeRoles) {
      for (const roleId of removeRoles) {
        await bot.removeRoleFromMember(req.params.id, roleId);
      }
    }
    await logBotAction(req.user, 'manage_roles', req.params.id, JSON.stringify({ addRoles, removeRoles }));
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Banned Members =====
router.get('/banned', checkPermission('bot_manage'), async (req, res) => {
  try {
    const guild = await bot.getGuild();
    if (!guild) return res.json({ success: true, banned: [] });
    const bans = await guild.bans.fetch();
    const banned = bans.map(b => ({ id: b.user.id, username: b.user.username, avatar: b.user.displayAvatarURL({ size: 64 }), reason: b.reason }));
    res.json({ success: true, banned: Array.from(banned.values()) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Send DM =====
router.post('/dm', checkPermission('bot_manage'), async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) return res.status(400).json({ error: 'Missing userId or message' });
    const result = await bot.sendDM(userId, message);
    if (result.success) {
      await logBotAction(req.user, 'send_dm', userId, message.substring(0, 200));
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Send to Channel =====
router.post('/channel', checkPermission('bot_manage'), async (req, res) => {
  try {
    const { channelId, message } = req.body;
    if (!channelId || !message) return res.status(400).json({ error: 'Missing channelId or message' });
    const result = await bot.sendToChannel(channelId, message);
    if (result.success) {
      await logBotAction(req.user, 'send_channel', channelId, message.substring(0, 200));
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Channels =====
router.get('/channels', checkPermission('bot_manage'), async (req, res) => {
  try {
    const guild = await bot.getGuild();
    if (!guild) return res.json({ success: true, channels: [] });
    const channels = await guild.channels.fetch();
    const textChannels = channels.filter(c => c.isTextBased() && !c.isVoiceBased()).map(c => ({ id: c.id, name: c.name, category: c.parent?.name || '' }));
    res.json({ success: true, channels: Array.from(textChannels.values()) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== Bot Logs =====
router.get('/logs', checkPermission('bot_manage'), async (req, res) => {
  try {
    const [logs] = await db.execute('SELECT * FROM admin_logs WHERE action LIKE ? ORDER BY created_at DESC LIMIT 100', ['bot_%']);
    res.json({ success: true, logs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

async function logBotAction(user, action, targetId, details) {
  try {
    await db.execute(
      'INSERT INTO admin_logs (user_id, username, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [user?.id || 0, user?.username || 'system', 'bot_' + action, 'discord_user', targetId, (details || '').substring(0, 1000)]
    );
  } catch(e) {}
}

module.exports = router;
