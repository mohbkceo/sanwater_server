const bcrypt = require('bcryptjs')
const CostumeExption = require('../utils/CostumeException')
const {ERRORS} = require('../config/messages')
const User = require('../models/user.model')
const UserService = require ("./user.services")
const { generateAccessToken, generateRefreshToken } = require('../utils/generateComplexToken')
const { logActivity } = require('../utils/logger')


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
        
        // Note: logActivity needs req, but AuthServices is a class. 
        // We'll log in the controller instead for auth events to avoid passing req everywhere.
        
        const refreshToken = await generateRefreshToken(user)
        const accessToken = await generateAccessToken(user)
        return {
            refreshToken,
            accessToken,
            result:{
                user:{
                username:user.fullName,
                email:user.email,
                fullName:user.fullName,
                uid:user._id,
                role:user.role,
                permissions: user.permissions || [],
                authKey: user?.authKey
            }}
            }
    }
    // `register` is now only reachable by an already-authenticated admin with
    // the users.create permission (see user.routes.js), so the old public
    // "authKey" invite gate is gone. It used to accept ANY existing user's
    // plain MongoDB _id as a valid key (`{$or: [{_id: authKey}, ...]}`),
    // which was a real auth-bypass path — removed entirely rather than patched.
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

        // No tokens/cookies here: the caller is the *creating* admin, not the
        // new account, so we must not log the creator's browser into the new
        // account (that would silently swap whose session the cookies belong to).
        return {
            result:{
                user:{
                    email:user.email,
                    fullName:user.fullName,
                    uid:user._id,
                    role:user?.role,
                    permissions: user.permissions || []
                }
            }
        }
    }
  
};
module.exports = new AuthServices();