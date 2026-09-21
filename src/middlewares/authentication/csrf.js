const crypto = require('crypto');

// Double-submit CSRF protection.
//
// The access-token cookie has to be `SameSite=None` because the client
// (sanwater-dz.com / the Vercel preview) and the API (api.sanwater-dz.com)
// are different origins — that turns off the browser's own SameSite CSRF
// mitigation for every cookie-authenticated request. To compensate, on
// login/refresh we also set a second, JS-readable cookie holding a random
// token; the client must echo it back in the `X-CSRF-Token` header on any
// state-changing request. A cross-site attacker can make the browser send
// the *cookie* automatically, but same-origin policy stops them reading its
// value to put it in the header, so the two won't match.
const CSRF_COOKIE = 'csrf_token';

function issueCsrfCookie(res, maxAge) {
  const token = crypto.randomUUID();
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: true,
    sameSite: 'none',
    maxAge: maxAge || 15 * 60 * 1000,
  });
  return token;
}

// The CSRF cookie belongs to the API host, so JavaScript running on the
// production frontend host cannot read it through document.cookie. Expose the
// same non-secret nonce in a no-store response; the browser will keep the
// matching cookie on the API host and the client can echo the response value in
// the request header.
function getCsrfToken(req, res) {
  const csrfToken = issueCsrfCookie(res);
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ success: true, csrfToken });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ success: false, message: 'Invalid or missing CSRF token' });
  }
  next();
}

module.exports = { issueCsrfCookie, getCsrfToken, csrfProtection, CSRF_COOKIE };
