const Joi = require('joi');
const { LEAD_STATUSES, LOST_REASONS } = require('../../../models/lead.model');

const nullableText = (max) => Joi.string().trim().max(max).allow('', null);

const createLeadSchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(120).required(),
  phone: Joi.string().trim().min(5).max(30).required(),
  email: Joi.string().trim().email().max(254).allow('', null),
  company: nullableText(160),
  wilaya: Joi.string().trim().min(2).max(80).required(),
  message: nullableText(3000),
  productIdentifier: Joi.string().trim().max(120).required(),
  quantity: Joi.number().integer().min(1).max(100000).required(),
  attribution: Joi.object({
    source: nullableText(100),
    medium: nullableText(100),
    campaign: nullableText(160),
    referrer: nullableText(1000),
    landingPage: nullableText(1000),
    pagePath: nullableText(500),
    visitorId: nullableText(160),
    sessionId: nullableText(160),
  }).unknown(false).default({}),
}).unknown(false);

const updateLeadSchema = Joi.object({
  estimatedValue: Joi.number().min(0),
  nextFollowUpAt: Joi.date().iso().allow(null, ''),
  lastContactAt: Joi.date().iso().allow(null, ''),
}).min(1).unknown(false);

const addNoteSchema = Joi.object({
  content: Joi.string().trim().min(1).max(4000).required(),
}).unknown(false);

const assignLeadSchema = Joi.object({
  assignedTo: Joi.string().hex().length(24).allow(null, '').required(),
}).unknown(false);

const updateLeadStatusSchema = Joi.object({
  status: Joi.string().valid(...LEAD_STATUSES).required(),
  finalValue: Joi.number().min(0),
  orderReference: nullableText(120),
  lostReason: Joi.string().valid(...LOST_REASONS),
  lostExplanation: nullableText(1000),
}).custom((value, helpers) => {
  if (value.status === 'lost' && !value.lostReason) return helpers.error('any.custom', { message: 'lostReason is required when a lead is lost' });
  if (value.status === 'won' && value.finalValue === undefined) return helpers.error('any.custom', { message: 'finalValue is required when a lead is won' });
  return value;
}).unknown(false);

module.exports = { createLeadSchema, updateLeadSchema, addNoteSchema, assignLeadSchema, updateLeadStatusSchema };
