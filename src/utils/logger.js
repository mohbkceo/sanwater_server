const ActivityLog = require('../models/activityLog.model');

const logActivity = async (req, action, target, targetId, details) => {
  try {
    await ActivityLog.create({
      userId: req.user.uid,
      action,
      target,
      targetId,
      details,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
  } catch (err) {
    console.error('Failed to create activity log:', err);
  }
};

module.exports = { logActivity };
