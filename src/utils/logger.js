const ActivityLog = require('../models/activityLog.model');
const { redact, buildUpdateDetails } = require('./audit');

const VALID_ACTIONS = new Set(['CREATE', 'UPDATE', 'DELETE', 'MOVE', 'LOGIN', 'SECURITY']);

function normalizeAction(action = '') {
  const value = String(action).trim().toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (VALID_ACTIONS.has(value)) return value;
  if (/\b(MOVE|ASSIGN|REMOVE|TRANSFER)\b/.test(value)) return 'MOVE';
  if (/\b(LOGIN|SIGN ?IN|LOGOUT)\b/.test(value)) return 'LOGIN';
  if (/\b(SECURITY|PASSWORD|PERMISSIONS?|AUTH)\b/.test(value)) return 'SECURITY';
  if (/\bDELETE|ARCHIVE\b/.test(value)) return 'DELETE';
  if (/\bCREATE\b/.test(value)) return 'CREATE';
  return 'UPDATE';
}

const logActivity = async (req, action, target, targetId, details) => {
  try {
    const safeDetails = redact(details || {});
    if (!safeDetails.summary) {
      const actionLabel = normalizeAction(action);
      const entity = safeDetails.entity || safeDetails;
      safeDetails.summary = `${actionLabel} ${target}${entity.name || entity.title || entity.email ? `: ${entity.name || entity.title || entity.email}` : ''}`;
    }
    if (!safeDetails.entity) {
      const name = safeDetails.name || safeDetails.title || safeDetails.fullName || safeDetails.familyName || safeDetails.subFamilyName || safeDetails.createdEmail || safeDetails.email;
      safeDetails.entity = { ...(name ? { name } : {}), id: String(targetId || '') };
    }
    if (!Array.isArray(safeDetails.changedFields)) safeDetails.changedFields = [];
    if (!Array.isArray(safeDetails.changes)) safeDetails.changes = [];
    await ActivityLog.create({
      userId: req.user?.uid || req.user?._id,
      action: normalizeAction(action),
      target,
      targetId: targetId == null ? undefined : String(targetId),
      details: safeDetails,
      ip: req.ip || req.headers?.['x-forwarded-for']?.split(',')[0]?.trim(),
      userAgent: req.headers?.['user-agent'],
    });
  } catch (err) {
    console.error('Failed to create activity log:', err);
  }
};

const logUpdateActivity = async (req, action, target, targetId, before, after, summary) => {
  const details = buildUpdateDetails(target, before, after, summary);
  if (!details.changes.length) return;
  return logActivity(req, action, target, targetId, details);
};

module.exports = { logActivity, logUpdateActivity, normalizeAction };
