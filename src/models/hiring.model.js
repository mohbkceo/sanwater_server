const mongoose = require('mongoose');
const { normalizeApplicationUrl, MAX_APPLICATION_URL_LENGTH } = require('../utils/applicationUrl');

const hiringSchema = new mongoose.Schema({
  title: { type: String, required: true },
  location: { type: String, required: true },
  type: { type: String, required: true }, // e.g., 'Full-time', 'Remote'
  description: { type: String, required: true },
  requirements: { type: [String] },
  benefits: { type: [String] },
  // Optional external application link (ATS, Google Form, LinkedIn…). Empty = use the built-in application form.
  applicationUrl: {
    type: String,
    trim: true,
    default: '',
    maxlength: MAX_APPLICATION_URL_LENGTH,
    validate: {
      validator: value => !value || normalizeApplicationUrl(value) === value,
      message: 'Application URL must be a valid http(s) link to a public website.',
    },
  },
  status: { type: String, enum: ['published', 'draft', 'closed'], default: 'draft' },
  publishDate: { type: Date, default: Date.now },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Hiring', hiringSchema);
