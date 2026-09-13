const webhooks = require('../config/webhooks');
const axios = require('axios');

/* القيم الأصلية من متغيرات البيئة (Railway) — مرجع الرجوع عند مسح قيمة من قاعدة البيانات */
const ENV_BASE = Object.assign({}, webhooks);

/* مصدر كل رابط: db (محفوظ من لوحة الإدارة) / env (متغيرات Railway) / none (غير مضبوط) */
const _sources = {};
webhooks._sources = _sources;

const DB_PREFIX = 'wh_url_';

/* رابط ويبهوك ديسكورد الصحيح: https://discord.com/api/webhooks/{id}/{token} */
function isDiscordWebhookUrl(url) {
  return /^https:\/\/(canary\.|ptb\.)?(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+(\?.*)?$/.test(String(url || '').trim());
}

/* تحميل روابط الويبهوك المحفوظة من لوحة الإدارة (site_settings) —
   قيمة اللوحة تتغلب على متغيرات Railway، وقيمة فارغة ترجع لمتغير البيئة */
async function refreshWebhookUrls() {
  try {
    const db = require('../config/database');
    const [rows] = await db.execute(`SELECT setting_key, setting_value FROM site_settings WHERE setting_key LIKE '${DB_PREFIX}%'`);
    const dbVals = {};
    for (const r of rows) {
      const key = String(r.setting_key).slice(DB_PREFIX.length);
      if (/^WH_[A-Z_]+$/.test(key) && key !== 'WH_PROXY') dbVals[key] = String(r.setting_value || '').trim();
    }
    for (const key of Object.keys(ENV_BASE)) {
      if (key === 'WH_PROXY') continue;
      const fromDb = dbVals[key];
      if (fromDb) { webhooks[key] = fromDb; _sources[key] = 'db'; }
      else { webhooks[key] = ENV_BASE[key] || ''; _sources[key] = ENV_BASE[key] ? 'env' : 'none'; }
    }
  } catch(e) {
    console.error('refreshWebhookUrls failed:', e.message);
  }
  return webhooks;
}

async function sendWebhook(webhookKey, data) {
  const url = webhooks[webhookKey];
  if (!url) return { ok: false, error: 'not_set' };
  if (!isDiscordWebhookUrl(url)) return { ok: false, error: 'bad_url' };

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
      content: data.content || undefined
    }, { timeout: 5000 });
    return { ok: true };
  } catch(e) {
    console.error(`Webhook ${webhookKey} failed:`, e.message);
    const status = e.response && e.response.status;
    return { ok: false, error: status ? 'HTTP ' + status : (e.message || 'send_failed') };
  }
}

/* رسالة تجربة — تثبت إن الرابط شغال وإن الإشعارات توصل القناة */
async function sendTestWebhook(webhookKey, urlOverride) {
  const url = String(urlOverride || webhooks[webhookKey] || '').trim();
  if (!url) return { ok: false, error: 'ما فيه رابط محفوظ — الصق الرابط أولاً' };
  if (!isDiscordWebhookUrl(url)) return { ok: false, error: 'الرابط ما يشبه رابط ويبهوك ديسكورد — انسخه كامل من إعدادات السيرفر' };
  try {
    await axios.post(url, {
      username: 'Walton Family',
      embeds: [{
        title: '✅ اختبار ويبهوك والتون',
        description: 'الرابط شغال — إشعارات `' + webhookKey + '` راح توصل هالقناة.',
        color: 0x22c55e,
        footer: { text: 'Walton Family — Webhook Test' },
        timestamp: new Date().toISOString()
      }]
    }, { timeout: 5000 });
    return { ok: true };
  } catch(e) {
    console.error(`Webhook test ${webhookKey} failed:`, e.message);
    const status = e.response && e.response.status;
    let error;
    if (status === 404) error = 'الرابط غير صالح (404) — امسحه وسوّ ويبهوك جديد';
    else if (status === 401) error = 'التوكن بالرابط غير صحيح (401) — انسخ الرابط من جديد';
    else if (status) error = 'الديسكورد رفض الإرسال (HTTP ' + status + ')';
    else error = e.message || 'فشل الإرسال — تأكد من الاتصال';
    return { ok: false, error };
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

/* ══ جرس أخطاء الخادم — كل 500/انهيار يبعث سببه الحقيقي لويبهوك هادي فوراً ══
   بطلبه: «عم يطلع خطأ 500 شوف ليه» — لوج المنصة لا يُرى من هنا، فمن الآن كل خطأ
   يوصل ديسكورد بالمسار والستاك تروسة = نعرف السبب من أول رسالة بدل التخمين.
   الهدف WH_SERVER_ERRORS: رابط هادي المباشر بملف config/webhooks.js (بطلب 1548700388948054030:
   «خذ ذا الرابط حطه بملف مباشر خلينا نشوف الخطأ») — ويمكن تغييره من لوحة الإدارة أيضاً.
   صفر تكلفة على الطلب: fire-and-forget + مهلة sendWebhook 5s + خنق داخلي
   (نفس الخطأ مرة/دقيقة، و12 جرساً كحد أقصى بالدقيقة حتى لا يُزعج القناة) */
const _alarmState = { lastMsg: {}, lastKindAt: {}, stamps: [] };
/* أدنى فاصل إرسال لكل نوع — انقطاع القاعدة الطويل يجرس مرة/10 دقائق بدل مرة/دقيقة */
const KIND_MIN_MS = { 'db-unreachable': 600000 };
async function sendServerAlarm(kind, err, fields, color) {
  try {
    const now = Date.now();
    /* سقف عام: 12 جرساً بالدقيقة — انفجار الأخطاء ما يغرق القناة */
    _alarmState.stamps = _alarmState.stamps.filter(t => now - t < 60000);
    if (_alarmState.stamps.length >= 12) return;
    const msg = String((err && (err.stack || err.message)) || err || 'unknown').slice(0, 1200);
    /* نفس الخطأ المتكرر: مرة واحدة بالدقيقة فقط */
    if (_alarmState.lastMsg[kind] === msg && now - (_alarmState.lastKindAt[kind] || 0) < (KIND_MIN_MS[kind] || 60000)) return;
    _alarmState.lastMsg[kind] = msg;
    _alarmState.lastKindAt[kind] = now;
    _alarmState.stamps.push(now);
    await sendWebhook('WH_SERVER_ERRORS', {
      username: 'Walton Server Guard',
      title: '🚨 خطأ خادم — ' + kind,
      description: '```\n' + msg.slice(0, 900) + '\n```',
      fields: Array.isArray(fields) ? fields.slice(0, 6) : [],
      color: typeof color === 'number' ? color : 0xef4444,
      footer: 'Walton Family — Server Errors'
    });
  } catch (e) { /* الجرس لا يكسر أبداً */ }
}

module.exports = { sendWebhook, sendTestWebhook, refreshWebhookUrls, isDiscordWebhookUrl, logAdminAction, sendServerAlarm };
