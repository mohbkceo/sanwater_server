const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CSRF_COOKIE,
  csrfProtection,
  getCsrfToken,
  issueCsrfCookie,
} = require('../src/middlewares/authentication/csrf');

function responseDouble() {
  return {
    cookies: [],
    headers: {},
    statusCode: null,
    body: null,
    cookie(name, value, options) {
      this.cookies.push({ name, value, options });
    },
    set(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('CSRF token endpoint returns the token stored on the API host', () => {
  const res = responseDouble();
  getCsrfToken({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.cookies[0].name, CSRF_COOKIE);
  assert.equal(res.cookies[0].value, res.body.csrfToken);
  assert.equal(res.cookies[0].options.httpOnly, false);
  assert.equal(res.cookies[0].options.sameSite, 'none');
});

test('issueCsrfCookie generates a fresh token for each response', () => {
  const first = responseDouble();
  const second = responseDouble();
  assert.notEqual(issueCsrfCookie(first), issueCsrfCookie(second));
});

test('CSRF middleware accepts matching cookie and header tokens', () => {
  let passed = false;
  csrfProtection(
    { method: 'POST', cookies: { [CSRF_COOKIE]: 'match' }, headers: { 'x-csrf-token': 'match' } },
    responseDouble(),
    () => { passed = true; },
  );
  assert.equal(passed, true);
});

test('CSRF middleware rejects missing or mismatched tokens', () => {
  for (const request of [
    { method: 'POST', cookies: {}, headers: {} },
    { method: 'PATCH', cookies: { [CSRF_COOKIE]: 'cookie' }, headers: { 'x-csrf-token': 'header' } },
  ]) {
    const res = responseDouble();
    csrfProtection(request, res, () => assert.fail('request should have been rejected'));
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, 'Invalid or missing CSRF token');
  }
});
