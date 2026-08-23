const rateLimit = require('express-rate-limit');

// Nothing in this app rate-limited anything before this — login, admin
// self-registration, and public form submissions were all open to
// unlimited attempts from a single IP.
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many attempts, please try again in a minute.' },
});

const publicSubmissionLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again in a minute.' },
});

module.exports = { authLimiter, publicSubmissionLimiter };
