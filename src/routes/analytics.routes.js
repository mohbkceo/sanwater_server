const express = require("express");
const {trackEvent, fetchAnalytics} = require("../controllers/analytics/analytics.controller");
const activityLogController = require("../controllers/analytics/activityLogController");
const { authSanWater, authorize } = require('../middlewares')
const { PERMISSIONS } = require('../config/permissions');
const router = express.Router();

router.post("/track", trackEvent);
router.get("/summary", authSanWater, authorize(PERMISSIONS.ANALYTICS.VIEW), fetchAnalytics);

// Activity Logs
router.get("/logs", authSanWater, authorize(PERMISSIONS.LOGS.VIEW), activityLogController.getLogs);



module.exports = router;