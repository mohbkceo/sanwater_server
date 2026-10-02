const test = require('node:test');
const assert = require('node:assert/strict');
const AnalyticsVisitor = require('../src/models/analyticsVisitor.model');
const AnalyticsSession = require('../src/models/analyticsSession.model');
const AnalyticsEvent = require('../src/models/analyticsEvent.model');
const { LEGACY_BROWSER_EVENTS } = require('../src/config/analytics');
const { PERMISSIONS } = require('../src/config/permissions');
const authorize = require('../src/middlewares/authentication/authorize');
const tracking = require('../src/services/analytics/tracking');
const { adaptLegacy } = require('../src/controllers/analytics/tracking.controller');
const { attentionFromReports, buildSourceQuality, productFunnel, sales } = require('../src/services/analytics/reporting');
const { subject } = require('../src/services/analytics/reporting');
const Lead = require('../src/models/lead.model');
const ActivityLog = require('../src/models/activityLog.model');
const Hiring = require('../src/models/hiring.model');
const Application = require('../src/models/application.model');
const applicationController = require('../src/controllers/contents/applicationController');
const intelligenceController = require('../src/controllers/analytics/intelligence.controller');
const reports = require('../src/services/analytics/reporting');
const { resolvePeriod } = require('../src/services/analytics.helpers');
const { deriveEventName } = require('../src/utils/logger');

test('session expiry and external acquisition create new sessions, while SPA navigation does not', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  const session = { lastActivityAt: new Date(now - 15 * 60000), acquisition: tracking.acquisitionFrom({ acquisition: { source: 'google', medium: 'cpc', campaign: 'autumn' } }) };
  assert.equal(tracking.shouldStartNewSession(session, session.acquisition, now), false);
  assert.equal(tracking.shouldStartNewSession({ ...session, lastActivityAt: new Date(now - 31 * 60000) }, session.acquisition, now), true);
  assert.equal(tracking.shouldStartNewSession(session, tracking.acquisitionFrom({ acquisition: { source: 'facebook', campaign: 'autumn' } }), now), true);
});

test('visitor persists across a new session and attribution keeps first, last, and last non-direct touch', async () => {
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-only-cookie-secret';
  const originals = { visitorFind: AnalyticsVisitor.findOne, sessionFind: AnalyticsSession.findOne, visitorSave: AnalyticsVisitor.prototype.save, sessionSave: AnalyticsSession.prototype.save };
  const visitors = new Map(), sessions = new Map();
  AnalyticsVisitor.findOne = async ({ visitorId }) => visitors.get(visitorId) || null;
  AnalyticsSession.findOne = async ({ sessionId }) => sessions.get(sessionId) || null;
  AnalyticsVisitor.prototype.save = async function () { visitors.set(this.visitorId, this); return this; };
  AnalyticsSession.prototype.save = async function () { sessions.set(this.sessionId, this); return this; };
  const call = async (cookies, acquisition) => {
    const issued = {};
    const res = { cookie(name, value) { issued[name] = value; } };
    const identity = await tracking.identify({ cookies }, res, { path: '/products', acquisition });
    return { identity, issued };
  };
  try {
    const first = await call({}, { source: 'google', medium: 'cpc', campaign: 'A' });
    const same = await call(first.issued, {});
    assert.equal(same.identity.visitor.visitorId, first.identity.visitor.visitorId);
    assert.equal(same.identity.session.sessionId, first.identity.session.sessionId);
    const next = await call(same.issued, { source: 'facebook', medium: 'social', campaign: 'B' });
    assert.equal(next.identity.visitor.visitorId, first.identity.visitor.visitorId);
    assert.notEqual(next.identity.session.sessionId, first.identity.session.sessionId);
    assert.equal(next.identity.visitor.firstTouch.source, 'google');
    assert.equal(next.identity.visitor.lastTouch.source, 'facebook');
    assert.equal(next.identity.visitor.lastNonDirectTouch.source, 'facebook');
    assert.equal(tracking.unsign(next.issued.sw_visitor), next.identity.visitor.visitorId);
    assert.equal(tracking.unsign(`${next.identity.visitor.visitorId}.bad-signature`), null);
  } finally {
    AnalyticsVisitor.findOne = originals.visitorFind; AnalyticsSession.findOne = originals.sessionFind;
    AnalyticsVisitor.prototype.save = originals.visitorSave; AnalyticsSession.prototype.save = originals.sessionSave;
    process.env.JWT_SECRET = originalSecret;
  }
});

test('server event IDs are stable and browser events cannot claim a business outcome', async () => {
  const original = AnalyticsEvent.updateOne;
  const emitted = [];
  AnalyticsEvent.updateOne = async (...args) => { emitted.push(args); return { acknowledged: true }; };
  try {
    await tracking.emitBusinessEvent('lead_won', 'lead', 'abc', 'transition-1');
    await tracking.emitBusinessEvent('lead_won', 'lead', 'abc', 'transition-1');
    assert.equal(emitted[0][0].eventId, emitted[1][0].eventId);
    assert.deepEqual(emitted[0][2], { upsert: true });
    assert.equal(tracking.browserEvent({ name: 'lead_won', path: '/' }, { visitor: { visitorId: 'v' }, session: { sessionId: 's' } }), null);
  } finally { AnalyticsEvent.updateOne = original; }
});

test('public tracking validates event names and excludes admin paths and private query data', () => {
  assert.equal(tracking.isAdminPath('/sanwater/admins/secure/products'), true);
  assert.equal(tracking.isAdminPath('/products'), false);
  assert.equal(tracking.normalizePath('/reset/secret-token?auth=secret'), '/reset/:redacted');
  assert.equal(tracking.normalizePath('/products/507f1f77bcf86cd799439011?token=secret'), '/products/:id');
  assert.equal(adaptLegacy({ type: 'conversion' }).name, undefined);
  assert.equal(LEGACY_BROWSER_EVENTS.product_view, 'product_viewed');
  const event = tracking.browserEvent({ name: 'product_viewed', path: '/products', subject: { type: 'product', id: '507f1f77bcf86cd799439011' } }, { visitor: { visitorId: 'v', firstTouch: {}, lastTouch: {}, lastNonDirectTouch: null }, session: { sessionId: 's' } });
  assert.equal(event.subject.type, 'product');
  assert.equal(event.properties.path, '/products');
  const articleClick = tracking.browserEvent({ name: 'article_product_clicked', path: '/news/story', subject: { type: 'article', id: '507f1f77bcf86cd799439011' }, relatedProductId: '507f1f77bcf86cd799439012' }, { visitor: { visitorId: 'v', firstTouch: {}, lastTouch: {}, lastNonDirectTouch: null }, session: { sessionId: 's' } });
  assert.equal(articleClick.subject.type, 'article');
  assert.equal(articleClick.properties.relatedProductId, '507f1f77bcf86cd799439012');
});

test('persona never authorizes a domain, legacy analytics.view only implies read access', () => {
  const domain = authorize(PERMISSIONS.ANALYTICS.PRODUCTS);
  assert.throws(() => domain({ user: { role: 'admin', persona: 'product_manager', permissions: [] } }, {}, () => {}));
  let called = false;
  domain({ user: { role: 'admin', persona: 'general_admin', permissions: [PERMISSIONS.ANALYTICS.VIEW] } }, {}, () => { called = true; });
  assert.equal(called, true);
  assert.equal(authorize.grants([PERMISSIONS.ANALYTICS.VIEW], PERMISSIONS.ANALYTICS.EXPORT), false);
});

test('attention findings contain transparent evidence and a subject drilldown', () => {
  const reports = { products: { rows: [{ productId: 'p1', product: 'Filter', classification: 'hidden_opportunity', reason: 'Above median conversion, below median demand.', recommendedAction: 'Inspect visibility.', uniqueViews: 30, orderConversionRate: 8, classificationEvidence: { siteMedianViews: 90, siteMedianConversion: 4 } }] }, sales: { kpis: { followUpsDue: { current: 2 } } } };
  const findings = attentionFromReports(reports, '/admin');
  assert.equal(findings.length, 2);
  assert.equal(findings[1].subjectId, 'p1');
  assert.equal(findings[1].evidence.siteMedianConversion, 4);
  assert.match(findings[1].targetRoute, /subjects\/product\/p1/);
});

test('sales lead volume compares against the equivalent preceding period', async () => {
  const p = resolvePeriod({ from: '2026-10-01', to: '2026-10-02' });
  const original = { count: Lead.countDocuments, aggregate: Lead.aggregate };
  Lead.countDocuments = async filter => filter.createdAt ? (filter.createdAt.$gte.getTime() === p.from.getTime() ? 10 : 4) : 0;
  Lead.aggregate = async () => [];
  try {
    const report = await sales(p);
    assert.equal(report.kpis.newLeads.current, 10);
    assert.equal(report.kpis.newLeads.previous, 4);
    assert.equal(report.kpis.newLeads.percentageChange, 150);
  } finally { Lead.countDocuments = original.count; Lead.aggregate = original.aggregate; }
});

test('source quality joins observed visitors and CRM outcomes without source case splits', () => {
  const rows = buildSourceQuality([{ _id: 'direct', visitors: 22 }], [{ _id: 'Direct', count: 2 }], [{ _id: 'DIRECT', count: 1, revenue: 300 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qualifiedLeads, 2);
  assert.equal(rows[0].wonDeals, 1);
  assert.equal(rows[0].revenue, 300);
  assert.equal(rows[0].available, true);
});

test('product subject stages retain their distinct observed units', () => {
  const stages = productFunnel({ uniqueViews: 30, salesIntent: 8, qualifiedLeads: 3, orders: 1 });
  assert.deepEqual(stages.map(stage => stage.count), [30, 8, 3, 1]);
  assert.deepEqual(stages.map(stage => stage.name), ['Product viewers', 'Inquiry starts', 'Qualified leads', 'Won deals']);
});

test('audit event names identify hiring closure and application stage changes', () => {
  assert.equal(deriveEventName('Hiring', 'UPDATE', { changedFields: ['status'], changes: [{ field: 'status', after: 'closed' }] }), 'job.closed');
  assert.equal(deriveEventName('Application', 'UPDATE', { changedFields: ['stage'] }), 'application.stage_changed');
});

test('subject report combines lifecycle history with separate admin audit events', async () => {
  const id = '507f1f77bcf86cd799439011';
  const original = { aggregate: AnalyticsEvent.aggregate, logFind: ActivityLog.find, leadFind: Lead.findById };
  AnalyticsEvent.aggregate = async () => [{ _id: 'lead_won', count: 1 }];
  ActivityLog.find = () => ({ select() { return this; }, populate() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => [{ eventName: 'lead.won', details: { summary: 'Marked won' } }] });
  Lead.findById = () => ({ select() { return this; }, lean: async () => ({ status: 'won', productName: 'Filter', source: 'search', estimatedValue: 100, finalValue: 120, statusHistory: [{ newStatus: 'won', changedAt: new Date('2026-10-01') }] }) });
  try {
    const report = await subject('lead', id, resolvePeriod({ from: '2026-10-01', to: '2026-10-02' }));
    assert.equal(report.performance.finalValue, 120);
    assert.equal(report.journey[0].name, 'won');
    assert.equal(report.events[0].name, 'lead_won');
    assert.equal(report.activity[0].eventName, 'lead.won');
  } finally { AnalyticsEvent.aggregate = original.aggregate; ActivityLog.find = original.logFind; Lead.findById = original.leadFind; }
});

test('explorer requires analytics.explore and subject audit details require logs.view', async () => {
  const id = '507f1f77bcf86cd799439011';
  const original = reports.subject;
  let options;
  reports.subject = async (_type, _id, _period, supplied) => { options = supplied; return { activity: [] }; };
  const response = { json(value) { this.body = value; } };
  const errors = [];
  const req = { user: { role: 'admin', permissions: [PERMISSIONS.ANALYTICS.SALES] }, params: { type: 'lead', id }, query: {} };
  try {
    await intelligenceController.explorer({ ...req, query: { type: 'lead' } }, response, error => errors.push(error));
    assert.equal(errors[0].statusCode, 403);
    await intelligenceController.subject(req, response, error => errors.push(error));
    assert.equal(options.includeActivity, false);
    assert.equal(response.body.success, true);
    req.user.permissions.push(PERMISSIONS.LOGS.VIEW);
    await intelligenceController.subject(req, response, error => errors.push(error));
    assert.equal(options.includeActivity, true);
  } finally { reports.subject = original; }
});

test('public application submission records an actual candidate and an authoritative event', async () => {
  const id = '507f1f77bcf86cd799439011';
  const original = { hiringFind: Hiring.findOne, create: Application.create, event: AnalyticsEvent.updateOne };
  let written;
  Hiring.findOne = () => ({ select: async () => ({ _id: id }) });
  Application.create = async value => { written = value; return { _id: id, stage: 'applied', ...value }; };
  AnalyticsEvent.updateOne = async () => ({ acknowledged: true });
  const response = { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return value; }, sendStatus(code) { this.statusCode = code; return this; } };
  try {
    await applicationController.submit({ params: { id }, body: { fullName: 'Ada Example', email: 'ada@example.com', phone: '123' }, cookies: {} }, response, error => { throw error; });
    assert.equal(response.statusCode, 201);
    assert.equal(written.stageHistory[0].stage, 'applied');
    assert.equal(written.hiringId, id);
  } finally { Hiring.findOne = original.hiringFind; Application.create = original.create; AnalyticsEvent.updateOne = original.event; }
});
