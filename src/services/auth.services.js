const bcrypt = require('bcryptjs')
const CostumeExption = require('../middlewares/CostumeException')
const {ERRORS} = require('../config/messages')
const User = require('../models/user.model')
const UserService = require ("./user.services")
const { generateAccessToken, generateRefreshToken } = require('../utils/generateComplexToken')
const { hashPassword } = require('../utils/Password')
const { collect_data } = require('../config/data_controle')
const logixgroup_statistics = require('../models/logixgroupstatistc.model')


class AuthServices { 
    isEmailIdentifier(identifier) {
        return identifier.includes("@")   
    }
    async SignIn(identifier, password){
        identifier = identifier.toLowerCase();
        if(!identifier || !password) throw new CostumeExption(ERRORS.REQUIRED.msg, ERRORS.REQUIRED.statusCode) 
        const user = this.isEmailIdentifier(identifier) ? await User.findOne({ email:identifier }).select('+password') : await User.findOne({ username:identifier }).select('+password')
        
        if(!user) throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode) 
        const isMatch = await bcrypt.compare(password, user.password);
        if(!isMatch) throw new CostumeExption(ERRORS.UNAUTHORIZED.msg, ERRORS.UNAUTHORIZED.statusCode)
        const refreshToken = await generateRefreshToken(user)
        return {
            refreshToken,
            result:{
                user:{
                username:user.username,
                email:user.email,
                fullName:user.fullName,
                uid:user._id,
                role:user.profile_meta?.role
            }}
            }
    }
    async Register(userData, email, user_source, referral_code){
       
        const existing = await User.findOne({ email })
       
        if (existing) {
          throw new CostumeExption(ERRORS.DUPLICATE.msg, ERRORS.DUPLICATE.statusCode)
        }
            
        await collect_data(logixgroup_statistics, user_source, 'register_source_count')
        
        const user = await UserService.creatUser(referral_code, userData);
        const token = await generateAccessToken(user)
        const refreshToken = await generateRefreshToken(user);
        return {
            refreshToken,
            token,
            result:{
                user:{
                    username:user.username,
                    email:user.email,
                    fullName:user.fullName,
                    uid:user._id
                }
            }
        }
    }
  
};
module.exports = new AuthServices();