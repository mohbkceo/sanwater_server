const mongoose = require('mongoose');
const STAGES = ['applied', 'screening', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];
const stageHistory = new mongoose.Schema({ stage: { type: String, enum: STAGES, required: true }, changedAt: { type: Date, default: Date.now }, changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null } });
const note = new mongoose.Schema({ content: { type: String, required: true, maxlength: 4000 }, author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, createdAt: { type: Date, default: Date.now } });
const schema = new mongoose.Schema({
  hiringId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hiring', required: true, index: true },
  candidate: {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 30 },
  },
  message: { type: String, trim: true, maxlength: 3000 },
  source: { type: String, maxlength: 100 }, medium: { type: String, maxlength: 100 }, campaign: { type: String, maxlength: 160 },
  visitorId: String, sessionId: String,
  stage: { type: String, enum: STAGES, default: 'applied', index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  stageHistory: { type: [stageHistory], default: [] }, notes: { type: [note], default: [] },
}, { timestamps: true });
schema.index({ hiringId: 1, stage: 1, createdAt: -1 });
schema.index({ assignedTo: 1, stage: 1 });
schema.index({ stage: 1, updatedAt: -1 });
module.exports = mongoose.model('Application', schema);
module.exports.STAGES = STAGES;
