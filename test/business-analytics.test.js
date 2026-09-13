const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyProducts,
  comparison,
  resolvePeriod,
  safeRate,
} = require("../src/services/analytics.helpers");
const { buildFunnel, buildKpis } = require("../src/services/businessAnalytics.service");
const authorize = require("../src/middlewares/authentication/authorize");
const { PERMISSIONS } = require("../src/config/permissions");

test("period comparison uses the immediately preceding equivalent range", () => {
  const period = resolvePeriod({ from: "2026-08-01", to: "2026-08-15" });
  assert.equal(period.from.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(period.to.toISOString(), "2026-08-15T23:59:59.999Z");
  assert.equal(period.comparisonFrom.toISOString(), "2026-07-17T00:00:00.000Z");
  assert.equal(period.comparisonTo.toISOString(), "2026-07-31T23:59:59.999Z");
});

test("invalid or reversed date ranges are rejected", () => {
  assert.throws(() => resolvePeriod({ from: "not-a-date", to: "2026-08-15" }), /Invalid analytics date range/);
  assert.throws(() => resolvePeriod({ from: "2026-08-16", to: "2026-08-15" }), /must be before/);
});

test("comparison never emits Infinity or NaN", () => {
  assert.deepEqual(comparison(0, 0), {
    current: 0,
    previous: 0,
    absoluteChange: 0,
    percentageChange: 0,
    changeState: "no_change",
  });
  assert.equal(comparison(12, 0).percentageChange, null);
  assert.equal(comparison(12, 0).changeState, "new");
  assert.equal(comparison(0, 12).percentageChange, -100);
});

test("conversion helpers distinguish missing denominator from zero conversion", () => {
  assert.equal(safeRate(3, 0), null);
  assert.equal(safeRate(0, 10), 0);
  assert.equal(safeRate(3, 12), 25);
});

test("business KPI response keeps all comparison fields normalized", () => {
  const current = { revenue: 1200, orders: 3, qualifiedLeads: 12, visitorToLeadRate: 4, leadToOrderRate: 25, averageOrderValue: 400 };
  const previous = { revenue: 1000, orders: 2, qualifiedLeads: 10, visitorToLeadRate: 5, leadToOrderRate: 20, averageOrderValue: 500 };
  const kpis = buildKpis(current, previous);
  assert.equal(kpis.revenue.absoluteChange, 200);
  assert.equal(kpis.revenue.percentageChange, 20);
  assert.equal(kpis.visitorToLead.percentageChange, -20);
  assert.equal(kpis.leadToOrder.percentageChange, 25);
  const empty = buildKpis(
    { revenue: 0, orders: 0, qualifiedLeads: 0, visitorToLeadRate: null, leadToOrderRate: null, averageOrderValue: null },
    { revenue: 0, orders: 0, qualifiedLeads: 0, visitorToLeadRate: 2, leadToOrderRate: 5, averageOrderValue: 100 },
  );
  assert.equal(empty.visitorToLead.current, null);
  assert.equal(empty.averageOrderValue.changeState, "unavailable");
});

test("funnel uses unique-stage totals and volume safeguards for the biggest leak", () => {
  const funnel = buildFunnel(
    { page_view: 1000, product_view: 500, product_inquiry_started: 100, lead_submitted: 40 },
    { page_view: 900, product_view: 450, product_inquiry_started: 120, lead_submitted: 50 },
    10,
    12,
  );
  assert.equal(funnel.stages[1].conversionRate, 50);
  assert.equal(funnel.stages[2].dropOffRate, 80);
  assert.equal(funnel.biggestLeak.from, "Relevant Visitors");
  assert.equal(funnel.biggestLeak.to, "Product View");
  assert.equal(funnel.biggestLeak.lostEntities, 500);
});

test("product classifications use the current distribution and suppress tiny samples", () => {
  const classified = classifyProducts([
    { productId: "a", uniqueViews: 100, orderConversionRate: 10 },
    { productId: "b", uniqueViews: 30, orderConversionRate: 8 },
    { productId: "c", uniqueViews: 100, orderConversionRate: 2 },
    { productId: "d", uniqueViews: 30, orderConversionRate: 1 },
    { productId: "tiny", uniqueViews: 3, orderConversionRate: 33 },
  ]);
  assert.deepEqual(classified.map((item) => item.classification), [
    "winner",
    "hidden_opportunity",
    "conversion_problem",
    "low_priority",
    "insufficient_data",
  ]);
});

test("business analytics permission is enforced server-side", () => {
  const analyticsView = authorize(PERMISSIONS.ANALYTICS.VIEW);
  assert.throws(() => analyticsView({ user: { role: "admin", permissions: [] } }, {}, () => {}));
  let allowed = false;
  analyticsView({ user: { role: "admin", permissions: [PERMISSIONS.ANALYTICS.VIEW] } }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
});
