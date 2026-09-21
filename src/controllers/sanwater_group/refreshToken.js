const { ERRORS, SUCCESS } = require("../../config/messages");
const CostumeExption = require("../../utils/CostumeException");
const {generateAccessToken} = require('../../utils/generateComplexToken');
const errorHandler = require("../../utils/error.middleware");
const jwt =require('jsonwebtoken');
const TokenServices = require("../../services/tokenServices");
const { issueCsrfCookie } = require("../../middlewares/authentication/csrf");


async function refreshTokenValidation(req, res) {
  
  try {

    const refreshToken = req.cookies.refreshToken;
    const verified = new TokenServices(refreshToken)
    const decoded = await verified.verify();
    

    

    if (decoded.type !== 'refresh') {
      throw new CostumeExption(ERRORS.INVALID.msg, ERRORS.INVALID.statusCode)
    }
    const newAccessToken = generateAccessToken({
      uid: decoded.uid,
      role: decoded.role,
      permissions: decoded.permissions || [],
      username: decoded.fullName || decoded.username
    });

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
