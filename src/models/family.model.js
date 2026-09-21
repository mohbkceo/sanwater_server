const mongoose = require('mongoose');
const SeoSchema = require('./shared/seo.schema');
const slugify = require('../utils/slugify');

const familySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, default: '', maxlength: 2000 },
    image: { type: String, trim: true, default: null },
    order: { type: Number, integer: true, default: 0 },
    isActive: { type: Boolean, default: true },
    seo: { type: SeoSchema, default: () => ({}) },
    legacyKey: { type: String, trim: true, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

familySchema.pre('validate', function setSlug(next) {
  if (!this.slug && this.name) this.slug = slugify(this.name);
  next();
});

familySchema.index({ order: 1, name: 1 });

module.exports = mongoose.model('Family', familySchema);
