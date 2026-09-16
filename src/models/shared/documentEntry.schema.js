const mongoose = require('mongoose');

// Shared, embeddable "document" entry used by catalog resources so
// PDFs (catalogues, technical sheets, installation guides...) are treated as
// first-class, described resources instead of mystery file paths.
// See SANWATER transformation brief, section 35 (DOCUMENTS).
const DocumentEntrySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: [
        'catalogue',
        'technical_sheet',
        'installation_guide',
        'warranty',
        'presentation',
        'other',
      ],
      default: 'other',
    },
    url: { type: String, required: true, trim: true },
    language: { type: String, trim: true, default: null },
  },
  { _id: false, timestamps: { createdAt: 'addedAt', updatedAt: false } }
);

module.exports = DocumentEntrySchema;
