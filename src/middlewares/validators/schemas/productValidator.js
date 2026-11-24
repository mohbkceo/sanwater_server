const JOI = require("joi");
const { documentEntrySchema, seoSchema } = require("./sharedValidator");

const specificationSchema = JOI.object({
    label: JOI.string().required().trim(),
    value: JOI.string().required().trim(),
});

const productFields = {
    catalogRevision: JOI.number().integer().min(0),
    variantSchemaVersion: JOI.number().valid(2),
    variantOptions: JOI.array().max(4).items(JOI.object({
        id: JOI.string().pattern(/^[\w-]{1,100}$/).required(), name: JOI.string().trim().max(100).required(),
        type: JOI.string().valid('color', 'size', 'material', 'finish', 'custom').required(),
        values: JOI.array().min(1).max(20).items(JOI.object({ id: JOI.string().pattern(/^[\w-]{1,100}$/).required(), label: JOI.string().trim().max(100).required(), swatchHex: JOI.string().pattern(/^#[0-9a-f]{6}$/i) })).required(),
    })),
    variantsV2: JOI.array().max(100).items(JOI.object({
        id: JOI.string().pattern(/^[\w-]{1,100}$/).required(), sku: JOI.string().pattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/).required(),
        selections: JOI.array().max(4).items(JOI.object({ optionId: JOI.string().required(), valueId: JOI.string().required() })).required(),
        priceOverride: JOI.number().min(0).precision(2).strict().allow(null).required(), stockQuantity: JOI.number().integer().min(0).max(Number.MAX_SAFE_INTEGER).required(),
        trackInventory: JOI.boolean().strict().required(), isAvailable: JOI.boolean().strict().required(), imageUrl: JOI.string().uri({ scheme: ['https', 'http'] }).allow(null, ''), sortOrder: JOI.number().integer().min(0),
    })),
    family: JOI.string().hex().length(24).allow(null, '').optional(),
    subFamily: JOI.string().hex().length(24).allow(null, '').optional(),
    author: JOI.string().optional(),
    name: JOI.string().min(1).max(150).optional().allow(null, ''),
    productId: JOI.string().trim().min(1).max(50),
    serialNumber: JOI.string().optional(),
    isActive: JOI.boolean().optional(),
    isEcommerce: JOI.boolean().optional(),
    // Explicit sales channel from the product editor. "both" stays a stored
    // legacy value and is not selectable here.
    salesMode: JOI.string().valid('catalog', 'ecommerce').optional(),
    tags: JOI.array().items(JOI.string()).max(20).optional(),
    gallery: JOI.array().items(JOI.string()).max(30).optional(),
    productVariants: JOI.array().items(JOI.object({
        variantType: JOI.string().optional(),
        variants: JOI.array().items(JOI.object({ variantData: JOI.string().allow('') })).optional(),
    })).optional(),
    prices: JOI.object({
        productPrice: JOI.number().min(0).precision(2).strict().optional(),
        // Accept legacy API payloads, but never use this for shipping quotes.
        shippingPrice: JOI.number().min(0).optional(),
    }).optional(),

    slug: JOI.string().lowercase().trim().optional(),
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
};

const createProductSchema = JOI.object({
    ...productFields,
    productId: productFields.productId.required().messages({
        'any.required': 'Product ID is required',
    }),
});

const updateProductSchema = JOI.object(productFields).min(1);

module.exports = { createProductSchema, updateProductSchema };
