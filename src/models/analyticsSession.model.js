const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  visitorId: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, default: null },
  startedAt: { type: Date, required: true }, lastActivityAt: { type: Date, required: true }, endedAt: Date,
  landingPage: String, acquisition: { type: Object, default: {} }, device: { type: Object, default: {} },
}, { versionKey: false });
schema.index({ visitorId: 1, startedAt: -1 });
schema.index({ 'acquisition.source': 1, startedAt: -1 });
schema.index({ 'acquisition.campaign': 1, startedAt: -1 });
module.exports = mongoose.model('AnalyticsSession', schema);
