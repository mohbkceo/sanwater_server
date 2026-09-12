const Joi = require('joi');

const TYPES = ['page_view', 'conversion', 'cta_click', 'scroll', 'video_play', 'product_view', 'product_inquiry_started', 'lead_form_started', 'lead_submitted', 'article_view', 'article_product_clicked', 'article_contact_clicked', 'article_reading_progress'];
const schema = Joi.object({
  type: Joi.string().valid(...TYPES).required(), session_id: Joi.string().max(160).required(), visitor_id: Joi.string().max(160).allow(null, ''),
  source: Joi.string().max(100).allow(null, ''), medium: Joi.string().max(100).allow(null, ''), campaign: Joi.string().max(160).allow(null, ''),
  path: Joi.string().max(500).allow(null, ''), referrer: Joi.string().max(1000).allow(null, ''), user_agent: Joi.string().max(1000).allow(null, ''),
  device: Joi.string().valid('desktop', 'mobile', 'tablet', 'bot', 'unknown'), browser: Joi.string().max(100).allow(null, ''), os: Joi.string().max(100).allow(null, ''),
  country: Joi.string().max(100).allow(null, ''), city: Joi.string().max(100).allow(null, ''), conversion_name: Joi.string().max(120).allow(null, ''),
  value: Joi.number().min(0).max(1000000000000),
  meta: Joi.object({
    product_id: Joi.string().max(120), product_serial: Joi.string().max(120), article_id: Joi.string().max(120), article_slug: Joi.string().max(220),
    page: Joi.string().max(500), source: Joi.string().max(100), progress: Joi.number().min(0).max(100), lead_id: Joi.string().max(120),
  }).unknown(false).default({}),
  ts: Joi.date().iso(), screen: Joi.object().unknown(true), language: Joi.string().max(50), timezone: Joi.string().max(100),
}).unknown(false);

module.exports = function validateEvent(body) {
  const { error, value } = schema.validate(body, { abortEarly: false, stripUnknown: true });
  return error ? null : value;
};
