const Joi = require('joi');

const newsSchema = Joi.object({
    title: Joi.string().required().trim(),
    excerpt: Joi.string().allow('', null).trim(),
    content: Joi.string().required(),
    coverImage: Joi.string().allow('', null),
    category: Joi.string().allow('', null).trim(),
    tags: Joi.array().items(Joi.string()).default([]),
    status: Joi.string().valid('draft', 'published', 'scheduled').default('draft'),
    publishedAt: Joi.date().allow(null),
    seoTitle: Joi.string().allow('', null).trim(),
    seoDescription: Joi.string().allow('', null).trim(),
    canonicalUrl: Joi.string().allow('', null).trim(),
    isFeatured: Joi.boolean().default(false)
});

const updateNewsSchema = Joi.object({
    title: Joi.string().trim(),
    excerpt: Joi.string().allow('', null).trim(),
    content: Joi.string(),
    coverImage: Joi.string().allow('', null),
    category: Joi.string().allow('', null).trim(),
    tags: Joi.array().items(Joi.string()),
    status: Joi.string().valid('draft', 'published', 'scheduled'),
    publishedAt: Joi.date().allow(null),
    seoTitle: Joi.string().allow('', null).trim(),
    seoDescription: Joi.string().allow('', null).trim(),
    canonicalUrl: Joi.string().allow('', null).trim(),
    isFeatured: Joi.boolean()
}).min(1);

module.exports = {
    newsSchema,
    updateNewsSchema
};
