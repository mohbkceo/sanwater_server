const express = require("express");
const {trackEvent, fetchAnalytics} = require("../controllers/analytics/analytics.controller");
const { authSanWater } = require('../middlewares')
const router = express.Router();

router.post("/track", trackEvent);
router.get("/summary", authSanWater, fetchAnalytics);



module.exports = router;