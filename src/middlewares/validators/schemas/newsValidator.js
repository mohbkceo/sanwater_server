const Joi = require('joi');

const statuses = ['draft', 'review', 'scheduled', 'published', 'archived'];
const nullableUrl = Joi.string().uri({ scheme: ['http', 'https'] }).max(1500).allow('', null);
const relatedProducts = Joi.array().items(Joi.string().hex().length(24)).max(30);
const fields = {
  title: Joi.string().trim().min(2).max(200), excerpt: Joi.string().allow('', null).trim().max(600),
  content: Joi.string().max(500000), coverImage: nullableUrl, category: Joi.string().allow('', null).trim().max(100),
  tags: Joi.array().items(Joi.string().trim().max(50)).max(30), status: Joi.string().valid(...statuses),
  publishedAt: Joi.date().iso().allow(null, ''), seoTitle: Joi.string().allow('', null).trim().max(100),
  seoDescription: Joi.string().allow('', null).trim().max(300), canonicalUrl: nullableUrl,
  isFeatured: Joi.boolean(), relatedProducts,
};
const scheduleRule = (value, helpers) => {
  if (value.status === 'scheduled') {
    if (!value.publishedAt) return helpers.message({ custom: 'publishedAt is required for scheduled articles' });
    if (new Date(value.publishedAt) <= new Date()) return helpers.message({ custom: 'publishedAt must be in the future' });
  }
  return value;
};
const newsSchema = Joi.object({ ...fields, title: fields.title.required(), content: fields.content.required(), status: fields.status.default('draft') }).custom(scheduleRule).unknown(false);
const updateNewsSchema = Joi.object(fields).min(1).custom(scheduleRule).unknown(false);
const autosaveNewsSchema = Joi.object(Object.fromEntries(Object.entries(fields).filter(([key]) => !['status', 'publishedAt'].includes(key)))).min(1).unknown(false);
const bulkNewsSchema = Joi.object({ ids: Joi.array().items(Joi.string().hex().length(24)).min(1).max(50).required(), action: Joi.string().valid('publish', 'archive', 'unfeature').required() }).unknown(false);

module.exports = { newsSchema, updateNewsSchema, autosaveNewsSchema, bulkNewsSchema };
