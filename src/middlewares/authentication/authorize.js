const CostumeException = require('../../utils/CostumeException');
const { ERRORS } = require('../../config/messages');
const { ROLES } = require('../../config/permissions');
const ANALYTICS_LEGACY_READ = new Set([
  'analytics.overview.view', 'analytics.marketing.view', 'analytics.products.view',
  'analytics.sales.view', 'analytics.hiring.view', 'analytics.content.view',
]);
function grants(userPermissions, permission) {
  return userPermissions.includes(permission) ||
    (process.env.ANALYTICS_LEGACY_READ_FALLBACK !== 'false' && ANALYTICS_LEGACY_READ.has(permission) && userPermissions.includes('analytics.view'));
}

/**
 * Middleware to authorize user based on permissions.
 * @param {string|string[]} requiredPermissions - Single permission or array of permissions.
 * @param {boolean} requireAll - If true, user must have all required permissions. Default is false (any one).
 */
const authorize = (requiredPermissions = [], requireAll = false) => {
  return (req, res, next) => {
    const user = req.user;

    if (!user) {
      throw new CostumeException(ERRORS.UNAUTHORIZED.msg, ERRORS.UNAUTHORIZED.statusCode);
    }

    // Super admin bypasses all permission checks
    if (user.role === ROLES.SUPER_ADMIN) {
      return next();
    }

    // If no specific permissions required, just being an admin is enough (since only super_admin and admin exist)
    if (!requiredPermissions || (Array.isArray(requiredPermissions) && requiredPermissions.length === 0)) {
      return next();
    }

    const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
    const userPermissions = user.permissions || [];

    const hasPermission = requireAll
      ? permissions.every(p => grants(userPermissions, p))
      : permissions.some(p => grants(userPermissions, p));

    if (!hasPermission) {
      throw new CostumeException(ERRORS.FORBIDDEN.msg, ERRORS.FORBIDDEN.statusCode);
    }

    next();
  };
};

module.exports = authorize;
module.exports.grants = grants;
