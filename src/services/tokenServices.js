
const jwt = require('jsonwebtoken');
const {ERRORS} = require('../config/messages')
const CostumeException = require('../middlewares/CostumeException')



class TokenServices {
    constructor(token){
        this.token = token;
        this.publicKey = process.env.PUBLIC_KEY.replace(/\\n/g, '\n');
    }

    async verify(){
        if(!this.token){
           throw new CostumeException(ERRORS.UNAUTHORIZED.msg, ERRORS.UNAUTHORIZED.statusCode)
        }
        try {
             const decoded = await jwt.verify(this.token, this.publicKey, { algorithms: ['RS256']});
             return decoded;
        } catch (error) {
            throw new CostumeException(
                error?.message,
                ERRORS.UNAUTHORIZED.statusCode
            );
        }
    }
}


module.exports = TokenServices;

