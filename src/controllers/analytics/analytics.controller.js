const { createEvent, getAnalyticsSummary } = require("../../services/analytics.service");
const  validateEvent  = require("../../utils/analytics.validator");


  async function trackEvent(req, res) {
  try {
    const isValid = validateEvent(req.body);


    
    if (!isValid) {
      return res.sendStatus(400);
    }


    await createEvent(req.body);

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

module.exports = { trackEvent, fetchAnalytics }