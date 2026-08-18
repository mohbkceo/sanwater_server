const mongoose = require('mongoose')
const DocumentEntrySchema = require('./shared/documentEntry.schema')
const SeoSchema = require('./shared/seo.schema')

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
    productId: {type: String, required: true},
    family: {type: String, default: "NO-FAMILLY"},
    serialNumber: {type: String, unique: true, required: true},
    isActive: {type: Boolean, default: true},
    isEcommerce : { type: Boolean, default: false },
    tags: { type: [String], default: [] },
    gallery: { type: [String], default: [] },
    productVariants: {
        type: [ProductVariants],
        default: []
    },
    prices: {
        productPrice: {type: Number, default: 1509, min: 0},
        shippingPrice: {type: Number, default: 800, min: 0},
    },

    // --- Catalog / digital-representation fields ---
    // Stable, human-readable identifier for public product URLs
    // (/produits/.../[slug]), distinct from the internal `serialNumber`.
    slug: { type: String, unique: true, sparse: true, lowercase: true, trim: true },

    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    subcategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    // Named `collectionRef` (not `collection`) because `collection` is a
    // reserved Mongoose document pathname (it shadows the internal raw
    // MongoDB collection accessor) — Mongoose warns and it's a known footgun.
    collectionRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection', default: null },

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

function generateSlug(text) {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '-');
}

// Auto-generate a slug from the product name (falling back to the SKU/
// productId when no name is set) the first time it's missing. Never
// overwrites a slug an admin already set, so it stays stable once published
// (SEO URL rule: one canonical URL per entity).
productSchema.pre('save', async function (next) {
    if (!this.slug) {
        const base = this.name || this.productId || this.serialNumber;
        if (base) {
            let baseSlug = generateSlug(base);
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