const mongoose = require('mongoose');

const hiringSchema = new mongoose.Schema({
  title: { type: String, required: true },
  location: { type: String, required: true },
  type: { type: String, required: true }, // e.g., 'Full-time', 'Remote'
  description: { type: String, required: true },
  requirements: { type: [String] },
  benefits: { type: [String] },
  status: { type: String, enum: ['published', 'draft', 'closed'], default: 'draft' },
  publishDate: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Hiring', hiringSchema);
