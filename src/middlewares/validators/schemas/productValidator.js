const JOI = require("joi");
const { documentEntrySchema, seoSchema } = require("./categoryValidator");

const specificationSchema = JOI.object({
    label: JOI.string().required().trim(),
    value: JOI.string().required().trim(),
});

// NOTE: not yet wired into product.routes.js — the create/update endpoints
// currently run unvalidated. Kept comprehensive and ready so validation can
// be turned on in a dedicated hardening pass once it's been checked against
// the live admin UI payloads (author/serialNumber/gallery/prices etc. were
// previously missing from this schema entirely).
const productValidatorSchema = JOI.object({
    author: JOI.string().optional(),
    name: JOI.string().min(1).max(150).optional().allow(null, ''),
    productId: JOI.string().max(50).optional(),
    serialNumber: JOI.string().optional(),
    family: JOI.string().max(50).optional(),
    isActive: JOI.boolean().optional(),
    isEcommerce: JOI.boolean().optional(),
    tags: JOI.array().items(JOI.string()).max(20).optional(),
    gallery: JOI.array().items(JOI.string()).optional(),
    productVariants: JOI.array().items(JOI.object({
        variantType: JOI.string().optional(),
        variants: JOI.array().items(JOI.object({ variantData: JOI.string().allow('') })).optional(),
    })).optional(),
    prices: JOI.object({
        productPrice: JOI.number().min(0).optional(),
        shippingPrice: JOI.number().min(0).optional(),
    }).optional(),

    // catalog / digital-representation fields
    slug: JOI.string().lowercase().trim().optional(),
    category: JOI.string().allow(null, '').optional(),
    subcategory: JOI.string().allow(null, '').optional(),
    collection: JOI.string().allow(null, '').optional(),
    shortDescription: JOI.string().allow('', null).max(300).optional(),
    description: JOI.string().allow('', null).optional(),
    material: JOI.string().allow('', null).optional(),
    finishes: JOI.array().items(JOI.string()).optional(),
    dimensions: JOI.string().allow('', null).optional(),
    installation: JOI.string().allow('', null).optional(),
    applications: JOI.array().items(JOI.string()).optional(),
    specifications: JOI.array().items(specificationSchema).optional(),
    documents: JOI.array().items(documentEntrySchema).optional(),
    relatedProducts: JOI.array().items(JOI.string()).optional(),
    status: JOI.string().valid('draft', 'published', 'archived').optional(),
    seo: seoSchema.optional(),
});

module.exports = { productValidatorSchema };
