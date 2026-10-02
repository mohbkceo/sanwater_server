const { resolvePeriod } = require('../../services/analytics.helpers');
const reports = require('../../services/analytics/reporting');
const { grants } = require('../../middlewares/authentication/authorize');
const { PERMISSIONS } = require('../../config/permissions');
const Product = require('../../models/product.model');
const Lead = require('../../models/lead.model');
const Quotation = require('../../models/quotation.model');
const Hiring = require('../../models/hiring.model');
const Application = require('../../models/application.model');
const News = require('../../models/news.model');
const Family = require('../../models/family.model');
const User = require('../../models/user.model');
const mongoose = require('mongoose');
const ActivityLog = require('../../models/activityLog.model');
const AnalyticsSession = require('../../models/analyticsSession.model');
const { rankActivity } = require('../../services/analytics/activityPriority');

const DOMAIN_PERMISSION = {
  marketing: PERMISSIONS.ANALYTICS.MARKETING, products: PERMISSIONS.ANALYTICS.PRODUCTS,
  sales: PERMISSIONS.ANALYTICS.SALES, hiring: PERMISSIONS.ANALYTICS.HIRING,
  content: PERMISSIONS.ANALYTICS.CONTENT, operations: PERMISSIONS.ANALYTICS.SALES,
};
const SUBJECT_PERMISSION = {
  product: PERMISSIONS.ANALYTICS.PRODUCTS, product_family: PERMISSIONS.ANALYTICS.PRODUCTS,
  lead: PERMISSIONS.ANALYTICS.SALES, quotation: PERMISSIONS.ANALYTICS.SALES,
  hiring_position: PERMISSIONS.ANALYTICS.HIRING, application: PERMISSIONS.ANALYTICS.HIRING,
  article: PERMISSIONS.ANALYTICS.CONTENT, campaign: PERMISSIONS.ANALYTICS.MARKETING,
  admin_user: PERMISSIONS.LOGS.VIEW,
};
function can(req, permission) { return req.user.role === 'super_admin' || grants(req.user.permissions || [], permission); }
const handle = fn => async (req, res, next) => { try { res.json({ success: true, data: await fn(req) }); } catch (error) { next(error); } };
function period(req) { return resolvePeriod(req.query); }
function deny() { const error = new Error('Forbidden'); error.statusCode = 403; throw error; }
const base = '/sanwater/admins/secure';

const domain = handle(async req => {
  const name = req.params.domain;
  if (!DOMAIN_PERMISSION[name]) { const error = new Error('Unknown analytics domain'); error.statusCode = 404; throw error; }
  if (!can(req, DOMAIN_PERMISSION[name])) deny();
  return reports[name](period(req));
});
const dashboard = handle(async req => {
  const p = period(req);
  const persona = req.user.persona || 'general_admin';
  const ordered = {
    executive: ['sales', 'products', 'marketing', 'hiring', 'content'], product_manager: ['products', 'sales'],
    marketing_manager: ['marketing', 'content', 'products'], sales_manager: ['sales', 'marketing'],
    hiring_manager: ['hiring'], content_manager: ['content', 'marketing'], operations_manager: ['operations', 'sales'],
    general_admin: ['sales', 'products', 'marketing', 'hiring', 'content'],
  }[persona] || ['sales', 'products'];
  const domains = ordered.filter(name => can(req, DOMAIN_PERMISSION[name]));
  const result = await Promise.allSettled(domains.map(name => reports[name](p)));
  const sections = Object.fromEntries(result.map((entry, index) => [domains[index], entry.status === 'fulfilled' ? entry.value : { available: false, reason: 'This section could not be loaded' }]));
  const importantChanges = can(req, PERMISSIONS.LOGS.VIEW)
    ? rankActivity(await ActivityLog.find({ createdAt: { $gte: new Date(Date.now() - 14 * 86400000) } }).select('userId action eventName target targetId details.summary details.changes createdAt').populate('userId', 'fullName').sort({ createdAt: -1 }).limit(100).lean().catch(() => []), persona).slice(0, 8)
    : [];
  return { persona, period: reportsPeriod(p), sections, attention: reports.attentionFromReports(sections, base), importantChanges, visibleDomains: domains };
});
function reportsPeriod(p) { return { from: p.from.toISOString(), to: p.to.toISOString(), comparisonFrom: p.comparisonFrom.toISOString(), comparisonTo: p.comparisonTo.toISOString(), timezone: 'UTC' }; }
const attention = handle(async req => {
  const p = period(req); const names = Object.keys(DOMAIN_PERMISSION).filter(name => name !== 'operations' && can(req, DOMAIN_PERMISSION[name]));
  const result = await Promise.allSettled(names.map(name => reports[name](p)));
  const values = Object.fromEntries(result.map((entry, i) => [names[i], entry.status === 'fulfilled' ? entry.value : null]));
  return { period: reportsPeriod(p), insights: reports.attentionFromReports(values, base) };
});
const subject = handle(async req => {
  const type = req.params.type;
  if (!SUBJECT_PERMISSION[type]) { const error = new Error('Unknown subject'); error.statusCode = 404; throw error; }
  if (!can(req, SUBJECT_PERMISSION[type])) deny();
  const aliases = [];
  if (type === 'product' && mongoose.isValidObjectId(req.params.id)) {
    const product = await Product.findById(req.params.id).select('serialNumber').lean();
    if (product?.serialNumber) aliases.push(product.serialNumber);
  }
  return reports.subject(type, req.params.id, period(req), { aliases, includeActivity: can(req, PERMISSIONS.LOGS.VIEW) });
});
const MODELS = { product: [Product, 'name productId serialNumber status'], product_family: [Family, 'name slug isActive'], lead: [Lead, 'fullName productName status'], quotation: [Quotation, 'status source'], hiring_position: [Hiring, 'title status'], application: [Application, 'candidate.fullName stage hiringId'], article: [News, 'title status'], campaign: [null, ''], admin_user: [User, 'fullName role persona'] };
const explorer = handle(async req => {
  if (!can(req, PERMISSIONS.ANALYTICS.EXPLORE)) deny();
  const type = String(req.query.type || 'product');
  if (!MODELS[type]) { const error = new Error('Unsupported subject type'); error.statusCode = 400; throw error; }
  if (!can(req, SUBJECT_PERMISSION[type])) deny();
  const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
  const search = String(req.query.search || '').trim().slice(0, 80);
  const [Model, projection] = MODELS[type];
  if (!Model) {
    const match = { 'acquisition.campaign': { $nin: [null, ''] } };
    if (search) match['acquisition.campaign'] = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const [rows, count] = await Promise.all([
      AnalyticsSession.aggregate([{ $match: match }, { $group: { _id: '$acquisition.campaign', sessions: { $sum: 1 } } }, { $sort: { sessions: -1 } }, { $skip: (page - 1) * limit }, { $limit: limit }]),
      AnalyticsSession.aggregate([{ $match: match }, { $group: { _id: '$acquisition.campaign' } }, { $count: 'total' }]),
    ]);
    return { type, rows: rows.map(r => ({ _id: r._id, title: r._id, sessions: r.sessions })), total: count[0]?.total || 0, page, limit, available: true };
  }
  const key = { product: 'name', product_family: 'name', lead: 'fullName', hiring_position: 'title', application: 'candidate.fullName', article: 'title', admin_user: 'fullName' }[type];
  const filter = key && search ? { [key]: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
  const [rows, total] = await Promise.all([Model.find(filter).select(projection).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Model.countDocuments(filter)]);
  return { type, rows, total, page, limit, available: true };
});
module.exports = { DOMAIN_PERMISSION, SUBJECT_PERMISSION, domain, dashboard, attention, subject, explorer };
