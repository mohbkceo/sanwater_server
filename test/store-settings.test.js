// Admin-editable E-commerce store settings. Database-free: the settings
// document, users and activity log live in memory.
process.env.JWT_SECRET ||= "store-settings-test-secret";
process.env.PUBLIC_KEY ||= "test";
const { test, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const mongoose = require("mongoose");
const request = require("supertest");
const { CommerceSettings } = require("../src/models/commerceSupport.model");
const User = require("../src/models/user.model");
const ActivityLog = require("../src/models/activityLog.model");
const TokenServices = require("../src/services/tokenServices");
const settings = require("../src/services/ecommerce/settings.service");
const orders = require("../src/services/ecommerce/order.service");
const { createQuotation } = require("../src/controllers/quotations/quotationController");
// Load the app (and compile every model) before the tests fake a live connection.
const app = require("../src/app");

const sift = require(require.resolve("sift", { paths: [path.dirname(require.resolve("mongoose"))] })).default;
const ids = { manager: "507f1f77bcf86cd799439021", viewer: "507f1f77bcf86cd799439022" };
const users = {
  [ids.manager]: { _id: ids.manager, fullName: "Store Manager", role: "admin", permissions: ["ecommerce.view", "ecommerce.settings"] },
  [ids.viewer]: { _id: ids.viewer, fullName: "Order Viewer", role: "admin", permissions: ["ecommerce.view"] },
};
const env = { checkout: process.env.ECOMMERCE_CHECKOUT_ENABLED, partial: process.env.ECOMMERCE_PARTIAL_PAYMENTS };
let stored;
let logs;
let transactions;
const dbDescriptor = Object.getOwnPropertyDescriptor(mongoose.connection, "db");
const connected = (value) => Object.defineProperty(mongoose.connection, "readyState", { configurable: true, get: () => value });

function apply(doc, update) {
  const next = { ...(doc || { _id: "store" }) };
  Object.assign(next, update.$set);
  next.revision = (next.revision || 0) + update.$inc.revision;
  next.history = [...(next.history || []), ...update.$push.history.$each].slice(update.$push.history.$slice);
  next.updatedAt = new Date("2026-11-24T21:00:00Z");
  return next;
}
beforeEach(() => {
  stored = null;
  logs = [];
  transactions = true;
  delete process.env.ECOMMERCE_CHECKOUT_ENABLED;
  delete process.env.ECOMMERCE_PARTIAL_PAYMENTS;
  Object.defineProperty(mongoose.connection, "db", { configurable: true, value: { admin: () => ({ command: async () => (transactions ? { setName: "rs0" } : {}) }) } });
  connected(1);
  mock.method(CommerceSettings, "findById", () => ({ lean: async () => stored }));
  mock.method(CommerceSettings, "findOneAndUpdate", async (filter, update, options) => {
    if (stored && sift(filter)(stored)) return (stored = apply(stored, update));
    if (!stored && options.upsert) return (stored = apply(null, update));
    if (options.upsert) throw Object.assign(new Error("duplicate key"), { code: 11000 });
    return null;
  });
  mock.method(User, "findById", (id) => ({ select: () => ({ lean: async () => users[String(id)] || null }) }));
  mock.method(ActivityLog, "create", async (entry) => { logs.push(entry); return entry; });
  mock.method(TokenServices.prototype, "verify", async function verify() { return { uid: this.token, role: "admin", type: "access" }; });
});
afterEach(() => {
  mock.restoreAll();
  if (dbDescriptor) Object.defineProperty(mongoose.connection, "db", dbDescriptor);
  else delete mongoose.connection.db;
  delete mongoose.connection.readyState;
  for (const [key, value] of [["ECOMMERCE_CHECKOUT_ENABLED", env.checkout], ["ECOMMERCE_PARTIAL_PAYMENTS", env.partial]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const as = (method, url, uid) => request(app)[method](url)
  .set("Cookie", `access_token=${uid}; csrf_token=settings-test`).set("X-CSRF-Token", "settings-test");

test("environment variables stay the default until an admin saves a value", async () => {
  process.env.ECOMMERCE_CHECKOUT_ENABLED = "true";
  assert.deepEqual(await settings.current(), {
    checkoutEnabled: true, partialPaymentsEnabled: false,
    sources: { checkoutEnabled: "environment", partialPaymentsEnabled: "environment" },
    revision: 0, updatedAt: null, updatedBy: null,
  });
  stored = { _id: "store", checkoutEnabled: false, revision: 1 };
  assert.equal(await settings.checkoutEnabled(), false, "a saved value wins over the environment");
  assert.equal(await settings.partialPaymentsEnabled(), false);
  assert.equal((await settings.current()).sources.partialPaymentsEnabled, "environment");
});

test("an authorized admin changes settings with revision checks and an activity log entry", async () => {
  const before = await as("get", "/ecommerce/settings", ids.manager).expect(200);
  assert.equal(before.body.data.checkoutEnabled, false);
  assert.equal(before.body.data.transactionsAvailable, true);
  assert.equal(before.body.data.revision, 0);

  const saved = await as("patch", "/ecommerce/settings", ids.manager).send({ revision: 0, checkoutEnabled: true }).expect(200);
  assert.equal(saved.body.data.checkoutEnabled, true);
  assert.equal(saved.body.data.partialPaymentsEnabled, false);
  assert.equal(saved.body.data.revision, 1);
  assert.equal(saved.body.data.sources.checkoutEnabled, "admin");
  assert.deepEqual(saved.body.data.updatedBy, { _id: ids.manager, fullName: "Store Manager" });
  assert.equal(stored.history.at(-1).changes.checkoutEnabled.before, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].target, "CommerceSettings");
  assert.deepEqual(logs[0].details.changes, [{ field: "checkoutEnabled", label: "Checkout enabled", before: "No", after: "Yes" }]);

  const stale = await as("patch", "/ecommerce/settings", ids.manager).send({ revision: 0, partialPaymentsEnabled: true });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "STALE_REVISION");
  assert.equal(stored.partialPaymentsEnabled, undefined);

  await as("patch", "/ecommerce/settings", ids.manager).send({ revision: 1, partialPaymentsEnabled: true }).expect(200);
  assert.equal(await settings.partialPaymentsEnabled(), true);
});

test("viewing needs ecommerce.view; changing needs ecommerce.settings; input is strict", async () => {
  await as("get", "/ecommerce/settings", ids.viewer).expect(200);
  await as("patch", "/ecommerce/settings", ids.viewer).send({ revision: 0, checkoutEnabled: true }).expect(403);
  await as("patch", "/ecommerce/settings", ids.manager).send({ revision: 0 }).expect(400);
  await as("patch", "/ecommerce/settings", ids.manager).send({ revision: 0, checkoutEnabled: "yes" }).expect(400);
  await as("patch", "/ecommerce/settings", ids.manager).send({ revision: 0, transactionsAvailable: true }).expect(400);
  assert.equal(stored, null);
  assert.equal(logs.length, 0);
});

test("checkout cannot be turned on without database transactions", async () => {
  transactions = false;
  const refused = await as("patch", "/ecommerce/settings", ids.manager).send({ revision: 0, checkoutEnabled: true });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "TRANSACTIONS_REQUIRED");
  assert.equal(stored, null);
  await as("patch", "/ecommerce/settings", ids.manager).send({ revision: 0, checkoutEnabled: false }).expect(200);
});

test("public checkout and the legacy quotation checkout follow the saved switch", async () => {
  const create = mock.method(orders, "create", async () => ({ orderNumber: "SW-2026-0000009", commercialStatus: "NEW", financials: { total: 100 } }));
  const body = {
    items: [{ productId: "507f1f77bcf86cd799439011", variantId: "v1", quantity: 1 }],
    customer: { name: "Test Buyer", phone: "0555123456" },
    delivery: { wilayaCode: "16", communeCode: "1601", deliveryType: "stopDesk", officeCode: "A" },
    expectedQuote: "a".repeat(64), source: "landing", website: "",
  };
  process.env.ECOMMERCE_CHECKOUT_ENABLED = "true";
  stored = { _id: "store", checkoutEnabled: false, revision: 3 };
  const off = await request(app).post("/ecommerce/checkout").set("Idempotency-Key", "settings-test-key-01").send(body);
  assert.equal(off.status, 503);
  assert.equal(off.body.code, "CHECKOUT_DISABLED");
  assert.equal(create.mock.callCount(), 0);

  delete process.env.ECOMMERCE_CHECKOUT_ENABLED;
  stored = { ...stored, checkoutEnabled: true };
  await request(app).post("/ecommerce/checkout").set("Idempotency-Key", "settings-test-key-02").send(body).expect(201);
  assert.equal(create.mock.callCount(), 1);

  let caught;
  const response = { set() { return this; } };
  await createQuotation({ body: { items: [{ product: "507f1f77bcf86cd799439011", quantity: 1 }], requester: {}, delivery: {} } }, response, (error) => { caught = error; });
  assert.equal(caught?.key, "CHECKOUT_UPGRADE_REQUIRED");
});

test("without a database connection the environment defaults answer immediately", async () => {
  connected(0);
  process.env.ECOMMERCE_CHECKOUT_ENABLED = "true";
  stored = { _id: "store", checkoutEnabled: false, revision: 2 };
  assert.equal(await settings.checkoutEnabled(), true);
  assert.equal(CommerceSettings.findById.mock.callCount(), 0);
});
