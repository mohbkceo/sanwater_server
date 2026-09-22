const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, enum: ['CREATE', 'UPDATE', 'DELETE', 'MOVE', 'LOGIN', 'SECURITY'], required: true },
  target: { type: String, required: true }, // e.g., 'Product', 'User', 'Hiring'
  targetId: { type: String },
  details: { type: mongoose.Schema.Types.Mixed },
  ip: { type: String },
  userAgent: { type: String },
}, { timestamps: true });

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ userId: 1, createdAt: -1 });
activityLogSchema.index({ action: 1, target: 1, createdAt: -1 });
activityLogSchema.index({ target: 1, targetId: 1, createdAt: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
