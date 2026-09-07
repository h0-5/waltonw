/**
 * config/permissions.js — التعريف المركزي لكل صلاحيات الموقع
 * كل صلاحية: permission_key => { label, desc }
 * مقسمة حسب الصفحة (group)
 */

const PERMISSION_GROUPS = {
  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — المستخدمون
  // ════════════════════════════════════════════════════════════
  admin_users: {
    label: 'المستخدمون',
    icon: 'fa-users',
    is_site: false,
    permissions: {
      users_view:             { label: 'عرض القائمة',       desc: 'مشاهدة قائمة المستخدمين' },
      users_ban:              { label: 'حظر',              desc: 'حظر مستخدمين من الموقع' },
      users_unban:            { label: 'فك حظر',           desc: 'فك الحظر عن مستخدم' },
      users_unban_all:        { label: 'فك حظر شامل',      desc: 'رفع الحظر عن جميع المحظورين' },
      users_change_role:      { label: 'تغيير الرتبة',     desc: 'ترقية أو تخفيض رتبة مستخدم' },
      users_change_username:  { label: 'تغيير الاسم',      desc: 'تغيير اسم مستخدم' },
      users_view_email:       { label: 'رؤية الإيميل',     desc: 'رؤية إيميلات المستخدمين' },
      users_delete:           { label: 'حذف مستخدم',       desc: 'حذف مستخدم نهائياً' },
      users_view_details:     { label: 'تفاصيل البوت',     desc: 'مشاهدة نقاط ومخزون وإنجازات المستخدم' },
      users_impersonate:      { label: 'انتحال شخصية',     desc: 'الدخول بحساب مستخدم آخر' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — الأخبار
  // ════════════════════════════════════════════════════════════
  admin_news: {
    label: 'الأخبار',
    icon: 'fa-newspaper',
    is_site: false,
    permissions: {
      news_add:    { label: 'إضافة خبر',  desc: 'نشر أخبار جديدة' },
      news_edit:   { label: 'تعديل خبر',  desc: 'تعديل الأخبار الموجودة' },
      news_delete: { label: 'حذف خبر',    desc: 'حذف الأخبار' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — القوانين
  // ════════════════════════════════════════════════════════════
  admin_rules: {
    label: 'القوانين',
    icon: 'fa-gavel',
    is_site: false,
    permissions: {
      rules_view:    { label: 'عرض القوانين',  desc: 'مشاهدة صفحة القوانين' },
      rules_add:    { label: 'إضافة قانون',  desc: 'إضافة قوانين جديدة' },
      rules_edit:   { label: 'تعديل قانون',  desc: 'تعديل القوانين الموجودة' },
      rules_delete: { label: 'حذف قانون',    desc: 'حذف القوانين' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — المنتجات
  // ════════════════════════════════════════════════════════════
  admin_products: {
    label: 'المنتجات',
    icon: 'fa-box',
    is_site: false,
    permissions: {
      products_view:  { label: 'عرض المنتجات',  desc: 'مشاهدة قائمة المنتجات' },
      products_add:    { label: 'إضافة منتج',  desc: 'إضافة منتجات جديدة' },
      products_edit:   { label: 'تعديل منتج',  desc: 'تعديل المنتجات الموجودة' },
      products_delete: { label: 'حذف منتج',    desc: 'حذف المنتجات' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — متجر العائلة
  // ════════════════════════════════════════════════════════════
  admin_family_store: {
    label: 'متجر العائلة',
    icon: 'fa-heart',
    is_site: false,
    permissions: {
      family_store_add_item:        { label: 'إضافة منتج',       desc: 'إضافة منتجات للمتجر' },
      family_store_gift:            { label: 'إهداء منتج',       desc: 'إهداء منتج لمستخدم' },
      family_store_manage_settings: { label: 'إدارة الإعدادات',  desc: 'تعديل إعدادات متجر العائلة' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — طلبات الشراء
  // ════════════════════════════════════════════════════════════
  admin_store_orders: {
    label: 'طلبات الشراء',
    icon: 'fa-shopping-bag',
    is_site: false,
    permissions: {
      store_orders_view:    { label: 'عرض الطلبات',  desc: 'مشاهدة طلبات الشراء' },
      store_orders_approve: { label: 'موافقة',       desc: 'الموافقة على طلب شراء' },
      store_orders_reject:  { label: 'رفض',          desc: 'رفض طلب شراء' },
      store_orders_refund:  { label: 'استرجاع',      desc: 'استرجاع مبلغ طلب' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — الشركة
  // ════════════════════════════════════════════════════════════
  admin_company: {
    label: 'الشركة',
    icon: 'fa-briefcase',
    is_site: false,
    permissions: {
      company_add:    { label: 'إضافة شركة',  desc: 'إضافة شركات جديدة' },
      company_edit:   { label: 'تعديل شركة',  desc: 'تعديل الشركات الموجودة' },
      company_delete: { label: 'حذف شركة',    desc: 'حذف الشركات' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — الممتلكات
  // ════════════════════════════════════════════════════════════
  admin_properties: {
    label: 'الممتلكات',
    icon: 'fa-building',
    is_site: false,
    permissions: {
      properties_add:    { label: 'إضافة ملكية',  desc: 'إضافة ممتلكات جديدة' },
      properties_edit:   { label: 'تعديل ملكية',  desc: 'تعديل الممتلكات الموجودة' },
      properties_delete: { label: 'حذف ملكية',    desc: 'حذف الممتلكات' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — عن الموقع
  // ════════════════════════════════════════════════════════════
  admin_about: {
    label: 'عن الموقع',
    icon: 'fa-info-circle',
    is_site: false,
    permissions: {
      about_edit: { label: 'تعديل المحتوى', desc: 'تعديل صفحة عن الموقع' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — الإذاعة
  // ════════════════════════════════════════════════════════════
  admin_broadcast: {
    label: 'الإذاعة',
    icon: 'fa-bullhorn',
    is_site: false,
    permissions: {
      broadcast_send:               { label: 'إرسال إذاعة',         desc: 'إرسال إذاعة للمستخدمين' },
      broadcast_delete_all:         { label: 'حذف كل الإذاعات',    desc: 'حذف جميع الإذاعات دفعة واحدة' },
      broadcast_banners_delete_all: { label: 'حذف كل البانرات',    desc: 'حذف جميع البانرات' },
      broadcast_banners_end_all:    { label: 'إنهاء كل البانرات',  desc: 'إنهاء جميع البانرات المنتهية' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — تذاكر الدعم
  // ════════════════════════════════════════════════════════════
  admin_tickets: {
    label: 'تذاكر الدعم',
    icon: 'fa-headset',
    is_site: false,
    permissions: {
      tickets_view:              { label: 'عرض التذاكر',     desc: 'مشاهدة قائمة التذاكر' },
      tickets_accept:            { label: 'استلام تذكرة',    desc: 'استلام تذكرة دعم' },
      tickets_close:             { label: 'إغلاق تذكرة',     desc: 'إغلاق تذكرة دعم' },
      tickets_reopen:            { label: 'إعادة فتح',       desc: 'إعادة فتح تذكرة مغلقة' },
      tickets_delete:            { label: 'حذف تذكرة',       desc: 'حذف تذكرة دعم' },
      tickets_reply:             { label: 'رد',              desc: 'الرد على تذكرة دعم' },
      tickets_force_close:       { label: 'إغلاق إجباري',    desc: 'إغلاق تذكرة غير مخصصة لك' },
      tickets_transfer:          { label: 'تحويل',           desc: 'تحويل تذكرة لمشرف آخر' },
      tickets_change_status:     { label: 'تغيير الحالة',    desc: 'تغيير حالة التذكرة' },
      tickets_bulk_delete:       { label: 'حذف مجموعة',      desc: 'حذف عدة تذاكر مرة واحدة' },
      tickets_manage_categories: { label: 'إدارة الأقسام',   desc: 'إضافة وتعديل أقسام التذاكر' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — الشات الإداري
  // ════════════════════════════════════════════════════════════
  admin_staff_chat: {
    label: 'الشات الإداري',
    icon: 'fa-comments',
    is_site: false,
    permissions: {
      staff_chat_view:        { label: 'مشاهدة الشات',    desc: 'رؤية الشات الإداري' },
      staff_chat_send:        { label: 'إرسال رسالة',     desc: 'إرسال رسالة في الشات' },
      staff_chat_delete:      { label: 'حذف رسالة',       desc: 'حذف رسالة من الشات' },
      staff_chat_bulk_delete: { label: 'حذف مجموعة',      desc: 'حذف عدة رسائل مرة واحدة' },
      staff_chat_lock:        { label: 'قفل/فتح الشات',   desc: 'قفل أو فتح الشات الإداري' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — التقديمات
  // ════════════════════════════════════════════════════════════
  admin_applications: {
    label: 'التقديمات',
    icon: 'fa-file-alt',
    is_site: false,
    permissions: {
      apps_view:           { label: 'عرض التقديمات',  desc: 'مشاهدة التقديمات المقدمة' },
      apps_approve:        { label: 'قبول',           desc: 'الموافقة على تقديم' },
      apps_reject:         { label: 'رفض',            desc: 'رفض تقديم' },
      apps_delete:         { label: 'حذف تقديم',      desc: 'حذف تقديم' },
      apps_bulk_delete:    { label: 'حذف مجموعة',     desc: 'حذف عدة تقديمات دفعة' },
      apps_lift_cooldown:  { label: 'فك التهدئة',     desc: 'فك التهدئة عن مستخدم' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — أنواع التقديمات
  // ════════════════════════════════════════════════════════════
  admin_app_types: {
    label: 'أنواع التقديمات',
    icon: 'fa-sliders-h',
    is_site: false,
    permissions: {
      app_types_view:  { label: 'عرض الأنواع',   desc: 'مشاهدة أنواع التقديمات' },
      app_types_add:    { label: 'إضافة نوع',   desc: 'إضافة نوع تقديم جديد' },
      app_types_edit:   { label: 'تعديل نوع',   desc: 'تعديل أنواع التقديمات' },
      app_types_delete: { label: 'حذف نوع',     desc: 'حذف نوع تقديم' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — إعدادات الموقع
  // ════════════════════════════════════════════════════════════
  admin_site_settings: {
    label: 'إعدادات الموقع',
    icon: 'fa-wrench',
    is_site: false,
    permissions: {
      site_settings_view:              { label: 'عرض الإعدادات',     desc: 'مشاهدة إعدادات الموقع' },
      site_settings_edit_general:      { label: 'إعدادات عامة',      desc: 'تعديل الاسم، اللوجو، الخلفية' },
      site_settings_edit_effects:      { label: 'المؤثرات البصرية',  desc: 'تفعيل/تعطيل المؤثرات البصرية' },
      site_settings_edit_accent:       { label: 'ألوان الموقع',      desc: 'تغيير ألوان الموقع والإدارة' },
      site_settings_edit_lockdown:     { label: 'قفل الموقع',        desc: 'إقفال الموقع وإعدادات الصيانة' },
      site_settings_edit_admin:        { label: 'إعدادات الإدارة',   desc: 'خلفية ولون لوحة الإدارة' },
      site_settings_edit_permissions:  { label: 'صلاحيات الإدارة',   desc: 'تحديد من يدخل صفحات الإدارة' },
      site_settings_edit_bot:          { label: 'إعدادات البوت',     desc: 'تعديل رابط البوت الأساسي' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — السجلات
  // ════════════════════════════════════════════════════════════
  admin_logs: {
    label: 'السجلات',
    icon: 'fa-history',
    is_site: false,
    permissions: {
      logs_view:      { label: 'عرض السجلات',  desc: 'مشاهدة سجل الإجراءات' },
      logs_export:    { label: 'تصدير',        desc: 'تصدير السجلات' },
      logs_delete:    { label: 'حذف السجلات',  desc: 'حذف السجلات القديمة' },
      logs_clear_all: { label: 'مسح الكل',     desc: 'مسح جميع السجلات' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — الممتلكات
  // ════════════════════════════════════════════════════════════
  admin_properties: {
    label: 'الممتلكات',
    icon: 'fa-building',
    is_site: false,
    permissions: {
      properties_view:  { label: 'عرض الممتلكات',  desc: 'مشاهدة الممتلكات' },
      properties_add:   { label: 'إضافة ملكية',    desc: 'إضافة ممتلكات جديدة' },
      properties_edit:  { label: 'تعديل ملكية',    desc: 'تعديل الممتلكات الموجودة' },
      properties_delete:{ label: 'حذف ملكية',      desc: 'حذف الممتلكات' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — الشركة
  // ════════════════════════════════════════════════════════════
  admin_company: {
    label: 'الشركة',
    icon: 'fa-briefcase',
    is_site: false,
    permissions: {
      company_view:  { label: 'عرض الشركة',  desc: 'مشاهدة صفحة الشركة' },
      company_add:   { label: 'إضافة خدمة',  desc: 'إضافة خدمات جديدة' },
      company_edit:  { label: 'تعديل خدمة',  desc: 'تعديل الخدمات الموجودة' },
      company_delete:{ label: 'حذف خدمة',    desc: 'حذف الخدمات' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — عن الموقع
  // ════════════════════════════════════════════════════════════
  admin_about: {
    label: 'عن الموقع',
    icon: 'fa-info-circle',
    is_site: false,
    permissions: {
      about_view: { label: 'عرض المحتوى', desc: 'مشاهدة صفحة من نحن' },
      about_edit: { label: 'تعديل المحتوى', desc: 'تعديل صفحة من نحن' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — إدارة الرتب
  // ════════════════════════════════════════════════════════════
  admin_roles_config: {
    label: 'إدارة الرتب',
    icon: 'fa-shield-alt',
    is_site: false,
    permissions: {
      roles_config_view:               { label: 'عرض الصفحة',        desc: 'مشاهدة صفحة إدارة الرتب' },
      roles_config_edit_names:         { label: 'تعديل الأسماء',     desc: 'تغيير أسماء وألوان الرتب' },
      roles_config_edit_permissions:   { label: 'تعديل الصلاحيات',   desc: 'تعديل صلاحيات الرتب' },
      roles_config_manage_roles:       { label: 'إضافة/حذف رتب',     desc: 'إضافة وحذف وإعادة ترتيب الرتب' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // لوحة الإدارة — صفحات إضافية
  // ════════════════════════════════════════════════════════════
  admin_misc: {
    label: 'صفحات إضافية',
    icon: 'fa-ellipsis-h',
    is_site: false,
    permissions: {
      discounts_manage:     { label: 'إدارة الخصومات',        desc: 'إدارة أكواد الخصم' },
      game_points_manage:   { label: 'نقاط الألعاب',          desc: 'إدارة نقاط الألعاب' },
      warnings_view:        { label: 'سجل التحذيرات',         desc: 'مشاهدة سجل التحذيرات' },
      webhooks_manage:      { label: 'إدارة Webhooks',        desc: 'إدارة روابط Webhooks' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // الموقع الرئيسي — المجتمع
  // ════════════════════════════════════════════════════════════
  site_community: {
    label: 'المجتمع',
    icon: 'fa-comments',
    is_site: true,
    permissions: {
      community_view:          { label: 'مشاهدة المجتمع',   desc: 'رؤية صفحة المجتمع' },
      community_post:          { label: 'نشر',              desc: 'نشر منشور في المجتمع' },
      community_edit_post:     { label: 'تعديل منشور',      desc: 'تعديل المنشورات' },
      community_delete_post:   { label: 'حذف منشور',        desc: 'حذف المنشورات' },
      community_pin_post:      { label: 'تثبيت منشور',      desc: 'تثبيت منشور في المجتمع' },
      community_comment:       { label: 'تعليق',            desc: 'التعليق على المنشورات' },
      community_delete_comment:{ label: 'حذف تعليق',        desc: 'حذف التعليقات' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // الموقع الرئيسي — الملف الشخصي
  // ════════════════════════════════════════════════════════════
  site_profile: {
    label: 'الملف الشخصي',
    icon: 'fa-user',
    is_site: true,
    permissions: {
      profile_view:           { label: 'عرض الملف',      desc: 'مشاهدة الملف الشخصي' },
      profile_edit_own:       { label: 'تعديل ملفي',     desc: 'تعديل الملف الشخصي الخاص بي' },
      profile_change_picture: { label: 'تغيير الصورة',   desc: 'تغيير صورة الملف الشخصي' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // الموقع الرئيسي — المتجر
  // ════════════════════════════════════════════════════════════
  site_store: {
    label: 'المتجر',
    icon: 'fa-store',
    is_site: true,
    permissions: {
      store_view: { label: 'عرض المتجر', desc: 'مشاهدة المتجر' },
      store_buy:  { label: 'شراء',       desc: 'شراء منتجات من المتجر' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // الموقع الرئيسي — الألعاب
  // ════════════════════════════════════════════════════════════
  site_games: {
    label: 'الألعاب',
    icon: 'fa-gamepad',
    is_site: true,
    permissions: {
      games_view: { label: 'عرض الألعاب', desc: 'مشاهدة صفحة الألعاب' },
      games_play: { label: 'لعب',         desc: 'المشاركة في الألعاب' },
    },
  },

  // ════════════════════════════════════════════════════════════
  // الموقع الرئيسي — التقديمات
  // ════════════════════════════════════════════════════════════
  site_applications: {
    label: 'التقديمات',
    icon: 'fa-file-alt',
    is_site: true,
    permissions: {
      applications_view:   { label: 'عرض التقديمات', desc: 'مشاهدة أنواع التقديمات' },
      applications_submit: { label: 'تقديم',         desc: 'تقديم طلب انضمام' },
    },
  },
};

/**
 * جلب كل الصلاحيات كـ flat array
 */
function getAllPermissionsFlat() {
  const all = {};
  for (const [groupKey, group] of Object.entries(PERMISSION_GROUPS)) {
    for (const [permKey, perm] of Object.entries(group.permissions)) {
      all[permKey] = { ...perm, groupKey, groupLabel: group.label };
    }
  }
  return all;
}

/**
 * جلب مجموعات صلاحيات الإدارة فقط
 */
function getAdminPermGroups() {
  const admin = {};
  for (const [key, group] of Object.entries(PERMISSION_GROUPS)) {
    if (!group.is_site) admin[key] = group;
  }
  return admin;
}

/**
 * جلب مجموعات صلاحيات الموقع فقط
 */
function getSitePermGroups() {
  const site = {};
  for (const [key, group] of Object.entries(PERMISSION_GROUPS)) {
    if (group.is_site) site[key] = group;
  }
  return site;
}

module.exports = {
  PERMISSION_GROUPS,
  getAllPermissionsFlat,
  getAdminPermGroups,
  getSitePermGroups,
};
