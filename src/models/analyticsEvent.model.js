const mongoose = require('mongoose');
const { BROWSER_EVENTS, BUSINESS_EVENTS, SUBJECT_TYPES } = require('../config/analytics');
const schema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  name: { type: String, required: true, enum: [...BROWSER_EVENTS, ...BUSINESS_EVENTS] },
  visitorId: { type: String, default: null }, sessionId: { type: String, default: null },
  userId: { type: mongoose.Schema.Types.ObjectId, default: null },
  subject: { type: { type: String, enum: SUBJECT_TYPES }, id: String },
  origin: { type: String, required: true, enum: ['browser', 'server', 'admin', 'system'] },
  attributionSnapshot: { type: Object, default: {} },
  properties: { type: Object, default: {} },
  occurredAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });
schema.index({ name: 1, occurredAt: -1 });
schema.index({ visitorId: 1, occurredAt: -1 });
schema.index({ sessionId: 1, occurredAt: -1 });
schema.index({ 'subject.type': 1, 'subject.id': 1, occurredAt: -1 });
module.exports = mongoose.model('AnalyticsEvent', schema);
