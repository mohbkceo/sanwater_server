const Joi = require('joi');

const documentEntrySchema = Joi.object({
    title: Joi.string().required().trim(),
    type: Joi.string().valid('catalogue', 'technical_sheet', 'installation_guide', 'warranty', 'presentation', 'other').default('other'),
    url: Joi.string().required().trim(),
    language: Joi.string().allow('', null).trim(),
});

const seoSchema = Joi.object({
    title: Joi.string().allow('', null).trim(),
    description: Joi.string().allow('', null).trim(),
    canonicalUrl: Joi.string().allow('', null).trim(),
    ogImage: Joi.string().allow('', null).trim(),
    noIndex: Joi.boolean(),
});

const categorySchema = Joi.object({
    name: Joi.string().required().min(2).max(100).trim(),
    description: Joi.string().allow('', null).trim(),
    image: Joi.string().allow('', null),
    parentCategory: Joi.string().allow('', null),
    applications: Joi.array().items(Joi.string()).default([]),
    documents: Joi.array().items(documentEntrySchema).default([]),
    seo: seoSchema.default({}),
    order: Joi.number().default(0),
    isActive: Joi.boolean().default(true),
});

const updateCategorySchema = Joi.object({
    name: Joi.string().min(2).max(100).trim(),
    description: Joi.string().allow('', null).trim(),
    image: Joi.string().allow('', null),
    parentCategory: Joi.string().allow('', null),
    applications: Joi.array().items(Joi.string()),
    documents: Joi.array().items(documentEntrySchema),
    seo: seoSchema,
    order: Joi.number(),
    isActive: Joi.boolean(),
}).min(1);

module.exports = { categorySchema, updateCategorySchema, documentEntrySchema, seoSchema };
