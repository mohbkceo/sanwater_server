const { ERRORS, SUCCESS } = require("../../config/messages");
const CostumeExption = require("../../utils/CostumeException");
const {generateAccessToken} = require('../../utils/generateComplexToken');
const errorHandler = require("../../utils/error.middleware");
const jwt =require('jsonwebtoken');
const TokenServices = require("../../services/tokenServices");
const { issueCsrfCookie } = require("../../middlewares/authentication/csrf");
const User = require('../../models/user.model');


async function refreshTokenValidation(req, res) {
  
  try {

    const refreshToken = req.cookies.refreshToken;
    const verified = new TokenServices(refreshToken)
    const decoded = await verified.verify();
    

    

    if (decoded.type !== 'refresh') {
      throw new CostumeExption(ERRORS.INVALID.msg, ERRORS.INVALID.statusCode)
    }
    const user = await User.findById(decoded.uid).select('role permissions persona email').lean();
    if (!user || !['admin', 'super_admin'].includes(user.role)) throw new CostumeExption(ERRORS.UNAUTHORIZED.msg, ERRORS.UNAUTHORIZED.statusCode);
    const newAccessToken = generateAccessToken(user);

    res.cookie('access_token', newAccessToken, {
            httpOnly: true,
            secure: true,
            sameSite:'none',
            maxAge: 15 * 60 * 1000
    });
    const csrfToken = issueCsrfCookie(res);
    res.status(SUCCESS.RESOURCES_CREATED.statusCode).json({
      msg: SUCCESS.RESOURCES_CREATED.msg,
      csrfToken
    });
  } catch (err) {
   errorHandler(res, err)
  }
}

module.exports = refreshTokenValidation
