// Job posting external application links — validation, schema and API flow.
// Runs without a database: persistence calls are stubbed, schema validation is real.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const request = require('supertest');
const { normalizeApplicationUrl, isValidApplicationUrl } = require('../src/utils/applicationUrl');
const Hiring = require('../src/models/hiring.model');
const ActivityLog = require('../src/models/activityLog.model');
const AnalyticsEvent = require('../src/models/analyticsEvent.model');
const jobs = require('../src/controllers/contents/hiringController');
const errorHandler = require('../src/utils/error.middleware');

mongoose.set('bufferCommands', false);
const originals = {};
const stub = (model, method, fn) => { originals[`${model.modelName}.${method}`] = [model, method, model[method]]; model[method] = fn; };
let store;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { uid: new mongoose.Types.ObjectId().toString() }; next(); });
  app.post('/hiring', jobs.createHiring);
  app.put('/hiring/:id', jobs.updateHiring);
  app.get('/public/hiring/:id', (req, _res, next) => { delete req.user; next(); }, jobs.getHiringById);
  app.use((error, _req, res, _next) => errorHandler(res, error));
  return app;
}

beforeEach(() => {
  store = new Map();
  stub(ActivityLog, 'create', async () => ({}));
  stub(AnalyticsEvent, 'updateOne', async () => ({}));
  stub(Hiring, 'create', async body => { const doc = new Hiring(body); await doc.validate(); store.set(String(doc._id), doc); return doc; });
  stub(Hiring, 'findById', id => ({ lean: async () => store.get(String(id))?.toObject() || null }));
  stub(Hiring, 'findByIdAndUpdate', async (id, update, options) => {
    assert.equal(options.runValidators, true, 'updates must run schema validators');
    const doc = store.get(String(id)); if (!doc) return null;
    doc.set(update); await doc.validate(); return doc;
  });
  stub(Hiring, 'findOne', query => ({ select: async fields => {
    const doc = store.get(String(query._id));
    if (!doc || doc.deletedAt || !query.status.$in.includes(doc.status)) return null;
    return Object.fromEntries(fields.split(' ').map(field => [field, doc[field]]));
  } }));
});
afterEach(() => { for (const [model, method, fn] of Object.values(originals)) model[method] = fn; });

const basePosting = { title: 'Installer', location: 'Alger', type: 'Full-time', description: 'Real position details', status: 'published' };

test('normalizes safe links and rejects unsafe or malformed ones', () => {
  assert.equal(normalizeApplicationUrl('https://jobs.example.com/apply?id=7'), 'https://jobs.example.com/apply?id=7');
  assert.equal(normalizeApplicationUrl('  jobs.example.com/apply  '), 'https://jobs.example.com/apply');
  assert.equal(normalizeApplicationUrl('jobs.example.com:8443/apply'), 'https://jobs.example.com:8443/apply');
  assert.equal(normalizeApplicationUrl('HTTP://Careers.Example.COM'), 'http://careers.example.com/');
  for (const empty of ['', '   ', null, undefined]) assert.equal(normalizeApplicationUrl(empty), '');
  for (const unsafe of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'file:///etc/passwd', 'ftp://example.com', 'mailto:hr@example.com',
    '//evil.example.com', 'https://user:pass@example.com', 'http://localhost:3000/apply', 'http://127.0.0.1/apply', 'http://192.168.1.10/', 'https://[::1]/',
    'https://exa mple.com', 'https://example.com/"onclick', 'https://example', 'not a url', `https://example.com/${'a'.repeat(2050)}`, 42, {}]) {
    assert.equal(normalizeApplicationUrl(unsafe), null, `should reject ${String(unsafe).slice(0, 40)}`);
    assert.equal(isValidApplicationUrl(unsafe), false);
  }
});

test('schema accepts empty or normalized links and refuses anything else', () => {
  assert.equal(new Hiring(basePosting).applicationUrl, '', 'existing postings default to no external link');
  assert.equal(new Hiring({ ...basePosting, applicationUrl: 'https://jobs.example.com/a' }).validateSync(), undefined);
  for (const bad of ['javascript:alert(1)', 'jobs.example.com/a', 'http://localhost/a']) {
    const error = new Hiring({ ...basePosting, applicationUrl: bad }).validateSync();
    assert.ok(error?.errors?.applicationUrl, `schema should reject ${bad}`);
  }
});

test('admin can add, edit and remove a posting link and visitors receive it', async () => {
  const app = buildApp();
  const created = await request(app).post('/hiring').send({ ...basePosting, applicationUrl: ' jobs.example.com/apply/installer ' }).expect(201);
  const id = created.body.data._id;
  assert.equal(created.body.data.applicationUrl, 'https://jobs.example.com/apply/installer');

  let publicJob = await request(app).get(`/public/hiring/${id}`).expect(200);
  assert.equal(publicJob.body.data.applicationUrl, 'https://jobs.example.com/apply/installer');

  const edited = await request(app).put(`/hiring/${id}`).send({ applicationUrl: 'https://careers.example.org/jobs/42' }).expect(200);
  assert.equal(edited.body.data.applicationUrl, 'https://careers.example.org/jobs/42');

  const untouched = await request(app).put(`/hiring/${id}`).send({ status: 'published', title: 'Senior installer' }).expect(200);
  assert.equal(untouched.body.data.applicationUrl, 'https://careers.example.org/jobs/42', 'updates without the field keep the link');

  const removed = await request(app).put(`/hiring/${id}`).send({ applicationUrl: '' }).expect(200);
  assert.equal(removed.body.data.applicationUrl, '');
  publicJob = await request(app).get(`/public/hiring/${id}`).expect(200);
  assert.equal(publicJob.body.data.applicationUrl, '');

  await request(app).put(`/hiring/${id}`).send({ applicationUrl: 'https://jobs.example.com/x' }).expect(200);
  const clearedWithNull = await request(app).put(`/hiring/${id}`).send({ applicationUrl: null }).expect(200);
  assert.equal(clearedWithNull.body.data.applicationUrl, '');
});

test('invalid or unsafe links are rejected with a field error and nothing is saved', async () => {
  const app = buildApp();
  for (const bad of ['javascript:alert(document.cookie)', 'https://user:pw@example.com', 'http://localhost:5173/apply', 'nope']) {
    const response = await request(app).post('/hiring').send({ ...basePosting, applicationUrl: bad }).expect(400);
    assert.equal(response.body.code, 'INVALID_APPLICATION_URL');
    assert.ok(response.body.fields.applicationUrl);
  }
  assert.equal(store.size, 0);

  const created = await request(app).post('/hiring').send({ ...basePosting, applicationUrl: 'https://jobs.example.com/a' }).expect(201);
  const response = await request(app).put(`/hiring/${created.body.data._id}`).send({ applicationUrl: 'data:text/html,hi' }).expect(400);
  assert.equal(response.body.code, 'INVALID_APPLICATION_URL');
  assert.equal(store.get(created.body.data._id).applicationUrl, 'https://jobs.example.com/a', 'previous link is preserved');
});

test('postings created without the field keep working unchanged', async () => {
  const app = buildApp();
  const created = await request(app).post('/hiring').send(basePosting).expect(201);
  assert.equal(created.body.data.applicationUrl, '');
  const publicJob = await request(app).get(`/public/hiring/${created.body.data._id}`).expect(200);
  assert.equal(publicJob.body.data.title, 'Installer');
  assert.equal(publicJob.body.data.applicationUrl, '');
});
