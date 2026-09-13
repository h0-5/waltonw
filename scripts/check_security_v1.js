#!/usr/bin/env node
/* ═══ فحص أمني ولوثي — security audit v1 (رسالة هادي 1548824748757360671) ═══
   «ابي تبحث عن اي ثغرات امنية وتاكد كويس انك درست اكواد كلها
    تاكد ان نظام الرتب والصلاحيات في باك اند مب مجرد منظر
    وابي تلغي اقتراح تعبئة التلقائية لما تجاوب ع شي سؤال»
   تأكيدات ثابتة على كل إصلاح أمني انطبق — الفشل يوقف النشر */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, failn = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { failn++; console.log('  ❌ ' + name); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

console.log('\n═══ 1) لا توكنات/أسرار مكتوبة بكود المصدر ═══');
const botIdx = read('bot/index.js');
ok('bot/index.js بلا توكن مضمن (MTU…)', !/MTU[A-Za-z0-9_\-]{20,}/.test(botIdx));
ok('bot/index.js يقرأ BOT_TOKEN من البيئة فقط', botIdx.includes("process.env.BOT_TOKEN || ''"));
const secrets = read('config/secrets.js');
ok('config/secrets.js بلا walton_secret_2026', !secrets.includes('walton_secret_2026'));
ok('config/secrets.js بلا walton_bot_webhook_2025', !secrets.includes('walton_bot_webhook_2025'));
ok('config/secrets.js بلا walton_cron_secret_2026', !secrets.includes('walton_cron_secret_2026'));
const sessionCfg = read('config/session.js');
ok('جلسة: لا سر ثابت walton_family_secret', !sessionCfg.includes('walton_family_secret'));
ok('جلسة: سر عشوائي randomBytes عند غياب البيئة', sessionCfg.includes("randomBytes(32)"));

console.log('\n═══ 2) التسلسل الإداري مفروض بالباك اند ═══');
const adm = read('routes/api/admin.js');
ok('حارس التسلسل assertTargetBelowActor موجود', adm.includes('async function assertTargetBelowActor'));
ok('حارس التسلسل منفذ على /users/update', (adm.match(/assertTargetBelowActor\(req\.user, user_id\)/g) || []).length >= 2);
ok('حارس التسلسل منفذ على POST /users/:id/ban', adm.includes('assertTargetBelowActor(req.user, req.params.id)'));
ok('حارس التسلسل منفذ على PATCH /users/:id', /req\.user\.id !== targetId[\s\S]{0,120}assertTargetBelowActor/.test(adm));
ok('رفع is_admin_role للمالك حصراً (PUT roles)', adm.includes('isOwnerActor ? (is_admin_role || 0)'));
const noLeak = adm.match(/res\.status\(500\)\.json\(\{[^}]*error: e\.message/g) || [];
ok('api/admin.js صفر تسريب e.message للعميل (' + noLeak.length + ' = 0)', noLeak.length === 0);
ok('api/admin.js: رسالة خطأ عامة fail()', adm.includes('function fail(res, e)'));

console.log('\n═══ 3) الرتب والصلاحيات ليست مجرد واجهة (فحص الباك اند) ═══');
const authMw = read('middleware/auth.js');
['isAuthenticated', 'isInGuild', 'isAdmin', 'checkPermission', 'checkPageAccess', 'checkCanBan'].forEach(fn => {
  ok('middleware/auth.js يصدّر ' + fn, authMw.includes('const ' + fn + ' =') || authMw.includes('const ' + fn + ' = ('));
});
const admPage = read('routes/admin.js');
ok('كل صفحات /admin خلف isAdmin (router.use)', admPage.includes('router.use(isAdmin'));
const permGuards = (admPage.match(/checkPermission\('/g) || []).length;
ok('صفحات /admin محمية بمفتاح صلاحية لكل راوت (≥20 حارس، فعلياً ' + permGuards + ')', permGuards >= 20);
const admApi = adm;
const apiGuards = (admApi.match(/checkPermission\('/g) || []).length;
ok('واجهات /api/admin محمية بكل راوت (≥40 حارس، فعلياً ' + apiGuards + ')', apiGuards >= 40);
ok('فحص وصول الصفحات fail-closed (عطب القاعدة = رفض)', authMw.includes('.catch(() => denyAccess(res));') && !authMw.includes('.catch(() => next());'));

console.log('\n═══ 4) XSS مخزن ═══');
const tickets = read('views/admin/tickets.ejs');
ok('تذاكر الإدارة: esc() على نص المستخدم', tickets.includes('esc(t.message)') && tickets.includes('esc(r.message)') && tickets.includes('esc(t.name || t.subject)'));
const company = read('views/pages/company.ejs');
ok('أيقونات الشركة تُهرَّب قبل HTML', company.includes('iconSafe = escH(svcIcon)'));
ok('icon يُنظّف عند الحفظ (بلا وسوم)', adm.includes("replace(/[<>\"'`]/g, '')"));
ok('رفع الصور بامتداد موثوق فقط (safeImgExt)', (adm.match(/safeImgExt\(file\)/g) || []).length >= 4);

console.log('\n═══ 5) إلغاء التعبئة التلقائية بنماذج الأسئلة ═══');
ok('نموذج التقديم autocomplete="off"', read('views/pages/application-form.ejs').includes('<form id="appForm" autocomplete="off">'));
ok('نموذج الدعم autocomplete="off"', read('views/pages/support.ejs').includes('<form id="supportForm" class="support-form" autocomplete="off">'));
ok('نموذج طلب خدمة الشركة autocomplete="off"', company.includes('id="svcForm" class="cy-svc-form" style="display:none" autocomplete="off"'));

console.log('\n═══ 6) واجهات أخرى بلا تسريب أخطاء ═══');
const botApi = read('routes/api/bot.js');
ok('api/bot.js صفر e.message للعميل', !/res\.status\(500\)\.json\(\{[^}]*error: e\.message/.test(botApi));
const notif = read('routes/api/notifications.js');
ok('api/notifications.js صفر e.message للعميل', !/res\.status\(500\)\.json\(\{[^}]*error: e\.message/.test(notif));

console.log('\n═══ 7) التدقيق الثاني — سد مسارات التصعيد والتجاوز ═══');
/* ① الأدوار الجانبية والنقاط لا تُعدَّل على الذات (تصعيد صلاحيات عبر PATCH نفسه) */
ok('PATCH /users/:id: sideRoles/points محظورة على الذات', adm.includes('sideRoles !== undefined || points !== undefined'));
/* ② فحص التسلسل على الرتبة الجديدة من القاعدة (rankOfRole) لا من الخريطة الثابتة (غير المعروفة كانت 99) */
ok('PATCH /users/:id: التسلسل بحساب rankOfRole لا getRank الثابتة', /const myRank = await rankOfRole\(req\.user\.role\);/.test(adm) && /const targetNewRank = await rankOfRole\(role\);/.test(adm));
/* ③ فك الحظر بحارس التسلسل أيضاً — لا فك حظر رتبة أعلى (assertTargetBelowActor × 6: update/ban/PATCH/ban:id/unban/unban:id) */
const guardCount = (adm.match(/assertTargetBelowActor\(/g) || []).length;
ok('حارس التسلسل على 6 مسارات بماها فكّا الحظر (فعلياً ' + guardCount + ')', guardCount >= 6);
ok('مسار /users/:id/unban مكرر انشال (نسخة ميتة واحدة فقط)', (adm.match(/router\.post\('\/users\/:id\/unban'/g) || []).length === 1);
/* ④ مكافأة التقديم site_role: لا owner أبداً + فحص التسلسل عند الضبط وعند القبول */
ok('site_role=owner مرفوض بإعدادات أنواع التقديم', adm.includes('لا يمكن ضبط رتبة المكافأة إلى المالك'));
ok('قبول التقديم يفحص رتبة المكافأة قبل منحها', adm.includes('const grantRank = await rankOfRole(grantRole);') && adm.includes("grantRole === 'owner'"));
/* ⑤ حذف الملفات: safeUnlinkUpload فقط — لا unlink مباشر بمسار من القاعدة (path traversal) */
ok('safeUnlinkUpload معرّف ومستخدم (≥4 مواضع)', (adm.match(/safeUnlinkUpload\(/g) || []).length >= 5);
ok('لا unlinkSync مباشر بمسار مركب من قيمة مخزنة', !adm.includes('unlinkSync(fp)'));
/* ⑥ رفع ملفات الشركة بامتداد صورة موثوق فقط (كان .html/.svg → XSS مخزّن بنطاق الموقع) */
const companyApi = read('routes/api/company.js');
ok('رفع طلبات الشركة: امتداد بقياقة صورة', companyApi.includes(".includes(rawExt)"));
/* ⑦ المحظور ما يكتب/يشتري/يغيّر اسمه عبر الـAPI (كان يتجاوز شاشة الحظر) */
['community', 'store', 'profile'].forEach(n => {
  ok('api/' + n + '.js: المحظور مرفوض (is_banned)', read('routes/api/' + n + '.js').includes('req.user.is_banned'));
});
/* ⑧ جلسة ديسكورد بلا توكن (كان يُخزّن accessToken ولا يقرأه كود) */
const authRoutes = read('routes/auth.js');
ok('routes/auth.js: لا تخزين accessToken بالجلسة', !authRoutes.includes('req.session.accessToken'));
/* ⑨ middleware/roles.js fail-closed (رتبة غير معروفة كانت تفتح الباب للجميع) */
ok('middleware/roles.js: minRole غير معروف = رفض', read('middleware/roles.js').includes('requiredRank === undefined'));
/* ⑩ كاش الصفحات: GET فقط يُخزَّن + سقف إدخالات + مفتاح مقصوص + الإبطال للمصدّقين فقط */
const pageCache = read('middleware/page-cache.js');
ok('كاش الصفحات: تخزين GET فقط (لا تلوث رد POST)', pageCache.includes("req.method === 'GET'"));
ok('كاش الصفحات: سقف 600 إدخال ضد cache-bombing', pageCache.includes('pageCache.size < 600'));
const appJs = read('app.js');
ok('إبطال كاش الصفحات للطلبات المصدّقة فقط', appJs.includes('if (req.user) invalidatePageCache(null);'));
/* ⑪ Socket.IO: هوية الحضور من الجلسة لا من العميل (كان ينتحل باسم أي عضو) */
const serverJs = read('server.js');
ok('Socket.IO: هوية المصافحة من كوكي الجلسة', serverJs.includes('socketUserFromHandshake') && serverJs.includes('timingSafeEqual'));
ok('Socket.IO: user:online يتجاهل ما يرسله العميل', serverJs.includes("socket.on('user:online', () => {"));
ok('مخزن الجلسات متاح لفحص المصافحة', read('config/session.js').includes('cachedSessionStore.sessionStore = sessionStore'));
/* ⑫ التعبئة التلقائية: كل حقول نماذج الأسئلة + بقية النماذج */
const appForm = read('views/pages/application-form.ejs');
const autoOff = (appForm.match(/autocomplete="off"/g) || []).length;
ok('نموذج التقديم: autocomplete="off" على الحقول كلها (' + autoOff + ' ≥ 12)', autoOff >= 12);
ok('نموذج الشطب autocomplete="off"', read('views/pages/checkout.ejs').includes('<form id="checkoutForm" autocomplete="off">'));
ok('نموذج الملف الشخصي autocomplete="off"', read('views/pages/profile.ejs').includes('<form id="profileForm" class="pfw-form" autocomplete="off">'));
ok('نموذج دردشة المجتمع autocomplete="off"', read('views/pages/community.ejs').includes('<form id="chatForm" class="chat-form" autocomplete="off"'));

console.log('\n═══ النتيجة ═══');
console.log('نجاح: ' + pass + ' — فشل: ' + failn);
process.exit(failn ? 1 : 0);
