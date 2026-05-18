const bcrypt = require('bcryptjs')
const CostumeExption = require('../utils/CostumeException')
const {ERRORS} = require('../config/messages')
const User = require('../models/user.model')
const UserService = require ("./user.services")
const { generateAccessToken, generateRefreshToken } = require('../utils/generateComplexToken')


class AuthServices { 
    
    async SignIn(identifier, password){
        identifier = identifier.toLowerCase();
        if(!identifier || !password) throw new CostumeExption(ERRORS.REQUIRED.msg, ERRORS.REQUIRED.statusCode) 
       
        const user = await User.findOne({ email:identifier }).select('+password');
        
        if(!user) throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, {
            message: 'user_not_found'
        });
        
        
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
    async Register(userData, email){
       
        const existing = await User.findOne({ email })
       
        if (existing) {
          throw new CostumeExption(ERRORS.DUPLICATE.msg, ERRORS.DUPLICATE.statusCode)
        }
            
        
        const user = await UserService.creatUser(userData);

        if(!user) {
            throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, {
                message: 'faild_to_create_user'
            })
        }
        const token = await generateAccessToken(user)
        const refreshToken = await generateRefreshToken(user);
        return {
            refreshToken,
            token,
            result:{
                user:{
                    email:user.email,
                    fullName:user.fullName,
                    uid:user._id
                }
            }
        }
    }
  
};
module.exports = new AuthServices();