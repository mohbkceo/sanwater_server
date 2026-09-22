const ActivityLog = require('../../models/activityLog.model');
const responseHandler = require('../../utils/responseHandler');
const { SUCCESS } = require('../../config/messages');
const { normalizeAction } = require('../../utils/logger');
const User = require('../../models/user.model');

const getLogs = async (req, res, next) => {
  try {
    const { page: requestedPage = 1, limit: requestedLimit = 20, userId, action, target, targetId, search, from, to } = req.query;
    const page = Math.max(1, Number(requestedPage) || 1);
    const limit = Math.min(100, Math.max(1, Number(requestedLimit) || 20));
    const query = {};
    if (userId) query.userId = userId;
    if (action) {
      const normalized = normalizeAction(action);
      const legacyActions = {
        CREATE: ['CREATE FAMILY', 'CREATE SUB_FAMILY'],
        UPDATE: ['UPDATE FAMILY', 'UPDATE SUB_FAMILY', 'UPDATE_STATUS', 'BULK_UPDATE', 'RESTORE_REVISION', 'ADD_NOTE'],
        DELETE: ['DELETE FAMILY', 'DELETE SUB_FAMILY', 'ARCHIVE'],
        MOVE: ['ASSIGN', 'ASSIGN PRODUCTS TO SUB_FAMILY', 'REMOVE PRODUCTS FROM SUB_FAMILY', 'MOVE PRODUCTS BETWEEN SUB_FAMILIES'],
        SECURITY: ['PERMISSIONS_CHANGE'],
      };
      query.action = { $in: [normalized, ...(legacyActions[normalized] || [])] };
    }
    if (target) query.target = target;
    if (targetId) query.targetId = String(targetId);
    if (from || to) {
      query.createdAt = {};
      if (from && !Number.isNaN(Date.parse(from))) query.createdAt.$gte = new Date(from);
      if (to && !Number.isNaN(Date.parse(to))) {
        const end = new Date(to);
        if (/^\d{4}-\d{2}-\d{2}$/.test(to)) end.setUTCHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
      if (!Object.keys(query.createdAt).length) delete query.createdAt;
    }
    if (search && String(search).trim()) {
      const safe = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 120);
      const rx = new RegExp(safe, 'i');
      query.$or = [
        { targetId: rx }, { 'details.summary': rx }, { 'details.entity.name': rx },
        { 'details.entity.title': rx }, { 'details.entity.email': rx },
        { 'details.name': rx }, { 'details.title': rx }, { 'details.familyName': rx },
        { 'details.entity.serialNumber': rx }, { 'details.changes.label': rx },
      ];
    }

    const [logs, count, userIds, targets] = await Promise.all([
      ActivityLog.find(query)
      .populate('userId', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit)
      .exec(),
      ActivityLog.countDocuments(query),
      ActivityLog.distinct('userId'),
      ActivityLog.distinct('target'),
    ]);
    const admins = await User.find({ _id: { $in: userIds } }).select('fullName email').sort({ fullName: 1 }).lean();

    responseHandler(res, SUCCESS.RESOURCES_FOUND, {
      logs,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      totalItems: count,
      limit,
      admins,
      resources: targets.filter(Boolean).sort(),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getLogs };
