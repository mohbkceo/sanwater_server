const AuthServices = require('../../services/auth.services')
const { generateAccessToken } = require('../../utils/generateComplexToken');
const jwt = require('jsonwebtoken');


    async function signIn(req, res, next) {
        try {
            const { identifier, password } = req.body;

            const data = await AuthServices.SignIn(identifier, password);

            res.cookie('refreshToken', data.refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000 
            });

            return res.status(200).json({
                success: true,
                ...data
            });

        } catch (err) {
            next(err);
        }
    }

    async function register(req, res, next) {
        try {
            const { userData } = req.body;
            

            const data = await AuthServices.Register(
                userData,
                userData.email,
                userData?.authKey
            );

            
            res.cookie('refreshToken', data.refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            return res.status(201).json({
                success: true,
                ...data
            });

        } catch (err) {
            next(err);
        }
    }

    async function logout(req, res, next) {
        try {
            res.clearCookie('refreshToken');

            return res.status(200).json({
                success: true,
                message: 'Logged out successfully'
            });

        } catch (err) {
            next(err);
        }
    }



module.exports = { signIn, register, logout };