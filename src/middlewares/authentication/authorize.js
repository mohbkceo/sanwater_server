const CostumeException = require('../../utils/CostumeException');
const { ERRORS } = require('../../config/messages');

const roleHierarchy = {
  'super_admin': 3,
  'admin': 2,
  'manager': 1
};

const authorize = (minRole, isAction=false) => {
  return (req, res, next) => {
    const userRole = req.user.role;
    
    if (!roleHierarchy[userRole] || roleHierarchy[userRole] < roleHierarchy[minRole] ) {
      throw new CostumeException(ERRORS.UNAUTHORIZED.msg, ERRORS.UNAUTHORIZED.statusCode);
    }

   
    
    next();
  };
};

module.exports = authorize;
