const test = require('node:test');
const assert = require('node:assert/strict');
const authorize = require('../src/middlewares/authentication/authorize');
const { PERMISSIONS } = require('../src/config/permissions');
const leadSchemas = require('../src/middlewares/validators/schemas/leadValidator');
const newsSchemas = require('../src/middlewares/validators/schemas/newsValidator');
const sanitizeNewsHtml = require('../src/utils/sanitizeNewsHtml');

const validLead = {
  fullName: 'Ahmed Test',
  phone: '0550000000',
  email: 'ahmed@example.com',
  wilaya: 'Alger',
  productIdentifier: 'SW-100',
  quantity: 2,
  attribution: { source: 'google', medium: 'cpc' },
};

test('public lead accepts customer fields and rejects admin-controlled fields', () => {
  assert.equal(leadSchemas.createLeadSchema.validate(validLead).error, undefined);
  assert.ok(leadSchemas.createLeadSchema.validate({ ...validLead, status: 'won', estimatedValue: 1 }).error);
});

test('lead lifecycle validates won and lost requirements', () => {
  assert.ok(leadSchemas.updateLeadStatusSchema.validate({ status: 'lost' }).error);
  assert.equal(leadSchemas.updateLeadStatusSchema.validate({ status: 'lost', lostReason: 'price' }).error, undefined);
  assert.ok(leadSchemas.updateLeadStatusSchema.validate({ status: 'won' }).error);
  assert.equal(leadSchemas.updateLeadStatusSchema.validate({ status: 'won', finalValue: 1000 }).error, undefined);
});

test('news scheduling requires a future timestamp and autosave cannot publish', () => {
  const article = { title: 'A valid title', content: '<p>Body</p>', status: 'scheduled' };
  assert.ok(newsSchemas.newsSchema.validate(article).error);
  assert.ok(newsSchemas.newsSchema.validate({ ...article, publishedAt: '2020-01-01T00:00:00.000Z' }).error);
  assert.equal(newsSchemas.newsSchema.validate({ ...article, publishedAt: '2099-01-01T00:00:00.000Z' }).error, undefined);
  assert.ok(newsSchemas.autosaveNewsSchema.validate({ title: 'Draft update', status: 'published' }).error);
});

test('rich article HTML removes executable content', () => {
  const clean = sanitizeNewsHtml('<h2>Safe</h2><script>alert(1)</script><img src="x" onerror="alert(2)">');
  assert.match(clean, /<h2>Safe<\/h2>/);
  assert.doesNotMatch(clean, /script|onerror/i);
});

test('lead view permission cannot mutate while lead manage can', () => {
  const manageOnly = authorize(PERMISSIONS.LEADS.MANAGE);
  assert.throws(() => manageOnly({ user: { role: 'admin', permissions: [PERMISSIONS.LEADS.VIEW] } }, {}, () => {}));
  let allowed = false;
  manageOnly({ user: { role: 'admin', permissions: [PERMISSIONS.LEADS.MANAGE] } }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
});

test('admin read permissions are enforced server-side', () => {
  const viewOnly = authorize(PERMISSIONS.LEADS.VIEW);
  assert.throws(() => viewOnly({ user: null }, {}, () => {}));
  let allowed = false;
  viewOnly({ user: { role: 'admin', permissions: [PERMISSIONS.LEADS.VIEW] } }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
});
