const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Client, GatewayIntentBits, Events, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const mysql = require('mysql2/promise');

// ===== Database (Optional) =====
let db = null;
const DB_ENABLED = process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD;

if (DB_ENABLED) {
  db = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'waltonw',
    waitForConnections: true,
    connectionLimit: 5,
  });
  console.log('📦 Database: Enabled');
} else {
  console.log('📦 Database: Disabled (no DB credentials)');
}

// ===== Config =====
const TOKEN = process.env.BOT_TOKEN || 'MTU0NzUyOTI4Nzg2MTY2NTg3Mg.GrCEjo.YtSletGspdFIlXFwVKC0hjlrRauvi2LdkVDS9g';
const GUILD_ID = process.env.GUILD_ID || '1547529287861665872';
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '1495959992321441932';
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || '1535994979481165835';
const PREFIX = process.env.PREFIX || '!';

if (!TOKEN) {
  console.error('❌ BOT_TOKEN is required in .env');
  console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('BOT') || k.includes('TOKEN') || k.includes('GUILD') || k.includes('DB')).join(', ') || 'NONE found');
  process.exit(1);
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

// ===== Ready =====
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot logged in as ${c.user.tag}`);
  console.log(`   Guild: ${GUILD_ID}`);
  console.log(`   Servers: ${c.guilds.cache.size}`);
  c.user.setActivity('Walton Family', { type: 3 });
});

// ===== Helpers =====
async function getGuild() {
  try { return await client.guilds.fetch(GUILD_ID); } catch(e) { return null; }
}

async function logToChannel(title, description, color) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color || 0x5865F2)
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch(e) {}
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
  } catch(e) {}
}

// ===== Commands =====
const commands = {
  // !help
  help: {
    name: 'help',
    description: 'عرض كل الأوامر',
    async execute(message) {
      const embed = new EmbedBuilder()
        .setTitle('📜 أوامر البوت')
        .setColor(0xbc13fe)
        .addFields(
          { name: '👑 أوامر الإدارة', value: [
            '`!ban @user [سبب]` — حظر عضو',
            '`!unban @user` — فك حظر',
            '`!kick @user [سبب]` — طرد عضو',
            '`!mute @user [دقائق]` — كتم',
            '`!warn @user [سبب]` — تحذير',
          ].join('\n') },
          { name: 'ℹ️ معلومات', value: [
            '`!whois @user` — معلومات عضو',
            '`!server` — معلومات السيرفر',
            '`!members` — عدد الأعضاء',
            '`!roles` — رتب السيرفر',
          ].join('\n') },
          { name: '🎮 ترفيه', value: [
            '`!avatar @user` — صورة العضو',
            '`!ping` — سرعة البوت',
          ].join('\n') },
        )
        .setFooter({ text: 'Walton Family Bot' });
      await message.reply({ embeds: [embed] });
    }
  },

  // !ban
  ban: {
    name: 'ban',
    description: 'حظر عضو',
    permissions: ['BanMembers'],
    async execute(message, args) {
      const member = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
      if (!member) return message.reply('❌ حدد العضو: `!ban @user [سبب]`');
      if (!member.bannable) return message.reply('❌ لا أستطيع حظر هذا العضو');
      const reason = args.slice(1).join(' ') || 'Banned by moderator';
      await member.ban({ reason });
      await syncWebsiteBan(member.user, 'ban', reason);
      await logToChannel('🔨 تم الحظر', `**${member.user.tag}** حُظر بواسطة ${message.author}\n**السبب:** ${reason}`, 0xef4444);
      await message.reply(`✅ تم حظر ${member.user.tag}`);
    }
  },

  // !unban
  unban: {
    name: 'unban',
    description: 'فك حظر عضو',
    permissions: ['BanMembers'],
    async execute(message, args) {
      if (!args[0]) return message.reply('❌ حدد معرف العضو: `!unban 123456789`');
      const user = await client.users.fetch(args[0]).catch(() => null);
      if (!user) return message.reply('❌ مستخدم غير موجود');
      try {
        await message.guild.members.unban(args[0]);
        await syncWebsiteBan(user, 'unban');
        await logToChannel('✅ تم فك الحظر', `**${user.tag}** فُك حظره بواسطة ${message.author}`, 0x22c55e);
        await message.reply(`✅ تم فك حظر ${user.tag}`);
      } catch(e) { await message.reply('❌ خطأ: ' + e.message); }
    }
  },

  // !kick
  kick: {
    name: 'kick',
    description: 'طرد عضو',
    permissions: ['KickMembers'],
    async execute(message, args) {
      const member = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null);
      if (!member) return message.reply('❌ حدد العضو: `!kick @user [سبب]`');
      if (!member.kickable) return message.reply('❌ لا أستطيع طرد هذا العضو');
      const reason = args.slice(1).join(' ') || 'Kicked by moderator';
      await member.kick(reason);
      await logToChannel('🚪 تم الطرد', `**${member.user.tag}** طُرد بواسطة ${message.author}\n**السبب:** ${reason}`, 0xf59e0b);
      await message.reply(`✅ تم طرد ${member.user.tag}`);
    }
  },

  // !mute
  mute: {
    name: 'mute',
    description: 'كتم عضو',
    permissions: ['ModerateMembers'],
    async execute(message, args) {
      const member = message.mentions.members.first();
      if (!member) return message.reply('❌ حدد العضو: `!mute @user [دقائق]`');
      const minutes = parseInt(args[1]) || 10;
      await member.timeout(minutes * 60 * 1000, args.slice(2).join(' ') || 'Muted by moderator');
      await logToChannel('🔇 تم الكتم', `**${member.user.tag}** صُمت لمدة ${minutes} دقيقة بواسطة ${message.author}`, 0x9ca3af);
      await message.reply(`✅ تم كتم ${member.user.tag} لمدة ${minutes} دقيقة`);
    }
  },

  // !warn
  warn: {
    name: 'warn',
    description: 'تحذير عضو',
    permissions: ['ModerateMembers'],
    async execute(message, args) {
      const member = message.mentions.members.first();
      if (!member) return message.reply('❌ حدد العضو: `!warn @user [سبب]`');
      const reason = args.slice(1).join(' ') || 'No reason provided';
      if (db) {
        try {
          await db.execute('INSERT INTO admin_warnings (user_id, username, issued_by, issuer_name, reason, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
            [0, member.user.username, message.author.id, message.author.username, reason]);
        } catch(e) {}
      }
      await logToChannel('⚠️ تحذير', `**${member.user.tag}** حُذر بواسطة ${message.author}\n**السبب:** ${reason}`, 0xf59e0b);
      await message.reply(`✅ تم تحذير ${member.user.tag}`);
      try { await member.send(`⚠️ لقد حُذرنت في ${message.guild.name}\n**السبب:** ${reason}`); } catch(e) {}
    }
  },

  // !whois
  whois: {
    name: 'whois',
    description: 'معلومات عضو',
    async execute(message, args) {
      const member = message.mentions.members.first() || (args[0] ? await message.guild.members.fetch(args[0]).catch(() => null) : null) || message.member;
      const roles = member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.toString()).join(', ') || 'لا يوجد';
      const embed = new EmbedBuilder()
        .setTitle('📋 معلومات العضو')
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setColor(member.displayColor || 0xbc13fe)
        .addFields(
          { name: 'الاسم', value: member.user.tag, inline: true },
          { name: 'المعرف', value: member.id, inline: true },
          { name: 'تاريخ الانضمام', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
          { name: 'تاريخ الإنشاء', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'الرتب (' + member.roles.cache.size + ')', value: roles.substring(0, 1024) },
        );
      await message.reply({ embeds: [embed] });
    }
  },

  // !server
  server: {
    name: 'server',
    description: 'معلومات السيرفر',
    async execute(message) {
      const guild = message.guild;
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
      await message.reply({ embeds: [embed] });
    }
  },

  // !avatar
  avatar: {
    name: 'avatar',
    description: 'صورة العضو',
    async execute(message, args) {
      const member = message.mentions.members.first() || message.member;
      const embed = new EmbedBuilder()
        .setTitle('🖼️ ' + member.user.tag)
        .setImage(member.user.displayAvatarURL({ size: 512 }))
        .setColor(0xbc13fe);
      await message.reply({ embeds: [embed] });
    }
  },

  // !ping
  ping: {
    name: 'ping',
    description: 'سرعة البوت',
    async execute(message) {
      const sent = await message.reply('⏳ Pinging...');
      await sent.edit(`🏓 Pong! ${client.ws.ping}ms`);
    }
  },

  // !roles
  roles: {
    name: 'roles',
    description: 'رتب السيرفر',
    async execute(message) {
      const roles = message.guild.roles.cache
        .filter(r => r.name !== '@everyone')
        .sort((a, b) => b.position - a.position)
        .map(r => `${r} (${r.members.size} عضو)`)
        .join('\n');
      const embed = new EmbedBuilder()
        .setTitle('🛡️ رتب السيرفر (' + message.guild.roles.cache.size + ')')
        .setDescription(roles.substring(0, 4096))
        .setColor(0xbc13fe);
      await message.reply({ embeds: [embed] });
    }
  },

  // !members
  members: {
    name: 'members',
    description: 'عدد الأعضاء',
    async execute(message) {
      const guild = message.guild;
      const online = guild.members.cache.filter(m => m.presence?.status === 'online').size;
      const bots = guild.members.cache.filter(m => m.user.bot).size;
      await message.reply(`👥 الأعضاء: ${guild.memberCount}\n🟢 متصلين: ${online}\n🤖 بوتات: ${bots}`);
    }
  },
};

// ===== Message Handler =====
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  const command = commands[commandName];
  if (!command) return;

  // Permission check
  if (command.permissions && command.permissions.length) {
    const member = message.member;
    const hasPerms = command.permissions.every(perm => member.permissions.has(perm));
    if (!hasPerms) return message.reply('❌ ما عندك صلاحية كافية');
  }

  try {
    await command.execute(message, args);
  } catch(e) {
    console.error('Command error:', e);
    message.reply('❌ حصل خطأ').catch(() => {});
  }
});

// ===== Member Join =====
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  // Sync with website
  if (db) {
    try {
      const [users] = await db.execute('SELECT id FROM users WHERE discord_id = ?', [member.id]);
      if (users.length) {
        await db.execute('UPDATE users SET in_guild = 1 WHERE id = ?', [users[0].id]);
      }
    } catch(e) {}
  }
  // Welcome message
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
    } catch(e) {}
  }
  await logToChannel('➕ عضو جديد', `${member.user.tag} (${member.id})`, 0x22c55e);
});

// ===== Member Leave =====
client.on(Events.GuildMemberRemove, async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  if (db) {
    try {
      const [users] = await db.execute('SELECT id FROM users WHERE discord_id = ?', [member.id]);
      if (users.length) {
        await db.execute('UPDATE users SET in_guild = 0 WHERE id = ?', [users[0].id]);
      }
    } catch(e) {}
  }
  await logToChannel('➖ عضو خرج', `${member.user.tag} (${member.id})`, 0xef4444);
});

// ===== Login =====
client.login(TOKEN).catch(e => {
  console.error('❌ Login failed:', e.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => { client.destroy(); process.exit(0); });
process.on('SIGINT', () => { client.destroy(); process.exit(0); });
