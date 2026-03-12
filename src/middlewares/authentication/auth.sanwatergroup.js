const errHandler = require('./error.middleware')
const {ERRORS} = require('../config/messages')
const CostumeException = require('./CostumeException')
const TokenServices = require('../services/tokenServices');




const authSanWater = async (req, res, next) => {
  try { 
    
    const authAccessToken = req.cookies.mellisios_crsf_token;
    const verified = new TokenServices(authAccessToken)
    const decoded = await verified.verify();

    if(decoded.type !== 'access') throw new CostumeException(ERRORS.INVALID.msg, ERRORS.INVALID.statusCode)
    if(decoded.role !== 'admin') throw new CostumeException(ERRORS.UNAUTHORIZED.msg, ERRORS.UNAUTHORIZED.statusCode)
    
    req.user = decoded;
    next();
  
  } catch (err) {
    if(err.message === 'jwt expired' || err.message === 'jwt maloformd') {err.statusCode = 401}
    errHandler(res, err);
  }
};

module.exports = authSanWater;
