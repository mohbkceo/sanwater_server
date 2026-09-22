const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { diff, redact, buildUpdateDetails } = require('../src/utils/audit');
const { normalizeAction } = require('../src/utils/logger');

test('audit diff captures actual nested product changes and ignores metadata', () => {
  const before = {
    _id: new mongoose.Types.ObjectId(), updatedAt: new Date('2026-01-01'),
    name: 'Filter A', prices: { productPrice: 1500, currency: 'DA' },
    isActive: false, gallery: ['a.jpg', 'b.jpg'], seo: { title: 'Old title', description: 'Same' },
    family: { _id: 'family-1', name: 'Water Filters' },
  };
  const after = {
    ...before, updatedAt: new Date('2026-02-01'), name: 'Filter A',
    prices: { productPrice: 1800, currency: 'DA' }, isActive: true,
    gallery: ['a.jpg', 'c.jpg'], seo: { title: 'New title', description: 'Same' },
    family: { _id: 'family-1', name: 'Water Filters' },
  };
  const changes = diff(before, after);
  assert.deepEqual(changes.map(({ field }) => field).sort(), ['gallery', 'isActive', 'prices.productPrice', 'seo.title']);
  assert.equal(changes.find(({ field }) => field === 'prices.productPrice').label, 'Price');
  const details = buildUpdateDetails('Product', before, after, 'Updated product Filter A');
  assert.deepEqual(details.changedFields.sort(), ['gallery', 'isActive', 'prices.productPrice', 'seo.title']);
  assert.equal(details.changes.find(({ field }) => field === 'isActive').before, false);
  assert.equal(details.changes.find(({ field }) => field === 'prices.productPrice').after, 1800);
});

test('audit redaction removes secrets recursively while preserving safe values', () => {
  assert.deepEqual(redact({
    name: 'Admin', password: 'hash', nested: { refreshToken: 'secret', isActive: true },
    authorization: 'Bearer secret', safe: [{ authKey: 'private', label: 'visible' }],
  }), { name: 'Admin', nested: { isActive: true }, safe: [{ label: 'visible' }] });
});

test('product update audit emits no record when the persisted values did not change', async () => {
  const ActivityLog = require('../src/models/activityLog.model');
  const { logUpdateActivity } = require('../src/utils/logger');
  const originalCreate = ActivityLog.create;
  let writes = 0;
  ActivityLog.create = async () => { writes += 1; };
  try {
    const product = { name: 'Mixer', prices: { productPrice: 1500 }, isActive: true };
    await logUpdateActivity({ user: { uid: 'admin-id' }, headers: {} }, 'UPDATE', 'Product', 'product-1', product, { ...product, prices: { ...product.prices } }, 'Updated product Mixer');
    assert.equal(writes, 0);
  } finally {
    ActivityLog.create = originalCreate;
  }
});

test('legacy action names normalize to the supported action set', () => {
  assert.equal(normalizeAction('UPDATE FAMILY'), 'UPDATE');
  assert.equal(normalizeAction('DELETE SUB_FAMILY'), 'DELETE');
  assert.equal(normalizeAction('ASSIGN PRODUCTS TO SUB_FAMILY'), 'MOVE');
  assert.equal(normalizeAction('PERMISSIONS_CHANGE'), 'SECURITY');
});

test('activity log endpoint applies all supported filters and safe pagination', async () => {
  const ActivityLog = require('../src/models/activityLog.model');
  const User = require('../src/models/user.model');
  const { getLogs } = require('../src/controllers/analytics/activityLogController');
  const originals = { find: ActivityLog.find, countDocuments: ActivityLog.countDocuments, distinct: ActivityLog.distinct, userFind: User.find };
  let capturedQuery;
  let capturedSkip;
  ActivityLog.find = (query) => {
    capturedQuery = query;
    const chain = {
      populate() { return chain; }, sort() { return chain; }, limit() { return chain; },
      skip(value) { capturedSkip = value; return chain; }, exec: async () => [{ _id: 'log' }],
    };
    return chain;
  };
  ActivityLog.countDocuments = async () => 41;
  ActivityLog.distinct = async (field) => field === 'userId' ? [] : ['Product'];
  User.find = () => ({ select() { return this; }, sort() { return this; }, lean: async () => [] });
  try {
    const response = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return value; } };
    await getLogs({ query: { page: '3', limit: '500', userId: 'user-1', action: 'UPDATE FAMILY', target: 'Family', targetId: 'family-1', search: 'Mixer (blue)', from: '2026-01-01', to: '2026-01-31' } }, response, (error) => { throw error; });
    assert.equal(capturedSkip, 200);
    assert.equal(response.body.data.limit, 100);
    assert.equal(response.body.data.totalPages, 1);
    assert.equal(capturedQuery.userId, 'user-1');
    assert.ok(capturedQuery.action.$in.includes('UPDATE'));
    assert.ok(capturedQuery.action.$in.includes('UPDATE FAMILY'));
    assert.equal(capturedQuery.target, 'Family');
    assert.equal(capturedQuery.targetId, 'family-1');
    assert.ok(capturedQuery.createdAt.$gte instanceof Date);
    assert.equal(capturedQuery.createdAt.$lte.toISOString(), '2026-01-31T23:59:59.999Z');
    assert.match(capturedQuery.$or[0].targetId.source, /Mixer/);
  } finally {
    ActivityLog.find = originals.find;
    ActivityLog.countDocuments = originals.countDocuments;
    ActivityLog.distinct = originals.distinct;
    User.find = originals.userFind;
  }
});
