const mongoose = require('mongoose');
const Lead = require('../../models/lead.model');
const Product = require('../../models/product.model');
const User = require('../../models/user.model');
const Event = require('../../models/event.model');
const returnResponse = require('../../utils/responseHandler');
const { SUCCESS, ERRORS } = require('../../config/messages');
const CostumeExption = require('../../utils/CostumeException');
const { logActivity } = require('../../utils/logger');

const clean = (value) => {
  if (value === undefined || value === null || value === '') return null;
  return String(value).replace(/<[^>]*>/g, '').trim();
};

function dateRange(from, to) {
  const result = {};
  if (from) result.$gte = new Date(from);
  if (to) result.$lte = new Date(to);
  return Object.keys(result).length ? result : null;
}

function buildLeadQuery(query) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.assignedTo === 'unassigned') filter.assignedTo = null;
  else if (query.assignedTo && mongoose.isValidObjectId(query.assignedTo)) filter.assignedTo = query.assignedTo;
  if (query.product && mongoose.isValidObjectId(query.product)) filter.productId = query.product;
  if (query.source) filter.source = query.source;
  const range = dateRange(query.from, query.to);
  if (range) filter.createdAt = range;
  if (query.search) {
    const safe = String(query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (safe) {
      const rx = new RegExp(safe, 'i');
      filter.$or = [{ fullName: rx }, { phone: rx }, { email: rx }, { company: rx }, { productName: rx }];
    }
  }
  return filter;
}

const createLead = async (req, res, next) => {
  try {
    const { fullName, phone, email, company, wilaya, message, productIdentifier, quantity, attribution = {} } = req.body;
    const productQuery = mongoose.isValidObjectId(productIdentifier)
      ? { $or: [{ _id: productIdentifier }, { serialNumber: productIdentifier }], isActive: true }
      : { serialNumber: productIdentifier, isActive: true };
    const product = await Product.findOne(productQuery).select('_id name productId serialNumber prices.productPrice');
    if (!product) throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'product_not_found' });

    const requestedSessionId = clean(attribution.sessionId);
    const requestedVisitorId = clean(attribution.visitorId);
    const identityFilters = [];
    if (requestedSessionId) identityFilters.push({ session_id: requestedSessionId });
    if (requestedVisitorId) identityFilters.push({ visitor_id: requestedVisitorId });
    const acquisitionEvent = identityFilters.length
      ? await Event.findOne({ $or: identityFilters }).sort({ ts: 1 }).select('source medium campaign referrer path session_id visitor_id').lean()
      : null;
    const referrer = clean(acquisitionEvent?.referrer) || clean(attribution.referrer) || clean(req.get('referer'));
    const source = clean(acquisitionEvent?.source) || clean(attribution.source) || (!referrer ? 'direct' : null);
    const unitPrice = Number(product.prices?.productPrice || 0);
    const lead = await Lead.create({
      fullName: clean(fullName), phone: clean(phone), email: clean(email), company: clean(company), wilaya: clean(wilaya), message: clean(message),
      productId: product._id, productSerialNumber: product.serialNumber, productName: product.name || product.productId || product.serialNumber,
      quantity, estimatedValue: unitPrice > 0 ? unitPrice * quantity : 0,
      source, medium: clean(acquisitionEvent?.medium) || clean(attribution.medium), campaign: clean(acquisitionEvent?.campaign) || clean(attribution.campaign), referrer,
      landingPage: clean(acquisitionEvent?.path) || clean(attribution.landingPage), pagePath: clean(attribution.pagePath), visitorId: clean(acquisitionEvent?.visitor_id) || requestedVisitorId, sessionId: clean(acquisitionEvent?.session_id) || requestedSessionId,
      statusHistory: [{ previousStatus: null, newStatus: 'new', changedAt: new Date() }],
    });

    await Event.create({
      type: 'lead_submitted', session_id: lead.sessionId || `lead_${lead._id}`, visitor_id: lead.visitorId,
      source: lead.source || 'direct', medium: lead.medium, campaign: lead.campaign, path: lead.pagePath,
      referrer: lead.referrer, conversion_name: 'lead_submitted', meta: { lead_id: String(lead._id), product_id: String(product._id), product_serial: product.serialNumber },
    }).catch(() => null);

    return returnResponse(res, SUCCESS.RESOURCES_CREATED, { id: lead._id, status: lead.status, productName: lead.productName });
  } catch (err) { next(err); }
};

const getLeads = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const filter = buildLeadQuery(req.query);
    const [leads, totalItems, summaryRows] = await Promise.all([
      Lead.find(filter).select('-notes -statusHistory -assignmentHistory').populate('assignedTo', 'fullName email').populate('productId', 'name serialNumber').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Lead.countDocuments(filter),
      Lead.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$estimatedValue' } } }]),
    ]);
    const statuses = Object.fromEntries(summaryRows.map((row) => [row._id, row.count]));
    const summary = { total: totalItems, new: 0, contacted: 0, qualified: 0, quote_sent: 0, won: 0, lost: 0, archived: 0, estimatedPipelineValue: 0 };
    Object.assign(summary, statuses);
    summary.estimatedPipelineValue = summaryRows.filter((r) => !['won', 'lost', 'archived'].includes(r._id)).reduce((sum, r) => sum + Number(r.value || 0), 0);
    return returnResponse(res, SUCCESS.RESOURCES_FOUND, { leads, summary, totalItems, totalPages: Math.ceil(totalItems / limit), currentPage: page });
  } catch (err) { next(err); }
};

const getLeadById = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedTo', 'fullName email')
      .populate('productId', 'name serialNumber gallery')
      .populate('notes.author', 'fullName email')
      .populate('statusHistory.changedBy', 'fullName email')
      .populate('assignmentHistory.changedBy assignmentHistory.previousAssignee assignmentHistory.newAssignee', 'fullName email');
    if (!lead) throw new CostumeExption(ERRORS.NOT_FOUND.msg, 404);
    return returnResponse(res, SUCCESS.RESOURCES_FOUND, lead);
  } catch (err) { next(err); }
};

const getLeadOptions = async (req, res, next) => {
  try {
    const [users, products, sources] = await Promise.all([
      User.find({ role: { $in: ['admin', 'super_admin'] } }).select('fullName email').sort({ fullName: 1 }).lean(),
      Product.find({ isActive: true }).select('name productId serialNumber').sort({ name: 1 }).limit(500).lean(),
      Lead.distinct('source', { source: { $nin: [null, ''] } }),
    ]);
    return returnResponse(res, SUCCESS.RESOURCES_FOUND, { users, products, sources: sources.sort() });
  } catch (err) { next(err); }
};

const updateLead = async (req, res, next) => {
  try {
    const update = { ...req.body };
    for (const field of ['nextFollowUpAt', 'lastContactAt']) if (update[field] === '') update[field] = null;
    const lead = await Lead.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!lead) throw new CostumeExption(ERRORS.NOT_FOUND.msg, 404);
    await logActivity(req, 'UPDATE', 'Lead', lead._id, { fields: Object.keys(update) });
    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, lead);
  } catch (err) { next(err); }
};

const addNote = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) throw new CostumeExption(ERRORS.NOT_FOUND.msg, 404);
    lead.notes.push({ content: clean(req.body.content), author: req.user.uid });
    await lead.save();
    await logActivity(req, 'ADD_NOTE', 'Lead', lead._id, {});
    const note = await Lead.findById(lead._id).select('notes').populate('notes.author', 'fullName email');
    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, note.notes[note.notes.length - 1]);
  } catch (err) { next(err); }
};

const assignLead = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) throw new CostumeExption(ERRORS.NOT_FOUND.msg, 404);
    const assignedTo = req.body.assignedTo || null;
    if (assignedTo) {
      const user = await User.findOne({ _id: assignedTo, role: { $in: ['admin', 'super_admin'] } }).select('_id');
      if (!user) throw new CostumeExption(ERRORS.INVALID.msg, ERRORS.INVALID.statusCode, ERRORS.INVALID.key, { message: 'invalid_assignee' });
    }
    const previousAssignee = lead.assignedTo || null;
    lead.assignedTo = assignedTo;
    lead.assignmentHistory.push({ previousAssignee, newAssignee: assignedTo, changedBy: req.user.uid });
    await lead.save();
    await logActivity(req, 'ASSIGN', 'Lead', lead._id, { previousAssignee, assignedTo });
    return getLeadById(req, res, next);
  } catch (err) { next(err); }
};

const updateStatus = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) throw new CostumeExption(ERRORS.NOT_FOUND.msg, 404);
    const previousStatus = lead.status;
    const { status, finalValue, orderReference, lostReason, lostExplanation } = req.body;
    lead.status = status;
    lead.statusHistory.push({ previousStatus, newStatus: status, changedBy: req.user.uid, reason: status === 'lost' ? lostReason : null });
    if (['contacted', 'qualified', 'quote_sent', 'won', 'lost'].includes(status)) lead.lastContactAt = new Date();
    if (status === 'won') {
      lead.finalValue = finalValue;
      lead.orderReference = clean(orderReference);
      lead.lostReason = null;
      lead.lostExplanation = null;
    } else if (status === 'lost') {
      lead.lostReason = lostReason;
      lead.lostExplanation = clean(lostExplanation);
    }
    await lead.save();
    await logActivity(req, 'UPDATE_STATUS', 'Lead', lead._id, { previousStatus, newStatus: status, lostReason: lead.lostReason, finalValue: lead.finalValue });
    return getLeadById(req, res, next);
  } catch (err) { next(err); }
};

module.exports = { createLead, getLeads, getLeadById, getLeadOptions, updateLead, addNote, assignLead, updateStatus };
