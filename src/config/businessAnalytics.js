/**
 * Commercial definitions live here so analytics cannot quietly drift away
 * from the CRM workflow. San Water currently has no fulfilled Order model;
 * a closed-won lead is therefore the strongest server-authoritative order
 * outcome available today.
 */
module.exports = Object.freeze({
  QUALIFIED_LEAD_STATUSES: ["qualified", "quote_sent", "won"],
  VALID_ORDER_LEAD_STATUSES: ["won"],
  MIN_FUNNEL_STAGE_VOLUME: 20,
  MIN_PRODUCT_VIEW_SAMPLE: 20,
  MAX_ACTIVE_INSIGHTS: 5,
  MATERIAL_PERCENTAGE_CHANGE: 10,
});
