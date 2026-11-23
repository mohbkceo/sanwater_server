const PERMISSIONS = {
  ECOMMERCE: {
    VIEW: 'ecommerce.view', VIEW_ALL: 'ecommerce.viewAll', CREATE: 'ecommerce.create', EDIT: 'ecommerce.edit',
    CONFIRM: 'ecommerce.confirm', CANCEL: 'ecommerce.cancel', FULFILL: 'ecommerce.fulfill', SHIP: 'ecommerce.ship',
    ASSIGN: 'ecommerce.assign', ISSUE: 'ecommerce.issue', RESOLVE: 'ecommerce.resolve', PAYMENT: 'ecommerce.payment',
    INVENTORY: 'ecommerce.inventory', IMPORT: 'ecommerce.import', CUSTOMERS: 'ecommerce.customers',
    REPORTS: 'ecommerce.reports', OVERRIDE_PRICE: 'ecommerce.overridePrice',
  },
  ANALYTICS: {
    VIEW: 'analytics.view',
    MANAGE: 'analytics.manage',
    OVERVIEW: 'analytics.overview.view',
    MARKETING: 'analytics.marketing.view',
    PRODUCTS: 'analytics.products.view',
    SALES: 'analytics.sales.view',
    HIRING: 'analytics.hiring.view',
    CONTENT: 'analytics.content.view',
    EXPLORE: 'analytics.explore',
    EXPORT: 'analytics.export',
    CONFIGURE: 'analytics.configure',
  },
  PRODUCTS: {
    VIEW: 'products.view',
    MANAGE: 'products.manage',
  },
  QUOTATIONS: {
    VIEW: 'quotations.view',
    MANAGE: 'quotations.manage',
  },
  LEADS: {
    VIEW: 'leads.view',
    MANAGE: 'leads.manage',
  },
  HIRING: {
    VIEW: 'hiring.view',
    MANAGE: 'hiring.manage',
  },
  SUBMISSIONS: {
    VIEW: 'submissions.view',
    MANAGE: 'submissions.manage',
  },
  CONTENT: {
    VIEW: 'content.view',
    MANAGE: 'content.manage',
  },
  LOGS: {
    VIEW: 'logs.view',
  },
  USERS: {
    VIEW: 'users.view',
    CREATE: 'users.create',
    DELETE: 'users.delete',
    MANAGE_PERMISSIONS: 'users.manage_permissions',
  },
};

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
};

// All available permissions as a flat array for validation
const ALL_PERMISSIONS = Object.values(PERMISSIONS).flatMap(group => Object.values(group));

module.exports = {
  PERMISSIONS,
  ROLES,
  ALL_PERMISSIONS,
};
