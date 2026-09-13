const { createEvent, getAnalyticsSummary } = require("../../services/analytics.service");
const {
  getBusinessAnalytics,
  getFunnelBreakdown,
} = require("../../services/businessAnalytics.service");
const  validateEvent  = require("../../utils/analytics.validator");


  async function trackEvent(req, res) {
  try {
    const event = validateEvent(req.body);
    if (!event) {
      return res.sendStatus(400);
    }
    await createEvent(event);

    return res.sendStatus(204);

  } catch (error) {
    
    return res.sendStatus(204);
  }
}

  async function fetchAnalytics(req, res) {
  try {
    const { from, to } = req.query;

    const data = await getAnalyticsSummary({ from, to });

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch analytics"
    });
  }
}

async function fetchBusinessAnalytics(req, res) {
  try {
    const data = await getBusinessAnalytics(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode === 400 ? error.message : "Failed to fetch business analytics",
    });
  }
}

async function fetchFunnelBreakdown(req, res) {
  try {
    const data = await getFunnelBreakdown(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode === 400 ? error.message : "Failed to fetch funnel breakdown",
    });
  }
}

module.exports = { trackEvent, fetchAnalytics, fetchBusinessAnalytics, fetchFunnelBreakdown }
