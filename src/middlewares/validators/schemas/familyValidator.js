const Joi = require('joi');
const { seoSchema } = require('./sharedValidator');

const presentationFields = {
  displayName: Joi.string().allow('').trim().max(120),
  description: Joi.string().allow('').trim().max(2000),
  image: Joi.string().allow('', null).trim(),
  order: Joi.number().integer().min(-100000).max(100000),
  isActive: Joi.boolean(),
};

const familyConfigSchema = Joi.object({
  ...presentationFields,
  seo: seoSchema,
}).min(1);

const subFamilyConfigSchema = Joi.object(presentationFields).min(1);

module.exports = { familyConfigSchema, subFamilyConfigSchema };
