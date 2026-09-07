const webhooks = require('../config/webhooks');
const axios = require('axios');

async function sendWebhook(webhookKey, data) {
  const url = webhooks[webhookKey];
  if (!url) return;

  try {
    await axios.post(url, {
      username: data.username || 'Walton Family',
      avatar_url: data.avatar || '',
      embeds: data.embeds ? undefined : [{
        title: data.title || 'Notification',
        description: data.description || '',
        color: data.color || 0x780ecf,
        fields: data.fields || [],
        footer: { text: data.footer || 'Walton Family Admin' },
        timestamp: new Date().toISOString()
      }],
      content: data.embeds ? undefined : undefined
    }, { timeout: 5000 });
  } catch(e) {
    console.error(`Webhook ${webhookKey} failed:`, e.message);
  }
}

async function logAdminAction(userId, username, action, targetType, targetId, targetName, details, ip) {
  try {
    const db = require('../config/database');
    await db.execute(
      'INSERT INTO admin_logs (user_id, username, action, target_type, target_id, target_name, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [userId, username, action, targetType, targetId || null, targetName || '', details || '', ip || '']
    );
  } catch(e) {}

  sendWebhook('WH_ADMIN_LOG', {
    title: '🔨 ' + action,
    description: `**${username}** ${details || ''}`,
    color: 0x780ecf,
    fields: targetType ? [{ name: 'Target', value: `${targetType} #${targetId || ''} ${targetName || ''}`, inline: true }] : []
  });
}

module.exports = { sendWebhook, logAdminAction };
