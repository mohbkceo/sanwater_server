const express = require("express");
const {
  trackEvent,
  fetchAnalytics,
  fetchBusinessAnalytics,
  fetchFunnelBreakdown,
} = require("../controllers/analytics/analytics.controller");
const activityLogController = require("../controllers/analytics/activityLogController");
const { authSanWater, authorize } = require('../middlewares')
const { PERMISSIONS } = require('../config/permissions');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { track } = require('../controllers/analytics/tracking.controller');
const intelligence = require('../controllers/analytics/intelligence.controller');

router.post('/track', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false }), track);
router.get('/v2/dashboard', authSanWater, intelligence.dashboard);
router.get('/v2/attention', authSanWater, intelligence.attention);
router.get('/v2/explorer', authSanWater, intelligence.explorer);
router.get('/v2/subjects/:type/:id', authSanWater, intelligence.subject);
router.get('/v2/:domain', authSanWater, intelligence.domain);
router.get("/summary", authSanWater, authorize(PERMISSIONS.ANALYTICS.VIEW), fetchAnalytics);
router.get("/business", authSanWater, authorize(PERMISSIONS.ANALYTICS.VIEW), fetchBusinessAnalytics);
router.get("/business/funnel-breakdown", authSanWater, authorize(PERMISSIONS.ANALYTICS.VIEW), fetchFunnelBreakdown);

// Activity Logs
router.get("/logs", authSanWater, authorize(PERMISSIONS.LOGS.VIEW), activityLogController.getLogs);



module.exports = router;
