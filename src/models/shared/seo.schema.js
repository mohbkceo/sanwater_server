const mongoose = require('mongoose');

// Shared, embeddable SEO block reused across catalog resources so
// every indexable entity can carry its own title/description/canonical
// instead of relying on one global metadata object.
const SeoSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, default: null },
    description: { type: String, trim: true, default: null },
    canonicalUrl: { type: String, trim: true, default: null },
    ogImage: { type: String, trim: true, default: null },
    noIndex: { type: Boolean, default: false },
  },
  { _id: false }
);

module.exports = SeoSchema;
