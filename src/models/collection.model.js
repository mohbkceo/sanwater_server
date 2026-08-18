const mongoose = require('mongoose');
const DocumentEntrySchema = require('./shared/documentEntry.schema');
const SeoSchema = require('./shared/seo.schema');

const collectionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true, default: null },
    image: { type: String, default: null },

    documents: { type: [DocumentEntrySchema], default: [] },
    seo: { type: SeoSchema, default: () => ({}) },

    // Curated subset of the collection's products for homepage/collection-page
    // highlights. Products are still linked to a collection via
    // Product.collection — this is only for manual featuring.
    featuredProducts: { type: [mongoose.Schema.Types.ObjectId], ref: 'ProductSchema', default: [] },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

function generateSlug(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

collectionSchema.pre('save', async function (next) {
  if (this.isModified('name') || !this.slug) {
    let baseSlug = generateSlug(this.name);
    let slug = baseSlug;
    let counter = 1;

    const Collection = mongoose.model('Collection');
    while (await Collection.findOne({ slug, _id: { $ne: this._id } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    this.slug = slug;
  }
  next();
});

module.exports = mongoose.model('Collection', collectionSchema);
