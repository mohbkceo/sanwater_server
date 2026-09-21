const Joi = require('joi');
const { seoSchema } = require('./sharedValidator');

const slug = Joi.string().lowercase().trim().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(140);
const image = Joi.string().uri().allow('', null).trim();
const common = {
  name: Joi.string().trim().min(1).max(120),
  slug,
  description: Joi.string().allow('').trim().max(2000),
  image,
  order: Joi.number().integer().min(-100000).max(100000),
  isActive: Joi.boolean(),
};

const createFamilySchema = Joi.object({ ...common, name: common.name.required(), seo: seoSchema });
const updateFamilySchema = Joi.object({ ...common, seo: seoSchema }).min(1);
const createSubFamilySchema = Joi.object({ ...common, name: common.name.required() });
const updateSubFamilySchema = Joi.object(common).min(1);
const deleteFamilySchema = Joi.object({ password: Joi.string().required().min(1) });
const deleteSubFamilySchema = Joi.object({
  password: Joi.string().required().min(1),
  replacementSubFamilyId: Joi.string().hex().length(24).optional(),
});

module.exports = {
  createFamilySchema, updateFamilySchema, createSubFamilySchema,
  updateSubFamilySchema, deleteFamilySchema, deleteSubFamilySchema,
};
