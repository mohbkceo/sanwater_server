const mongoose = require('mongoose');
const DocumentEntrySchema = require('./shared/documentEntry.schema');
const SeoSchema = require('./shared/seo.schema');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true, default: null },
    image: { type: String, default: null },

    // Self-reference: a category with a parentCategory is treated as a
    // subcategory (produits/[category]/[subcategory]).
    parentCategory: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },

    applications: { type: [String], default: [] },
    documents: { type: [DocumentEntrySchema], default: [] },
    seo: { type: SeoSchema, default: () => ({}) },

    order: { type: Number, default: 0 },
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

categorySchema.pre('save', async function (next) {
  if (this.isModified('name') || !this.slug) {
    let baseSlug = generateSlug(this.name);
    let slug = baseSlug;
    let counter = 1;

    const Category = mongoose.model('Category');
    while (await Category.findOne({ slug, _id: { $ne: this._id } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    this.slug = slug;
  }
  next();
});

module.exports = mongoose.model('Category', categorySchema);
