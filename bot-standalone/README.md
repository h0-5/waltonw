# Walton Family Discord Bot — Standalone

بوت ديسكورد مستقل يشتغل بقاعدة بيانات الموقع.

## التثبيت

```bash
cd bot-standalone
npm install
```

## الإعداد

1. انسخ `.env.example` إلى `.env`
2. عدّل القيم:

```
BOT_TOKEN=MTxxxxxxxxxxxxxxxxxxxxxxx     # توكن البوت من Discord Developer Portal
DB_HOST=mysql.railway.internal          # أو IP قاعدة البيانات
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=railway
GUILD_ID=1476232552564916387           # رقم السيرفر
LOG_CHANNEL_ID=                        # قناة السجلات (اختياري)
WELCOME_CHANNEL_ID=                    # قناة الترحيب (اختياري)
PREFIX=!                               # بادئة الأوامر
```

## التشغيل

```bash
npm start
```

## الأوامر

| الأمر | الوصف | الصلاحية |
|-------|-------|----------|
| `!help` | عرض كل الأوامر | — |
| `!ban @user [سبب]` | حظر عضو + ي syncing مع الموقع | BanMembers |
| `!unban @user` | فك حظر + ي syncing مع الموقع | BanMembers |
| `!kick @user [سبب]` | طرد عضو | KickMembers |
| `!mute @user [دقائق]` | كتم | ModerateMembers |
| `!warn @user [سبب]` | تحذير + يحفظ في قاعدة البيانات | ModerateMembers |
| `!whois @user` | معلومات عضو | — |
| `!server` | معلومات السيرفر | — |
| `!avatar @user` | صورة العضو | — |
| `!ping` | سرعة البوت | — |
| `!roles` | رتب السيرفر | — |
| `!members` | عدد الأعضاء | — |

## ملاحظات مهمة

- البوت بيعمل **sync تلقائي** مع الموقع:
  - لو حد اتحظر من البوت → يتحظر في الموقع كمان
  - لو حد اتحظر من الموقع → لازم يتحظر من البوت كمان (أو من الموقع)
  - لما حد ينضم للسيرفر → `in_guild` بيتفعل في الموقع
  - لما حد يخرج → `in_guild` بيتنفش

- التحديث التلقائي: البوت بيبعت `setActivity('Walton Family')` كـ status

## التشغيل على Railway (كـ worker)

لو عايز تشغله على Railway كـ worker منفصل:
1. ارفع مجلد `bot-standalone` على repo منفصل
2. Railway هتكتشف `package.json` وتشغل `npm start`
3. حط المتغيرات في Environment Variables
