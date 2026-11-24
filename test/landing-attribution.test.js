// Campaign links, session attribution and order-level acquisition snapshots.
// Database-free: model methods are replaced in memory.
process.env.JWT_SECRET ||= "landing-attribution-test-secret";
const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const mongoose = require("mongoose");
const request = require("supertest");
const tracking = require("../src/services/analytics/tracking");
const { adaptLegacy } = require("../src/controllers/analytics/tracking.controller");
const { BROWSER_EVENTS } = require("../src/config/analytics");
const AnalyticsSession = require("../src/models/analyticsSession.model");
const AnalyticsVisitor = require("../src/models/analyticsVisitor.model");
const Order = require("../src/models/ecommerceOrder.model");
const Customer = require("../src/models/customer.model");
const { Counter } = require("../src/models/commerceSupport.model");
const orders = require("../src/services/ecommerce/order.service");
const pricing = require("../src/services/ecommerce/pricing.service");

const sift = require(require.resolve("sift", {
  paths: [path.dirname(require.resolve("mongoose"))],
})).default;

afterEach(() => mock.restoreAll());

// Builder presets (frontend src/lib/landingLinks.js) and their channels.
const presets = [
  ["instagram", "paid_social", "Paid Social"],
  ["instagram", "organic_social", "Organic Social"],
  ["facebook", "paid_social", "Paid Social"],
  ["facebook", "organic_social", "Organic Social"],
  ["tiktok", "paid_social", "Paid Social"],
  ["tiktok", "organic_social", "Organic Social"],
  ["google", "cpc", "Paid Search"],
  ["whatsapp", "messaging", "Messaging"],
  ["qr_code", "offline", "Offline"],
  ["email", "email", "Email"],
  ["influencer", "influencer", "Creator"],
];
test("every landing link preset is classified into a meaningful channel", () => {
  for (const [source, medium, channel] of presets) {
    const touch = tracking.acquisitionFrom({ acquisition: { source, medium, campaign: "summer_promotion" } });
    assert.equal(touch.channel, channel, `${source}/${medium}`);
    assert.equal(tracking.meaningfulTouch(touch), true);
  }
  // Existing rules are unchanged.
  assert.equal(tracking.classifyChannel({ clickIds: { gclid: "x" } }), "Paid Search");
  assert.equal(tracking.classifyChannel({ clickIds: {}, referrer: "https://www.google.com" }), "Organic Search");
  assert.equal(tracking.classifyChannel({ clickIds: {}, referrer: "https://example.org" }), "Referral");
  assert.equal(tracking.classifyChannel({ clickIds: {} }), "Direct");
  assert.equal(tracking.classifyChannel({ clickIds: {}, source: "partner", medium: "custom" }), "Other");
});

test("landing funnel events use the registered names and keep only non-personal properties", () => {
  for (const name of ["landing_product_viewed", "landing_variant_selected", "landing_quantity_changed", "landing_delivery_selected",
    "landing_checkout_started", "landing_checkout_attempted", "landing_checkout_succeeded", "landing_checkout_failed"]) {
    assert.ok(BROWSER_EVENTS.includes(name), name);
  }
  const identity = { visitor: { visitorId: "v", firstTouch: {}, lastTouch: {}, lastNonDirectTouch: null }, session: { sessionId: "s" } };
  assert.equal(tracking.browserEvent({ name: "landing_checkout_success", path: "/" }, identity), null);

  const body = adaptLegacy({
    name: "landing_checkout_attempted",
    path: "/products/landing_product/SW-1?utm_source=instagram",
    subject: { type: "product", id: "507f1f77bcf86cd799439011" },
    properties: {
      productId: "507f1f77bcf86cd799439011", variantId: "black-small", quantity: 2, deliveryType: "home",
      errorCategory: "stale", category: "mitigeurs", name: "Private buyer", phone: "+213555000000", address: "Rue privée 4",
    },
    acquisition: { source: "instagram", medium: "paid_social", campaign: "summer_promotion" },
  });
  const event = tracking.browserEvent({ ...body, path: tracking.normalizePath(body.path) }, identity);
  assert.deepEqual(event.properties, {
    productId: "507f1f77bcf86cd799439011", variantId: "black-small", quantity: 2, deliveryType: "home",
    errorCategory: "stale", category: "mitigeurs", path: "/products/landing_product/SW-1",
  });
  assert.doesNotMatch(JSON.stringify(event), /Private buyer|555000000|Rue privée/);
  assert.equal(adaptLegacy({ name: "page_viewed", path: "/", properties: ["x"] }).properties, undefined);
});

function cookies({ visitorId, sessionId }) {
  return {
    ...(visitorId ? { [tracking.VISITOR_COOKIE]: tracking.sign(visitorId) } : {}),
    ...(sessionId ? { [tracking.SESSION_COOKIE]: tracking.sign(sessionId) } : {}),
  };
}
const lean = (value) => ({ lean: async () => value });
function stores({ sessions = [], visitors = [] }) {
  mock.method(AnalyticsSession, "findOne", (filter) => lean(sessions.find(sift(filter)) || null));
  mock.method(AnalyticsVisitor, "findOne", (filter) => lean(visitors.find(sift(filter)) || null));
}
const campaignTouch = tracking.acquisitionFrom({ acquisition: { source: "instagram", medium: "paid_social", campaign: "summer_promotion", content: "reel_01", utmId: "cmp-42" } });
const directTouch = tracking.acquisitionFrom({ acquisition: {} });

test("attribution resolves from the live signed session and survives session expiry", async () => {
  const now = new Date("2026-11-24T12:00:00Z");
  const live = { sessionId: "s1", visitorId: "v1", lastActivityAt: new Date(now - 5 * 60000), landingPage: "/products/landing_product/SW-1", acquisition: campaignTouch };
  stores({ sessions: [live], visitors: [{ visitorId: "v1", lastNonDirectTouch: campaignTouch }] });
  const fromSession = await tracking.resolveAttribution({ cookies: cookies({ visitorId: "v1", sessionId: "s1" }) }, now);
  assert.deepEqual(fromSession, {
    source: "instagram", medium: "paid_social", campaign: "summer_promotion", content: "reel_01", term: null, utmId: "cmp-42",
    channel: "Paid Social", referrer: null, landingPage: "/products/landing_product/SW-1", model: "session", sessionId: "s1", visitorId: "v1",
  });

  const later = new Date(now.getTime() + tracking.TIMEOUT_MS + 60000);
  const expired = await tracking.resolveAttribution({ cookies: cookies({ visitorId: "v1", sessionId: "s1" }) }, later);
  assert.equal(expired.model, "last_non_direct");
  assert.equal(expired.campaign, "summer_promotion");
  assert.equal(expired.sessionId, null);
});

test("a direct return visit keeps the last non-direct campaign; untagged first visits stay direct", async () => {
  const now = new Date();
  stores({
    sessions: [{ sessionId: "s2", visitorId: "v2", lastActivityAt: now, acquisition: directTouch }, { sessionId: "s3", visitorId: "v3", lastActivityAt: now, acquisition: directTouch }],
    visitors: [{ visitorId: "v2", lastNonDirectTouch: campaignTouch }, { visitorId: "v3", lastNonDirectTouch: null }],
  });
  const returning = await tracking.resolveAttribution({ cookies: cookies({ visitorId: "v2", sessionId: "s2" }) }, now);
  assert.equal(returning.model, "last_non_direct");
  assert.equal(returning.source, "instagram");
  const direct = await tracking.resolveAttribution({ cookies: cookies({ visitorId: "v3", sessionId: "s3" }) }, now);
  assert.equal(direct.channel, "Direct");
  assert.equal(direct.campaign, null);
});

test("missing, forged or foreign cookies never produce attribution", async () => {
  stores({ sessions: [{ sessionId: "s4", visitorId: "owner", lastActivityAt: new Date(), acquisition: campaignTouch }], visitors: [] });
  assert.equal(await tracking.resolveAttribution({}), null);
  assert.equal(await tracking.resolveAttribution({ cookies: { [tracking.SESSION_COOKIE]: "s4.forged" } }), null);
  assert.equal(await tracking.resolveAttribution({ cookies: cookies({ visitorId: "intruder", sessionId: "s4" }) }), null);
  const secret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    assert.equal(await tracking.resolveAttribution({ cookies: { [tracking.SESSION_COOKIE]: "s4.x" } }), null);
  } finally {
    process.env.JWT_SECRET = secret;
  }
});

const checkoutBody = {
  items: [{ productId: "507f1f77bcf86cd799439011", variantId: "variant-1", quantity: 1 }],
  customer: { name: "Test Buyer", phone: "0555123456" },
  delivery: { wilayaCode: "16", communeCode: "1601", deliveryType: "home", address: "12 rue des Oliviers" },
  expectedQuote: "a".repeat(64),
  source: "landing",
  website: "",
};
test("public checkout attaches the trusted session snapshot and never reads attribution from the body", async () => {
  const flag = process.env.ECOMMERCE_CHECKOUT_ENABLED;
  process.env.ECOMMERCE_CHECKOUT_ENABLED = "true";
  try {
    const app = require("../src/app");
    stores({ sessions: [{ sessionId: "s5", visitorId: "v5", lastActivityAt: new Date(), landingPage: "/products/landing_product/SW-1", acquisition: campaignTouch }], visitors: [] });
    const calls = [];
    mock.method(orders, "create", async (input, key, user, context) => {
      calls.push({ input, key, user, context });
      return { orderNumber: "SW-2026-0000001", commercialStatus: "NEW", financials: { total: 1200 } };
    });
    const cookieHeader = Object.entries(cookies({ visitorId: "v5", sessionId: "s5" })).map(([k, v]) => `${k}=${v}`).join("; ");
    const tagged = await request(app).post("/ecommerce/checkout").set("Idempotency-Key", "landing-test-key-0001").set("Cookie", cookieHeader).send(checkoutBody);
    assert.equal(tagged.status, 201);
    assert.equal(tagged.body.data.orderNumber, "SW-2026-0000001");
    assert.equal(calls[0].context.attribution.campaign, "summer_promotion");
    assert.equal(calls[0].context.attribution.sessionId, "s5");
    assert.equal(calls[0].user, undefined);

    const anonymous = await request(app).post("/ecommerce/checkout").set("Idempotency-Key", "landing-test-key-0002").send(checkoutBody);
    assert.equal(anonymous.status, 201, "checkout works without analytics cookies");
    assert.equal(calls[1].context.attribution, undefined);

    const forged = await request(app).post("/ecommerce/checkout").set("Idempotency-Key", "landing-test-key-0003")
      .send({ ...checkoutBody, attribution: { source: "forged" } });
    assert.equal(forged.status, 400);
    assert.equal(calls.length, 2);
  } finally {
    if (flag === undefined) delete process.env.ECOMMERCE_CHECKOUT_ENABLED;
    else process.env.ECOMMERCE_CHECKOUT_ENABLED = flag;
  }
});

test("order creation stores the snapshot without changing idempotency, and staff views omit analytics IDs", async () => {
  const db = Object.getOwnPropertyDescriptor(mongoose.connection, "db");
  Object.defineProperty(mongoose.connection, "db", { configurable: true, value: { admin: () => ({ command: async () => ({ setName: "rs0" }) }) } });
  try {
    mock.method(mongoose.connection, "transaction", async (fn) => fn({}));
    mock.method(Order, "findOne", () => lean(null));
    mock.method(Counter, "findOneAndUpdate", async () => ({ value: 7 }));
    mock.method(Customer, "findOneAndUpdate", async () => ({ _id: new mongoose.Types.ObjectId() }));
    mock.method(Order.prototype, "save", async function save() { return this; });
    mock.method(pricing, "calculate", async () => ({
      items: [{ productId: new mongoose.Types.ObjectId(), variantId: "variant-1", name: "Mixer", sku: "SW-1", options: {}, unitPrice: 1000, quantity: 1, discount: 0, lineTotal: 1000, trackStock: false }],
      delivery: { wilayaCode: "16", communeCode: "1601", deliveryType: "home", shippingFee: 200 },
      financials: { subtotal: 1000, discount: 0, shippingFee: 200, total: 1200, currency: "DZD" },
      quoteFingerprint: "a".repeat(64),
    }));
    const attribution = { source: "instagram", medium: "paid_social", campaign: "summer_promotion", content: "reel_01", term: null, utmId: null, channel: "Paid Social", referrer: null, landingPage: "/products/landing_product/SW-1", model: "session", sessionId: "s6", visitorId: "v6" };
    const withSnapshot = await orders.create(checkoutBody, "landing-test-key-0004", undefined, { attribution });
    const without = await orders.create(checkoutBody, "landing-test-key-0004");
    assert.equal(withSnapshot.source, "landing");
    assert.equal(withSnapshot.attribution.campaign, "summer_promotion");
    assert.equal(withSnapshot.campaign, "summer_promotion");
    assert.equal(without.attribution, undefined);
    assert.equal(withSnapshot.requestHash, without.requestHash, "attribution is not part of the idempotent request");
    assert.equal(Order.schema.path("attribution").options.immutable, true);

    const presented = orders.present(withSnapshot, { role: "super_admin" });
    assert.equal(presented.attribution.campaign, "summer_promotion");
    assert.equal(presented.attribution.sessionId, undefined);
    assert.equal(presented.attribution.visitorId, undefined);
    assert.equal(presented.idempotencyKey, undefined);
  } finally {
    if (db) Object.defineProperty(mongoose.connection, "db", db);
    else delete mongoose.connection.db;
  }
});

test("order filters search by acquisition source, channel and campaign", () => {
  const staff = { role: "super_admin" };
  const rows = [
    { _id: 1, attribution: { source: "instagram", channel: "Paid Social", campaign: "summer_promotion" } },
    { _id: 2, attribution: { source: "whatsapp", channel: "Messaging", campaign: "november" } },
    { _id: 3, campaign: "summer_promotion" },
    { _id: 4 },
  ];
  const run = (query) => rows.filter(sift(orders.filters(query, staff))).map((row) => row._id);
  assert.deepEqual(run({ acquisitionSource: "instagram" }), [1]);
  assert.deepEqual(run({ channel: "Messaging" }), [2]);
  assert.deepEqual(run({ campaign: "summer_promotion" }), [1, 3]);
  assert.deepEqual(run({}), [1, 2, 3, 4]);
});
