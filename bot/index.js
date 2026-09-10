const path = require('path');
const fs = require('fs');
const dotenvPath = fs.existsSync(path.join(__dirname, '.env')) ? path.join(__dirname, '.env') : path.join(__dirname, '..', '.env');
require('dotenv').config({ path: dotenvPath });
const { Client, GatewayIntentBits, Events, Partials, EmbedBuilder, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const mysql = require('mysql2/promise');

// ===== Config =====
const TOKEN = process.env.BOT_TOKEN || 'MTU0NzUyOTI4Nzg2MTY2NTg3Mg.GR8ueg.oMNFPFeMg_K-XLF7utkp02KRD9g8c0gyqb_dGo';
const GUILD_ID = process.env.GUILD_ID || '1547529287861665872';
const CLIENT_ID = process.env.CLIENT_ID || process.env.BOT_CLIENT_ID || '1547529287861665872';
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '1495959992321441932';
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || '1535994979481165835';

if (!TOKEN) {
  console.error('❌ BOT_TOKEN is required');
  process.exit(1);
}

// ===== Database (Optional) =====
let db = null;
const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME || 'railway';

if (DB_HOST && DB_USER && DB_PASSWORD) {
  db = mysql.createPool({
    host: DB_HOST,
    port: parseInt(DB_PORT) || 3306,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
  });
  console.log('📦 Database: Enabled');
} else {
  console.log('📦 Database: Disabled');
}

// ===== Bot Client =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

// ===== Slash Commands =====
const slashCommands = [
  new SlashCommandBuilder().setName('ping').setDescription('عرض سرعة البوت'),
  new SlashCommandBuilder().setName('help').setDescription('عرض كل الأوامر'),
  new SlashCommandBuilder().setName('server').setDescription('معلومات السيرفر'),
  new SlashCommandBuilder().setName('whois').setDescription('معلومات عضو')
    .addUserOption(opt => opt.setName('user').setDescription('العضو').setRequired(false)),
  new SlashCommandBuilder().setName('avatar').setDescription('صورة العضو')
    .addUserOption(opt => opt.setName('user').setDescription('العضو').setRequired(false)),
  new SlashCommandBuilder().setName('roles').setDescription('رتب السيرفر'),
  new SlashCommandBuilder().setName('members').setDescription('عدد الأعضاء'),
  new SlashCommandBuilder().setName('ban').setDescription('حظر عضو')
    .addUserOption(opt => opt.setName('user').setDescription('العضو').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('السبب').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder().setName('unban').setDescription('فك حظر عضو')
    .addStringOption(opt => opt.setName('userid').setDescription('معرف العضو').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  new SlashCommandBuilder().setName('kick').setDescription('طرد عضو')
    .addUserOption(opt => opt.setName('user').setDescription('العضو').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('السبب').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  new SlashCommandBuilder().setName('mute').setDescription('كتم عضو')
    .addUserOption(opt => opt.setName('user').setDescription('العضو').setRequired(true))
    .addIntegerOption(opt => opt.setName('minutes').setDescription('المدة بالدقائق').setRequired(false))
    .addStringOption(opt => opt.setName('reason').setDescription('السبب').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName('warn').setDescription('تحذير عضو')
    .addUserOption(opt => opt.setName('user').setDescription('العضو').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('السبب').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
];

// ===== Register Commands =====
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: slashCommands.map(cmd => cmd.toJSON()) });
    console.log('✅ Slash commands registered!');
  } catch (e) {
    console.error('❌ Failed to register commands:', e.message);
  }
}

// ===== Helpers =====
async function logToChannel(title, description, color) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!channel) return;
    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(color || 0x5865F2).setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch (e) {}
}

async function syncWebsiteBan(discordUser, action, reason) {
  if (!db) return;
  try {
    const [users] = await db.execute('SELECT id FROM users WHERE discord_id = ?', [discordUser.id]);
    if (!users.length) return;
    const userId = users[0].id;
    if (action === 'ban') {
      await db.execute('UPDATE users SET is_banned = 1, ban_reason = ?, banned_at = NOW() WHERE id = ?', [reason || 'Banned from Discord', userId]);
    } else if (action === 'unban') {
      await db.execute('UPDATE users SET is_banned = 0, ban_reason = NULL, banned_at = NULL WHERE id = ?', [userId]);
    }
  } catch (e) {}
}

// ===== Interaction Handler =====
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  try {
    switch (commandName) {
      case 'ping': {
        await interaction.reply(`🏓 Pong! ${client.ws.ping}ms`);
        break;
      }
      case 'help': {
        const embed = new EmbedBuilder()
          .setTitle('📜 أوامر البوت')
          .setColor(0xbc13fe)
          .addFields(
            { name: '👑 أوامر الإدارة', value: ['`/ban` — حظر عضو', '`/unban` — فك حظر', '`/kick` — طرد عضو', '`/mute` — كتم', '`/warn` — تحذير'].join('\n') },
            { name: 'ℹ️ معلومات', value: ['`/whois` — معلومات عضو', '`/server` — معلومات السيرفر', '`/members` — عدد الأعضاء', '`/roles` — رتب السيرفر'].join('\n') },
            { name: '🎮 ترفيه', value: ['`/avatar` — صورة العضو', '`/ping` — سرعة البوت'].join('\n') },
          )
          .setFooter({ text: 'Walton Family Bot' });
        await interaction.reply({ embeds: [embed] });
        break;
      }
      case 'server': {
        const guild = interaction.guild;
        const embed = new EmbedBuilder()
          .setTitle('🏠 ' + guild.name)
          .setThumbnail(guild.iconURL({ size: 256 }))
          .setColor(0xbc13fe)
          .addFields(
            { name: 'المالك', value: `<@${guild.ownerId}>`, inline: true },
            { name: 'الأعضاء', value: guild.memberCount.toString(), inline: true },
            { name: 'القنوات', value: guild.channels.cache.size.toString(), inline: true },
            { name: 'تاريخ الإنشاء', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
          );
        await interaction.reply({ embeds: [embed] });
        break;
      }
      case 'whois': {
        const user = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.reply('❌ عضو غير موجود');
        const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.toString()).join(', ') || 'لا يوجد';
        const embed = new EmbedBuilder()
          .setTitle('📋 معلومات العضو')
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .setColor(member.displayColor || 0xbc13fe)
          .addFields(
            { name: 'الاسم', value: user.tag, inline: true },
            { name: 'المعرف', value: user.id, inline: true },
            { name: 'تاريخ الانضمام', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
            { name: 'تاريخ الإنشاء', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: 'الرتب (' + member.roles.cache.size + ')', value: roles.substring(0, 1024) },
          );
        await interaction.reply({ embeds: [embed] });
        break;
      }
      case 'avatar': {
        const user = interaction.options.getUser('user') || interaction.user;
        const embed = new EmbedBuilder()
          .setTitle('🖼️ ' + user.tag)
          .setImage(user.displayAvatarURL({ size: 512 }))
          .setColor(0xbc13fe);
        await interaction.reply({ embeds: [embed] });
        break;
      }
      case 'roles': {
        const roles = interaction.guild.roles.cache
          .filter(r => r.name !== '@everyone')
          .sort((a, b) => b.position - a.position)
          .map(r => `${r} (${r.members.size} عضو)`)
          .join('\n');
        const embed = new EmbedBuilder()
          .setTitle('🛡️ رتب السيرفر (' + interaction.guild.roles.cache.size + ')')
          .setDescription(roles.substring(0, 4096))
          .setColor(0xbc13fe);
        await interaction.reply({ embeds: [embed] });
        break;
      }
      case 'members': {
        const guild = interaction.guild;
        const bots = guild.members.cache.filter(m => m.user.bot).size;
        const humans = guild.memberCount - bots;
        await interaction.reply(`👥 الأعضاء: ${guild.memberCount}\n👤 أعضاء: ${humans}\n🤖 بوتات: ${bots}`);
        break;
      }
      case 'ban': {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'Banned by moderator';
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.reply('❌ عضو غير موجود في السيرفر');
        if (!member.bannable) return interaction.reply('❌ لا أستطيع حظر هذا العضو');
        await member.ban({ reason });
        await syncWebsiteBan(user, 'ban', reason);
        await logToChannel('🔨 تم الحظر', `**${user.tag}** حُظر بواسطة ${interaction.user}\n**السبب:** ${reason}`, 0xef4444);
        await interaction.reply(`✅ تم حظر ${user.tag}`);
        break;
      }
      case 'unban': {
        const userId = interaction.options.getString('userid');
        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) return interaction.reply('❌ مستخدم غير موجود');
        try {
          await interaction.guild.members.unban(userId);
          await syncWebsiteBan(user, 'unban');
          await logToChannel('✅ تم فك الحظر', `**${user.tag}** فُك حظره بواسطة ${interaction.user}`, 0x22c55e);
          await interaction.reply(`✅ تم فك حظر ${user.tag}`);
        } catch (e) {
          await interaction.reply('❌ خطأ: ' + e.message);
        }
        break;
      }
      case 'kick': {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'Kicked by moderator';
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.reply('❌ عضو غير موجود');
        if (!member.kickable) return interaction.reply('❌ لا أستطيع طرد هذا العضو');
        await member.kick(reason);
        await logToChannel('🚪 تم الطرد', `**${user.tag}** طُرد بواسطة ${interaction.user}\n**السبب:** ${reason}`, 0xf59e0b);
        await interaction.reply(`✅ تم طرد ${user.tag}`);
        break;
      }
      case 'mute': {
        const user = interaction.options.getUser('user');
        const minutes = interaction.options.getInteger('minutes') || 10;
        const reason = interaction.options.getString('reason') || 'Muted by moderator';
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.reply('❌ عضو غير موجود');
        await member.timeout(minutes * 60 * 1000, reason);
        await logToChannel('🔇 تم الكتم', `**${user.tag}** صُمت لمدة ${minutes} دقيقة بواسطة ${interaction.user}`, 0x9ca3af);
        await interaction.reply(`✅ تم كتم ${user.tag} لمدة ${minutes} دقيقة`);
        break;
      }
      case 'warn': {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.reply('❌ عضو غير موجود');
        if (db) {
          try {
            await db.execute('INSERT INTO admin_warnings (user_id, username, issued_by, issuer_name, reason, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
              [0, user.username, interaction.user.id, interaction.user.username, reason]);
          } catch (e) {}
        }
        await logToChannel('⚠️ تحذير', `**${user.tag}** حُذر بواسطة ${interaction.user}\n**السبب:** ${reason}`, 0xf59e0b);
        await interaction.reply(`✅ تم تحذير ${user.tag}`);
        try { await user.send(`⚠️ لقد حُذرنت في ${interaction.guild.name}\n**السبب:** ${reason}`); } catch (e) {}
        break;
      }
    }
  } catch (e) {
    console.error('Command error:', e);
    const reply = { content: '❌ حصل خطأ', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

// ===== Ready =====
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot logged in as ${c.user.tag}`);
  console.log(`   Guild: ${GUILD_ID}`);
  console.log(`   Servers: ${c.guilds.cache.size}`);
  c.user.setActivity('Walton Family', { type: 3 });
  await registerCommands();
  if (db) {
    startActionPoller();
  }
});

// ===== Bot Actions Poller (Website → Discord) =====
async function processBotAction(action) {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  try {
    switch (action.action) {
      case 'ban': {
        const member = await guild.members.fetch(action.target_discord_id).catch(() => null);
        if (!member) {
          await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', 'Member not found in server', action.id]);
          return;
        }
        if (!member.bannable) {
          await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', 'Bot cannot ban this member', action.id]);
          return;
        }
        await member.ban({ reason: action.reason || 'Banned from website' });
        await syncWebsiteBan(member.user, 'ban', action.reason);
        await logToChannel('🔨 تم الحظر (من الموقع)', `**${member.user.tag}** حُظر بواسطة الموقع\n**السبب:** ${action.reason || 'N/A'}`, 0xef4444);
        await db.execute('UPDATE bot_actions SET status = ?, executed_at = NOW() WHERE id = ?', ['completed', action.id]);
        break;
      }
      case 'unban': {
        try {
          await guild.members.unban(action.target_discord_id);
          const user = await client.users.fetch(action.target_discord_id).catch(() => null);
          if (user) await syncWebsiteBan(user, 'unban');
          await logToChannel('✅ تم فك الحظر (من الموقع)', `**${action.target_name || action.target_discord_id}** فُك حظره`, 0x22c55e);
          await db.execute('UPDATE bot_actions SET status = ?, executed_at = NOW() WHERE id = ?', ['completed', action.id]);
        } catch (e) {
          await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', e.message, action.id]);
        }
        break;
      }
      case 'kick': {
        const member = await guild.members.fetch(action.target_discord_id).catch(() => null);
        if (!member) {
          await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', 'Member not found', action.id]);
          return;
        }
        if (!member.kickable) {
          await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', 'Bot cannot kick this member', action.id]);
          return;
        }
        await member.kick(action.reason || 'Kicked from website');
        await logToChannel('🚪 تم الطرد (من الموقع)', `**${member.user.tag}** طُرد\n**السبب:** ${action.reason || 'N/A'}`, 0xf59e0b);
        await db.execute('UPDATE bot_actions SET status = ?, executed_at = NOW() WHERE id = ?', ['completed', action.id]);
        break;
      }
      case 'mute': {
        const member = await guild.members.fetch(action.target_discord_id).catch(() => null);
        if (!member) {
          await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', 'Member not found', action.id]);
          return;
        }
        const duration = (action.duration_minutes || 10) * 60 * 1000;
        await member.timeout(duration, action.reason || 'Muted from website');
        await logToChannel('🔇 تم الكتم (من الموقع)', `**${member.user.tag}** صُمت لمدة ${action.duration_minutes || 10} دقيقة\n**السبب:** ${action.reason || 'N/A'}`, 0x9ca3af);
        await db.execute('UPDATE bot_actions SET status = ?, executed_at = NOW() WHERE id = ?', ['completed', action.id]);
        break;
      }
      case 'unmute': {
        const member = await guild.members.fetch(action.target_discord_id).catch(() => null);
        if (!member) {
          await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', 'Member not found', action.id]);
          return;
        }
        await member.timeout(null, 'Unmuted from website');
        await logToChannel('🔊 تم فك الكتم (من الموقع)', `**${member.user.tag}** فُك كتمه`, 0x22c55e);
        await db.execute('UPDATE bot_actions SET status = ?, executed_at = NOW() WHERE id = ?', ['completed', action.id]);
        break;
      }
      case 'warn': {
        const member = await guild.members.fetch(action.target_discord_id).catch(() => null);
        if (!member) {
          await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', 'Member not found', action.id]);
          return;
        }
        try {
          await member.send(`⚠️ لقد حُذرنت في ${guild.name}\n**السبب:** ${action.reason || 'No reason'}`);
        } catch (e) {}
        await logToChannel('⚠️ تحذير (من الموقع)', `**${member.user.tag}** حُذر\n**السبب:** ${action.reason || 'N/A'}`, 0xf59e0b);
        await db.execute('UPDATE bot_actions SET status = ?, executed_at = NOW() WHERE id = ?', ['completed', action.id]);
        break;
      }
      case 'add_role': {
        const member = await guild.members.fetch(action.target_discord_id).catch(() => null);
        if (!member) {
          await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', 'Member not found', action.id]);
          return;
        }
        const role = guild.roles.cache.find(r => r.name === action.role_name);
        if (!role) {
          await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', `Role "${action.role_name}" not found`, action.id]);
          return;
        }
        await member.roles.add(role);
        await logToChannel('🛡️ تغيير رتبة (من الموقع)', `**${member.user.tag}** حصل على رتبة **${role.name}**`, 0xbc13fe);
        await db.execute('UPDATE bot_actions SET status = ?, executed_at = NOW() WHERE id = ?', ['completed', action.id]);
        break;
      }
      case 'remove_role': {
        const member = await guild.members.fetch(action.target_discord_id).catch(() => null);
        if (!member) {
          await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', 'Member not found', action.id]);
          return;
        }
        const role = guild.roles.cache.find(r => r.name === action.role_name);
        if (!role) {
          await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', `Role "${action.role_name}" not found`, action.id]);
          return;
        }
        await member.roles.remove(role);
        await logToChannel('🛡️ إزالة رتبة (من الموقع)', `**${member.user.tag}** شُالت منه رتبة **${role.name}**`, 0xf59e0b);
        await db.execute('UPDATE bot_actions SET status = ?, executed_at = NOW() WHERE id = ?', ['completed', action.id]);
        break;
      }
      default:
        await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', `Unknown action: ${action.action}`, action.id]);
    }
  } catch (e) {
    console.error('Bot action error:', e);
    await db.execute('UPDATE bot_actions SET status = ?, result = ?, executed_at = NOW() WHERE id = ?', ['failed', e.message, action.id]);
  }
}

function startActionPoller() {
  console.log('🔄 Bot action poller started (every 5s)');
  setInterval(async () => {
    if (!db) return;
    try {
      const [actions] = await db.execute('SELECT * FROM bot_actions WHERE status = ? ORDER BY created_at ASC LIMIT 5', ['pending']);
      for (const action of actions) {
        await db.execute('UPDATE bot_actions SET status = ? WHERE id = ?', ['processing', action.id]);
        await processBotAction(action);
      }
    } catch (e) {
      console.error('Action poller error:', e.message);
    }
  }, 5000);
}

// ===== Member Join =====
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  if (db) {
    try {
      const [users] = await db.execute('SELECT id FROM users WHERE discord_id = ?', [member.id]);
      if (users.length) await db.execute('UPDATE users SET in_guild = 1 WHERE id = ?', [users[0].id]);
    } catch (e) {}
  }
  if (WELCOME_CHANNEL_ID) {
    try {
      const channel = await client.channels.fetch(WELCOME_CHANNEL_ID);
      if (channel) {
        const embed = new EmbedBuilder()
          .setTitle('🎉 عضو جديد!')
          .setDescription(`مرحباً ${member} في **Walton Family**!`)
          .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
          .setColor(0x22c55e)
          .setTimestamp();
        await channel.send({ embeds: [embed] });
      }
    } catch (e) {}
  }
  await logToChannel('➕ عضو جديد', `${member.user.tag} (${member.id})`, 0x22c55e);
});

// ===== Member Leave =====
client.on(Events.GuildMemberRemove, async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  if (db) {
    try {
      const [users] = await db.execute('SELECT id FROM users WHERE discord_id = ?', [member.id]);
      if (users.length) await db.execute('UPDATE users SET in_guild = 0 WHERE id = ?', [users[0].id]);
    } catch (e) {}
  }
  await logToChannel('➖ عضو خرج', `${member.user.tag} (${member.id})`, 0xef4444);
});

// ===== Login =====
client.login(TOKEN).catch(e => {
  console.error('❌ Login failed:', e.message);
  process.exit(1);
});

process.on('SIGTERM', () => { client.destroy(); process.exit(0); });
process.on('SIGINT', () => { client.destroy(); process.exit(0); });
