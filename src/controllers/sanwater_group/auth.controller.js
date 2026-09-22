const AuthServices = require('../../services/auth.services')
const { issueCsrfCookie } = require('../../middlewares/authentication/csrf');
const { logActivity } = require('../../utils/logger');

    async function signIn(req, res, next) {
        try {
            const { identifier, password } = req.body;

            const data = await AuthServices.SignIn(identifier, password);
            req.user = { uid: data.result.user.uid };
            await logActivity(req, 'LOGIN', 'User', data.result.user.uid, {
                summary: `Admin signed in: ${data.result.user.fullName || data.result.user.email}`,
                entity: { id: data.result.user.uid, name: data.result.user.fullName, email: data.result.user.email },
                changedFields: [], changes: [],
            });

            res.cookie('refreshToken', data.refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });
            res.cookie('access_token', data.accessToken, {
                    httpOnly: true,
                    secure: true,
                    sameSite:'none',
                    maxAge: 15 * 60 * 1000
            });
            const csrfToken = issueCsrfCookie(res);

            // Tokens are only ever delivered via httpOnly cookies — never in
            // the response body, so a captured network log or XSS-read JS
            // response can't be used to steal a bearer token.
            return res.status(200).json({
                success: true,
                result: data.result,
                csrfToken
            });

        } catch (err) {
            next(err);
        }
    }

    // Only reachable by an authenticated admin with the users.create
    // permission (see user.routes.js) — this creates a *new* admin account,
    // it does not authenticate the caller's own session, so no cookies are
    // set here for the new account.
    async function register(req, res, next) {
        try {
            const { userData } = req.body;

            // Security: self-registration can never set role or permissions.
            // New accounts are always plain admins with no permissions; only
            // a super_admin can grant permissions afterwards via User Management.
            const sanitizedUserData = { ...userData, role: 'admin', permissions: [] };

            const data = await AuthServices.Register(
                sanitizedUserData,
                sanitizedUserData.email
            );

            await logActivity(req, 'CREATE', 'User', data.result.user.uid, {
                createdEmail: data.result.user.email,
                createdBy: req.user.uid,
            });

            return res.status(201).json({
                success: true,
                result: data.result
            });

        } catch (err) {
            next(err);
        }
    }


    async function logout(req, res, next) {
        try {
            res.clearCookie('refreshToken');
            res.clearCookie('access_token');
            res.clearCookie('csrf_token');

            return res.status(200).json({
                success: true,
                message: 'Logged out successfully'
            });

        } catch (err) {
            next(err);
        }
    }



module.exports = { signIn, register, logout };
