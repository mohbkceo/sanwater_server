const express = require("express");
const {trackEvent, fetchAnalytics} = require("../controllers/analytics/analytics.controller");
const activityLogController = require("../controllers/analytics/activityLogController");
const { authSanWater, authorize } = require('../middlewares')
const router = express.Router();

router.post("/track", trackEvent);
router.get("/summary", authSanWater, fetchAnalytics);

// Activity Logs
router.get("/logs", authSanWater, authorize('admin'), activityLogController.getLogs);



module.exports = router;