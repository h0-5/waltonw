require('dotenv').config();

module.exports = {
  WH_PROXY: process.env.WH_PROXY || '',
  WH_ADMIN_LOG: process.env.WH_ADMIN_LOG || '',
  WH_APPLICATIONS: process.env.WH_APPLICATIONS || '',
  WH_APP_NOTIFY: process.env.WH_APP_NOTIFY || '',
  WH_FAMILY_STORE: process.env.WH_FAMILY_STORE || '',
  WH_PRODUCTS: process.env.WH_PRODUCTS || '',
  WH_SUPPORT_LOG: process.env.WH_SUPPORT_LOG || '',
  WH_SUPPORT_NOTIFY: process.env.WH_SUPPORT_NOTIFY || '',
  WH_CONTENT: process.env.WH_CONTENT || '',
  WH_NEW_ACCOUNT: process.env.WH_NEW_ACCOUNT || '',
  WH_STAFF_CHAT: process.env.WH_STAFF_CHAT || '',
  WH_ROLE_CHANGE: process.env.WH_ROLE_CHANGE || '',
  WH_STAFF_PERMS: process.env.WH_STAFF_PERMS || '',
  WH_COMMUNITY: process.env.WH_COMMUNITY || '',
  WH_ABOUT: process.env.WH_ABOUT || '',
  WH_APP_SETTINGS: process.env.WH_APP_SETTINGS || '',
  WH_BROADCAST: process.env.WH_BROADCAST || '',
  WH_COMPANY: process.env.WH_COMPANY || '',
  WH_STAFF: process.env.WH_STAFF || '',
  WH_SHOP: process.env.WH_SHOP || ''
};
