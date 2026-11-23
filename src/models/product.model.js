const mongoose = require('mongoose')
const DocumentEntrySchema = require('./shared/documentEntry.schema')
const SeoSchema = require('./shared/seo.schema')
const slugify = require('../utils/slugify')
const variantSchemas = require('./shared/productVariants.schema');

const VariantValue  = new mongoose.Schema({
    variantData: {type: String},
})
const ProductVariants = new mongoose.Schema({
    variantType: {type: String, default: 'color'},
    variants : {
        type: [VariantValue],
        default: []
    }
})

// label/value pairs so the admin can describe arbitrary technical
// specifications (e.g. { label: 'Pression', value: '1-5 bar' }) without a
// rigid predefined attribute list.
const SpecificationEntry = new mongoose.Schema({
    label: { type: String, required: true, trim: true },
    value: { type: String, required: true, trim: true },
}, { _id: false })

const productSchema = new mongoose.Schema({
    author: {type: String, required: true},
    name: {type: String, default: null},
    productId: { type: String, required: true, trim: true, maxlength: 50 },
    family: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', default: null, index: true },
    subFamily: { type: mongoose.Schema.Types.ObjectId, ref: 'SubFamily', default: null, index: true },
    serialNumber: {type: String, unique: true, required: true},
    isActive: {type: Boolean, default: true},
    isEcommerce : { type: Boolean, default: false },
    salesMode: { type: String, enum: ['catalog', 'ecommerce', 'both'], default: undefined },
    commerce: { type: require('./shared/commerce.schema'), default: undefined },
    tags: { type: [String], default: [] },
    gallery: { type: [String], default: [] },
    variantSchemaVersion: { type: Number, enum: [2], default: undefined },
    variantOptions: { type: [variantSchemas.option], default: undefined },
    variantsV2: { type: [variantSchemas.variant], default: undefined },
    legacyVariantSnapshot: { type: mongoose.Schema.Types.Mixed, default: undefined },
    catalogRevision: { type: Number, default: 0, min: 0 },
    productVariants: {
        type: [ProductVariants],
        default: []
    },
    prices: {
        productPrice: {type: Number, default: 1509, min: 0},
        // Legacy read-only field retained for old documents; checkout ignores it.
        shippingPrice: {type: Number, min: 0},
    },

    // --- Digital representation fields ---
    // Stable, human-readable identifier for public product URLs
    // (/produits/.../[slug]), distinct from the internal `serialNumber`.
    slug: { type: String, unique: true, sparse: true, lowercase: true, trim: true },

    shortDescription: { type: String, trim: true, default: null },
    description: { type: String, trim: true, default: null },

    material: { type: String, trim: true, default: null },
    finishes: { type: [String], default: [] },
    dimensions: { type: String, trim: true, default: null },
    installation: { type: String, trim: true, default: null },
    applications: { type: [String], default: [] },
    specifications: { type: [SpecificationEntry], default: [] },

    documents: { type: [DocumentEntrySchema], default: [] },
    relatedProducts: { type: [mongoose.Schema.Types.ObjectId], ref: 'ProductSchema', default: [] },

    // Editorial/publication state, independent from `isActive` (which the
    // storefront/e-commerce query logic already relies on).
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },

    seo: { type: SeoSchema, default: () => ({}) },

}, {timestamps: true})
productSchema.index({ 'commerce.variants.sku': 1 }, { unique: true, partialFilterExpression: { 'commerce.variants.sku': { $type: 'string' } } });
productSchema.index({ updatedAt: -1, _id: -1 });
productSchema.index({ status: 1, isActive: 1, isEcommerce: 1, updatedAt: -1 });
productSchema.pre('validate', function validateStructuredVariants(next) {
    try {
        if (this.variantSchemaVersion === 2) {
            const { validateVariants, commerceProjection } = require('../services/products/variants');
            validateVariants(this.variantOptions || [], this.variantsV2 || [], this.gallery);
            if (this.variantsV2?.length) this.commerce = commerceProjection(this.toObject());
        }
        next();
    } catch (error) { next(error); }
});

// Auto-generate a slug from the product name (falling back to the SKU/
// productId when no name is set) the first time it's missing. Never
// overwrites a slug an admin already set, so it stays stable once published
// (SEO URL rule: one canonical URL per entity).
productSchema.pre('save', async function (next) {
    if (!this.slug) {
        const baseSlug = [this.name, this.productId, this.serialNumber]
            .filter(Boolean)
            .map(slugify)
            .find(Boolean);
        if (baseSlug) {
            let slug = baseSlug;
            let counter = 1;

            const Product = mongoose.model('ProductSchema');
            while (await Product.findOne({ slug, _id: { $ne: this._id } })) {
                slug = `${baseSlug}-${counter}`;
                counter++;
            }
            this.slug = slug;
        }
    }
    next();
});

module.exports = mongoose.model('ProductSchema', productSchema)
