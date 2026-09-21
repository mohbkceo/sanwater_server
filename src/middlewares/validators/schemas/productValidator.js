const JOI = require("joi");
const { documentEntrySchema, seoSchema } = require("./sharedValidator");

const specificationSchema = JOI.object({
    label: JOI.string().required().trim(),
    value: JOI.string().required().trim(),
});

const productFields = {
    author: JOI.string().optional(),
    name: JOI.string().min(1).max(150).optional().allow(null, ''),
    productId: JOI.string().trim().min(1).max(50),
    serialNumber: JOI.string().optional(),
    subFamily: JOI.string().hex().length(24),
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
    subFamily: productFields.subFamily.required().messages({
        'string.empty': 'Sub Family is required for catalog placement',
        'any.required': 'Sub Family is required for catalog placement',
    }),
    productId: productFields.productId.required().messages({
        'any.required': 'Product ID is required',
    }),
});

const updateProductSchema = JOI.object(productFields).min(1);

module.exports = { createProductSchema, updateProductSchema };
