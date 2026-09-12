const mongoose = require('mongoose');

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'quote_sent', 'won', 'lost', 'archived'];
const LOST_REASONS = ['price', 'no_response', 'competitor', 'not_interested', 'invalid_lead', 'other'];

const NoteSchema = new mongoose.Schema({
  content: { type: String, required: true, trim: true, maxlength: 4000 },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const StatusHistorySchema = new mongoose.Schema({
  previousStatus: { type: String, enum: LEAD_STATUSES, default: null },
  newStatus: { type: String, enum: LEAD_STATUSES, required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  changedAt: { type: Date, default: Date.now },
  reason: { type: String, trim: true, default: null },
}, { _id: true });

const AssignmentHistorySchema = new mongoose.Schema({
  previousAssignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  newAssignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  changedAt: { type: Date, default: Date.now },
}, { _id: true });

const leadSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  phone: { type: String, required: true, trim: true, maxlength: 30 },
  email: { type: String, trim: true, lowercase: true, default: null, maxlength: 254 },
  company: { type: String, trim: true, default: null, maxlength: 160 },
  wilaya: { type: String, required: true, trim: true, maxlength: 80 },
  message: { type: String, trim: true, default: null, maxlength: 3000 },

  source: { type: String, trim: true, default: null, maxlength: 100, index: true },
  medium: { type: String, trim: true, default: null, maxlength: 100 },
  campaign: { type: String, trim: true, default: null, maxlength: 160 },
  referrer: { type: String, trim: true, default: null, maxlength: 1000 },
  landingPage: { type: String, trim: true, default: null, maxlength: 1000 },
  pagePath: { type: String, trim: true, default: null, maxlength: 500 },

  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductSchema', required: true, index: true },
  productSerialNumber: { type: String, required: true, trim: true, index: true },
  productName: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1, max: 100000 },

  status: { type: String, enum: LEAD_STATUSES, default: 'new', index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  estimatedValue: { type: Number, min: 0, default: 0 },
  finalValue: { type: Number, min: 0, default: null },
  notes: { type: [NoteSchema], default: [] },
  nextFollowUpAt: { type: Date, default: null, index: true },
  lastContactAt: { type: Date, default: null },
  lostReason: { type: String, enum: LOST_REASONS, default: null },
  lostExplanation: { type: String, trim: true, default: null, maxlength: 1000 },
  orderReference: { type: String, trim: true, default: null, maxlength: 120 },
  statusHistory: { type: [StatusHistorySchema], default: [] },
  assignmentHistory: { type: [AssignmentHistorySchema], default: [] },

  visitorId: { type: String, trim: true, default: null, maxlength: 160 },
  sessionId: { type: String, trim: true, default: null, maxlength: 160 },
}, { timestamps: true });

leadSchema.index({ createdAt: -1 });
leadSchema.index({ status: 1, createdAt: -1 });
leadSchema.index({ assignedTo: 1, status: 1 });
leadSchema.index({ fullName: 'text', phone: 'text', email: 'text', company: 'text', productName: 'text' });

module.exports = mongoose.model('Lead', leadSchema);
module.exports.LEAD_STATUSES = LEAD_STATUSES;
module.exports.LOST_REASONS = LOST_REASONS;
