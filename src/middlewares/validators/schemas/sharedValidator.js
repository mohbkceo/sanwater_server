const Joi = require('joi');

const documentEntrySchema = Joi.object({
  title: Joi.string().required().trim(),
  type: Joi.string()
    .valid('catalogue', 'technical_sheet', 'installation_guide', 'warranty', 'presentation', 'other')
    .default('other'),
  url: Joi.string().required().trim(),
  language: Joi.string().allow('', null).trim(),
  addedAt: Joi.date().optional(),
});

const seoSchema = Joi.object({
  title: Joi.string().allow('', null).trim(),
  description: Joi.string().allow('', null).trim(),
  canonicalUrl: Joi.string().allow('', null).trim(),
  ogImage: Joi.string().allow('', null).trim(),
  noIndex: Joi.boolean(),
});

module.exports = { documentEntrySchema, seoSchema };
