const mongoose = require('mongoose');

const newsRevisionSchema = new mongoose.Schema({
  article: { type: mongoose.Schema.Types.ObjectId, ref: 'News', required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  editor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, enum: ['manual_save', 'publish', 'substantial_update', 'restore'], default: 'manual_save' },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

newsRevisionSchema.index({ article: 1, version: -1 }, { unique: true });

module.exports = mongoose.model('NewsRevision', newsRevisionSchema);
