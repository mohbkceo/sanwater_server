const Joi = require('joi');
const { documentEntrySchema, seoSchema } = require('./categoryValidator');

const collectionSchema = Joi.object({
    name: Joi.string().required().min(2).max(100).trim(),
    description: Joi.string().allow('', null).trim(),
    image: Joi.string().allow('', null),
    documents: Joi.array().items(documentEntrySchema).default([]),
    featuredProducts: Joi.array().items(Joi.string()).default([]),
    seo: seoSchema.default({}),
    isActive: Joi.boolean().default(true),
});

const updateCollectionSchema = Joi.object({
    name: Joi.string().min(2).max(100).trim(),
    description: Joi.string().allow('', null).trim(),
    image: Joi.string().allow('', null),
    documents: Joi.array().items(documentEntrySchema),
    featuredProducts: Joi.array().items(Joi.string()),
    seo: seoSchema,
    isActive: Joi.boolean(),
}).min(1);

module.exports = { collectionSchema, updateCollectionSchema };
