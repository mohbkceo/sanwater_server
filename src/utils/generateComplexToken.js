 const jwt = require('jsonwebtoken');
 const crypto = require('crypto');

 const PRIVATE_KEYS = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');;
   
 

 const generateJTI = () => crypto.randomUUID();
 function signToken(payload, options = {}) {
     const basePayload = {
         ...payload,
         iat: Math.floor(Date.now() / 1000),
         jti: generateJTI()
     };
     const signOptions = {
         algorithm: 'RS256',
         expiresIn: options.expiresIn || '15m',
         issuer: 'logix-issuer-system',
         audience: options.audience || 'logix-client',
         subject: payload.uid || 'unknown-user',
         keyid: PRIVATE_KEYS
     };
     return jwt.sign(basePayload, PRIVATE_KEYS, signOptions);
 }
 function generateAccessToken(user) {
     return signToken({
         uid: user._id?.toString() || user.uid,
         email: user.email || "",
         role: user?.role ?? 'user',
         type: 'access',
     }, {
         expiresIn: '15m',
         audience: 'logix-app-access',
     });
 }
 function generateRefreshToken(user, period) {
     return signToken({
         uid: user._id.toString(),
         type: 'refresh',
         role:user?.role,
     }, {
         expiresIn: period || '30d',
         audience: 'sanwater-app-refresh',
     });
 }
 module.exports = {generateAccessToken, generateRefreshToken}

