const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  visitorId: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, default: null },
  firstSeenAt: { type: Date, required: true }, lastSeenAt: { type: Date, required: true },
  firstTouch: { type: Object, default: null }, lastTouch: { type: Object, default: null },
  lastNonDirectTouch: { type: Object, default: null },
}, { versionKey: false });
schema.index({ lastSeenAt: -1 });
module.exports = mongoose.model('AnalyticsVisitor', schema);
