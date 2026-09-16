const mongoose = require('mongoose');
const SeoSchema = require('./shared/seo.schema');

const subFamilyConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, uppercase: true },
    displayName: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    image: { type: String, trim: true, default: null },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

const familyConfigSchema = new mongoose.Schema(
  {
    familyKey: { type: String, required: true, unique: true, trim: true },
    displayName: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    image: { type: String, trim: true, default: null },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    subFamilies: { type: [subFamilyConfigSchema], default: [] },
    seo: { type: SeoSchema, default: () => ({}) },
  },
  { timestamps: true },
);

module.exports = mongoose.model('FamilyConfig', familyConfigSchema);
