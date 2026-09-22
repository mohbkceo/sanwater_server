const mongoose = require('mongoose');
const slugify = require('../utils/slugify');

const subFamilySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true, trim: true, maxlength: 140 },
    family: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
    description: { type: String, trim: true, default: '', maxlength: 2000 },
    image: { type: String, trim: true, default: null },
    order: { type: Number, integer: true, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

subFamilySchema.pre('validate', function setSlug(next) {
  if (!this.slug && this.name) this.slug = slugify(this.name);
  next();
});

subFamilySchema.index({ family: 1, slug: 1 }, { unique: true });
subFamilySchema.index({ family: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
subFamilySchema.index({ family: 1, order: 1, name: 1 });

module.exports = mongoose.model('SubFamily', subFamilySchema);
