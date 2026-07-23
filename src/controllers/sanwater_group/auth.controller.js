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
            res.cookie('mellisios_crsf_token', data.accessToken, {
                    httpOnly: true,
                    secure: true,
                    sameSite:'none', 
                    maxAge: 15 * 60 * 1000
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

            // Security: self-registration can never set role or permissions.
            // New accounts are always plain admins with no permissions.
            const sanitizedUserData = { ...userData, role: 'admin', permissions: [] };

            const data = await AuthServices.Register(
                sanitizedUserData,
                sanitizedUserData.email,
                sanitizedUserData?.authKey
            );

            res.cookie('refreshToken', data.refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });
            res.cookie('mellisios_crsf_token', data.token, {
                    httpOnly: true,
                    secure: true,
                    sameSite:'none', 
                    maxAge: 15 * 60 * 1000
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
            res.clearCookie('mellisios_crsf_token');

            return res.status(200).json({
                success: true,
                message: 'Logged out successfully'
            });

        } catch (err) {
            next(err);
        }
    }



module.exports = { signIn, register, logout };