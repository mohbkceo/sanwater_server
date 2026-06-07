const ActivityLog = require('../../models/activityLog.model');
const responseHandler = require('../../utils/responseHandler');
const { SUCCESS } = require('../../config/messages');

const getLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, userId, action, target } = req.query;
    const query = {};
    if (userId) query.userId = userId;
    if (action) query.action = action;
    if (target) query.target = target;

    const logs = await ActivityLog.find(query)
      .populate('userId', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const count = await ActivityLog.countDocuments(query);

    responseHandler(res, SUCCESS.RESOURCES_FOUND, {
      logs,
      totalPages: Math.ceil(count / limit),
      currentPage: page
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getLogs };
