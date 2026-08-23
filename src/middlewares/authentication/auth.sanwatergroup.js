const errHandler = require('../../utils/error.middleware')
const {ERRORS} = require('../../config/messages')
const CostumeException = require('../../utils/CostumeException')
const TokenServices = require('../../services/tokenServices');
const { csrfProtection } = require('./csrf');




const authSanWater = async (req, res, next) => {
  try {

    const authAccessToken = req.cookies.access_token;
    const verified = new TokenServices(authAccessToken)
    const decoded = await verified.verify();

    if(decoded.type !== 'access') throw new CostumeException(ERRORS.INVALID.msg, ERRORS.INVALID.statusCode)
    const roles = ['super_admin', 'admin'];

    if (!roles.includes(decoded.role)) {
      throw new CostumeException(ERRORS.UNAUTHORIZED.msg, ERRORS.UNAUTHORIZED.statusCode);
    }

    req.user = decoded;

    // CSRF check for every state-changing request made under this
    // cookie-based session (see ./csrf.js for why this is needed).
    return csrfProtection(req, res, next);

  } catch (err) {
    if(err.message === 'jwt expired' || err.message === 'jwt maloformd') {err.statusCode = 401}
    errHandler(res, err);
  }
};

module.exports = authSanWater;
