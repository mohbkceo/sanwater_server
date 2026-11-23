const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");
const XLSX = require("xlsx");
const Product = require("../src/models/product.model");
const Shipping = require("../src/models/shippingConfig.model");
const Order = require("../src/models/ecommerceOrder.model");
const Customer = require("../src/models/customer.model");
const User = require("../src/models/user.model");
const Lead = require("../src/models/lead.model");
const Quotation = require("../src/models/quotation.model");
const {
  Counter,
  StockMovement,
  ImportBatch,
  ProductEvent,
} = require("../src/models/commerceSupport.model");
const domain = require("../src/services/ecommerce/domain");
const pricing = require("../src/services/ecommerce/pricing.service");
const catalog = require("../src/services/ecommerce/catalog.service");
const orders = require("../src/services/ecommerce/order.service");
const imports = require("../src/services/ecommerce/import.service");
const migration = require("../src/services/ecommerce/migration.service");
const { summarize } = require("../src/services/ecommerce/analytics.service");
const validators = require("../src/middlewares/validators/schemas/ecommerceValidator");
const TokenServices = require("../src/services/tokenServices");
let repl, user, product, app;
const destination = {
  wilayaCode: "16",
  communeCode: "01",
  deliveryType: "home",
  address: "123 Rue Exemple",
};
const key = () => randomUUID();
async function payload(p = product, quantity = 1) {
  const input = {
    items: [
      {
        productId: String(p._id),
        variantId: p.commerce.variants[0].id,
        quantity,
      },
    ],
    delivery: destination,
  };
  const quote = await pricing.calculate(input, user);
  return {
    ...input,
    customer: { name: "Test Client", phone: "0550123456" },
    expectedQuote: quote.quoteFingerprint,
  };
}
async function create(p = product, quantity = 1) {
  return orders.create(await payload(p, quantity), key(), user);
}
async function act(o, action, data = {}, actor = user) {
  return orders.act(
    o._id,
    { revision: o.revision, requestId: key(), action, ...data },
    actor,
  );
}
async function transition(o, target) {
  return act(o, "transition", {
    target,
    ...(["CANCELLED", "RETURNING"].includes(target)
      ? { reason: "Test reason" }
      : {}),
  });
}
async function makeProduct(track = false, quantity = 10, options = []) {
  return catalog.save(
    null,
    {
      revision: 0,
      name: "Shelf",
      productId: `P-${key().slice(0, 6)}`,
      basePrice: 100,
      salesMode: "ecommerce",
      commerce: {
        published: true,
        options,
        variants: domain
          .generateVariants(options)
          .map((v) => ({ ...v, trackStock: track, quantity })),
      },
    },
    user,
  );
}
before(
  async () => {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_KEY = "test";
    process.env.ECOMMERCE_CHECKOUT_ENABLED = "true";
    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(repl.getUri());
    await Promise.all(
      [
        Product,
        Lead,
        Quotation,
        Shipping,
        Order,
        Customer,
        User,
        Counter,
        StockMovement,
        ImportBatch,
        ProductEvent,
      ].map((m) => m.init()),
    );
    const staff = await User.create({
      fullName: "Test Admin",
      email: "test@example.test",
      password: "test-only",
      role: "super_admin",
    });
    user = { uid: staff._id, role: "super_admin", email: staff.email };
    await Shipping.create({
      _id: "noest",
      revision: 1,
      wilayas: [
        {
          code: "16",
          name: "Alger",
          homePrice: 300,
          homeEnabled: true,
          stopDeskEnabled: true,
          stopDeskPrice: 200,
          communes: [
            {
              code: "01",
              name: "Centre",
              homeEnabled: true,
              stopDeskEnabled: true,
              offices: [
                { code: "A", name: "Office A", address: "Desk", enabled: true },
              ],
            },
          ],
        },
      ],
    });
    product = await makeProduct();
    app = require("../src/app");
  },
  { timeout: 180000 },
);
after(async () => {
  await mongoose.disconnect();
  if (repl) await repl.stop();
});
test("normalize Algerian phones without merging invalid identities", () => {
  for (const phone of ['021234567', '+21321234567', '0021321234567', '21 23 45 67']) assert.equal(domain.normalizePhone(phone), '+21321234567');
  for (const phone of [
    "0550 12 34 56",
    "+213550123456",
    "00213550123456",
    "550123456",
  ])
    assert.equal(domain.normalizePhone(phone), "+213550123456");
  for (const phone of ["123", "+33550123456", "0450123456", "abc0550123456"])
    assert.throws(() => domain.normalizePhone(phone));
});
test("variant generation preserves identity, creates combinations and bounds explosion", () => {
  const options = [
    { name: "Color", values: ["Black", "Grey"] },
    { name: "Size", values: ["60", "90"] },
  ];
  const variants = domain.generateVariants(options);
  assert.equal(variants.length, 4);
  assert.deepEqual(domain.generateVariants(options, variants), variants);
  assert.equal(domain.generateVariants([]).length, 1);
  assert.throws(() =>
    domain.generateVariants([
      { name: "A", values: Array.from({ length: 20 }, (_, i) => `${i}`) },
      { name: "B", values: Array.from({ length: 20 }, (_, i) => `${i}`) },
    ]),
  );
  assert.throws(() =>
    domain.generateVariants([{ name: "Color", values: ["Black", "black"] }]),
  );
});
test("canonical catalog legacy compatibility and independent variant price, stock, disabled and publication rules", async () => {
  const legacy = new Product({
    author: "old",
    productId: "old",
    serialNumber: "legacy",
    productVariants: [
      { variantType: "color", variants: [{ variantData: "Black" }] },
    ],
  });
  assert.equal(legacy.commerce, undefined);
  assert.throws(() => domain.priceItem(legacy, { quantity: 1 }));
  const p = await makeProduct(true, 3, [
    { name: "Color", values: ["Black", "Grey"] },
  ]);
  p.commerce.variants[0].price = 125;
  assert.equal(
    domain.priceItem(p, { variantId: p.commerce.variants[0].id, quantity: 2 })
      .lineTotal,
    250,
  );
  assert.throws(
    () =>
      domain.priceItem(p, {
        variantId: p.commerce.variants[0].id,
        quantity: 4,
      }),
    /stock/,
  );
  p.commerce.variants[0].enabled = false;
  assert.throws(() =>
    domain.priceItem(p, { variantId: p.commerce.variants[0].id, quantity: 1 }),
  );
  p.commerce.published = false;
  assert.throws(() =>
    domain.priceItem(p, { variantId: p.commerce.variants[1].id, quantity: 1 }),
  );
});
test("single nonstacking offers have dates and correct percentage, fixed and quantity arithmetic", () => {
  const p = structuredClone(product),
    v = p.commerce.variants[0].id,
    price = () => domain.priceItem(p, { variantId: v, quantity: 3 });
  p.commerce.offer = { enabled: true, type: "percentage", value: 10 };
  assert.equal(price().lineTotal, 270);
  p.commerce.offer = { enabled: true, type: "fixed", value: 200 };
  assert.equal(price().lineTotal, 0);
  p.commerce.offer = {
    enabled: true,
    type: "quantity",
    value: 20,
    minQuantity: 4,
  };
  assert.equal(price().lineTotal, 300);
  p.commerce.offer.minQuantity = 3;
  assert.equal(price().lineTotal, 240);
  p.commerce.offer.endsAt = "2000-01-01";
  assert.equal(price().lineTotal, 300);
  p.commerce.offer = { enabled: true, type: "percentage", value: 101 };
  assert.throws(() => domain.validateCommerce(p.commerce, 100));
});
test("public checkout stores Order with sanitized receipt, replay protection and unified customer", async (t) => {
  const input = await payload(),
    idempotency = key();
  const a = await request(app)
    .post("/ecommerce/checkout")
    .set("Idempotency-Key", idempotency)
    .send(input)
    .expect(201);
  const b = await request(app)
    .post("/ecommerce/checkout")
    .set("Idempotency-Key", idempotency)
    .send(input)
    .expect(201);
  assert.equal(a.body.data.orderNumber, b.body.data.orderNumber);
  assert.equal(a.body.data.customer, undefined);
  assert.equal(a.body.data._id, undefined);
  assert.equal(a.body.data.financials.total, 400);
  const changed = await request(app)
    .post("/ecommerce/checkout")
    .set("Idempotency-Key", idempotency)
    .send({ ...input, customer: { ...input.customer, name: "Changed Name" } });
  assert.equal(changed.status, 409);
  const duplicate = await orders.create(
    { ...input, customer: { ...input.customer, phone: "00213550123456" } },
    key(),
    user,
  );
  assert.equal(await Customer.countDocuments({ phone: "+213550123456" }), 1);
  const one = await Order.findOne({
    orderNumber: a.body.data.orderNumber,
  }).lean();
  assert.equal(String(one.customerId), String(duplicate.customerId));
  assert.equal(one.items[0].sku, product.commerce.variants[0].sku);
});
test("multiple lines, malicious status/discount and price override permissions are checked server-side", async () => {
  const other = await makeProduct(),
    input = await payload();
  input.items.push({
    productId: String(other._id),
    variantId: other.commerce.variants[0].id,
    quantity: 2,
  });
  const quote = await pricing.calculate(input, user);
  input.expectedQuote = quote.quoteFingerprint;
  const order = await orders.create(input, key(), user);
  assert.equal(order.financials.total, 600);
  assert.ok(
    validators.create.validate({ ...input, commercialStatus: "DELIVERED" })
      .error,
  );
  assert.ok(
    validators.create.validate({
      ...input,
      items: [{ ...input.items[0], discount: 900 }],
    }).error,
  );
  await assert.rejects(
    pricing.calculate(
      {
        ...input,
        items: [
          {
            ...input.items[0],
            overrideUnitPrice: 0,
            overrideReason: "Bad actor",
          },
        ],
      },
      { role: "admin", permissions: ["ecommerce.create"] },
    ),
    /permission/,
  );
  assert.ok(
    validators.quote.validate({
      ...input,
      customer: undefined,
      expectedQuote: undefined,
      items: [{ ...input.items[0], variantId: "unknown" }],
    }).error,
  );
});
test("stale prices and tariffs reject submission, existing snapshots remain immutable", async () => {
  const p = await makeProduct(),
    input = await payload(p),
    created = await orders.create(input, key(), user);
  await Product.updateOne(
    { _id: p._id },
    { $set: { "prices.productPrice": 200, name: "Changed product" } },
  );
  await assert.rejects(orders.create(input, key(), user), /changed/);
  const old = await Order.findById(created._id).lean();
  assert.equal(old.items[0].unitPrice, 100);
  assert.equal(old.items[0].name, "Shelf");
  const next = await payload(p);
  await Shipping.updateOne({ _id: "noest" }, { $inc: { revision: 1 } });
  await assert.rejects(orders.create(next, key(), user), /changed/);
});
test("concurrent stock confirmations prevent overselling; retries and cancellation cannot deduct/release twice", async () => {
  const p = await makeProduct(true, 1),
    a = await create(p),
    b = await create(p);
  const outcomes = await Promise.allSettled([
    transition(a, "CONFIRMED"),
    transition(b, "CONFIRMED"),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  let winner = outcomes.find((r) => r.status === "fulfilled").value;
  assert.equal(
    (await Product.findById(p._id).lean()).commerce.variants[0].quantity,
    0,
  );
  const op = {
    action: "note",
    note: "one event",
    revision: winner.revision,
    requestId: key(),
  };
  winner = await orders.act(winner._id, op, user);
  const replay = await orders.act(winner._id, op, user);
  assert.equal(replay.revision, winner.revision);
  winner = await transition(winner, "CANCELLED");
  assert.equal(
    (await Product.findById(p._id).lean()).commerce.variants[0].quantity,
    1,
  );
  await assert.rejects(transition(winner, "CONFIRMED"));
  assert.equal(
    await StockMovement.countDocuments({
      orderId: winner._id,
      kind: "RESERVE",
    }),
    1,
  );
  assert.equal(
    await StockMovement.countDocuments({
      orderId: winner._id,
      kind: "RELEASE",
    }),
    1,
  );
});
test("optimistic revisions, assignment scopes, blocking issues, production and manual courier lifecycle", async () => {
  const p = await makeProduct(false),
    o = await create(p);
  await assert.rejects(transition(o, "SHIPPED"));
  const viewer = {
    uid: new mongoose.Types.ObjectId(),
    role: "admin",
    permissions: ["ecommerce.view", "ecommerce.viewAll"],
  };
  await assert.rejects(act(o, "transition", { target: "CONFIRMED" }, viewer));
  const results = await Promise.allSettled([
    act(o, "note", { note: "first" }),
    act(o, "note", { note: "second" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  let current = results.find((r) => r.status === "fulfilled").value;
  current = await transition(current, "CONFIRMED");
  current = await act(current, "issue", {
    type: "Address",
    severity: "CRITICAL",
  });
  await assert.rejects(transition(current, "PREPARING"));
  current = await act(current, "resolve", { issueId: current.issues[0]._id });
  current = await transition(current, "PREPARING");
  current = await transition(current, "READY_TO_SHIP");
  await assert.rejects(
    transition(current, "SHIPPED"),
    /Transition unavailable/,
  );
  current = await act(current, "shipment", {
    agency: "Manual provider",
    trackingNumber: "TEST-1",
    externalState: "Provider text",
  });
  current = await transition(current, "SHIPPED");
  current = await transition(current, "DELIVERED");
  assert.equal(current.payment.collected, 0);
  assert.equal(current.outstandingBalance, current.financials.total);
  assert.ok(current.events.length > 5);
  await assert.rejects(transition(current, "PREPARING"));
  const scoped = {
    uid: new mongoose.Types.ObjectId(),
    role: "admin",
    permissions: ["ecommerce.view", "ecommerce.confirm"],
  };
  await assert.rejects(
    act(o, "transition", { target: "CONFIRMED" }, scoped),
    /scope/,
  );
});
test("production is optional and manufactured products must complete production", async () => {
  const p = await makeProduct();
  await Product.updateOne(
    { _id: p._id },
    { $set: { "commerce.requiresProduction": true } },
  );
  let o = await create(p);
  o = await transition(o, "CONFIRMED");
  o = await transition(o, "PREPARING");
  await assert.rejects(transition(o, "READY_TO_SHIP"));
  o = await act(o, "productionStart");
  await assert.rejects(transition(o, "READY_TO_SHIP"));
  o = await act(o, "productionFinish");
  o = await transition(o, "READY_TO_SHIP");
  assert.equal(o.fulfillment.stage, "READY_TO_SHIP");
});
test("returns require inspection before restock; delivery and collection remain independent", async () => {
  const p = await makeProduct(true, 2);
  let o = await create(p);
  o = await transition(o, "CONFIRMED");
  o = await transition(o, "PREPARING");
  o = await transition(o, "READY_TO_SHIP");
  o = await act(o, "shipment", { agency: "Manual", trackingNumber: "TEST-2" });
  o = await transition(o, "SHIPPED");
  o = await transition(o, "DELIVERED");
  o = await act(o, "payment", {
    amount: o.financials.total,
    paymentKind: "collected",
  });
  assert.equal(o.outstandingBalance, 0);
  await assert.rejects(act(o, "payment", { amount: 1, paymentKind: "paid" }));
  o = await transition(o, "RETURNING");
  o = await transition(o, "RETURNED");
  assert.equal(
    (await Product.findById(p._id).lean()).commerce.variants[0].quantity,
    1,
  );
  o = await act(o, "restock", { reason: "Inspected undamaged" });
  await assert.rejects(act(o, "restock", { reason: "Twice" }));
  assert.equal(
    (await Product.findById(p._id).lean()).commerce.variants[0].quantity,
    2,
  );
  o = await act(o, "payment", {
    amount: o.financials.total,
    paymentKind: "refunded",
  });
  assert.equal(o.payment.refunded, o.financials.total);
});
test("CSV, XLS, XLSX imports, mappings, partial success, duplicates, repeated upload and historical protection", async () => {
  const arabic = await imports.parseFile({ buffer: Buffer.from('name,phone\nمحمد,0550123456\n'), originalname: 'ar.csv' });
  assert.equal(arabic.rows[0].raw.name, 'محمد');
  const p = await makeProduct();
  const data = [
    {
      Buyer: "Test Buyer",
      Phone: "0660123456",
      Item: "Unmapped product",
      quantity: "1",
      wilaya: "Alger",
      commune: "Centre",
      deliveryType: "home",
      address: "123 Rue Exemple",
      externalReference: "REF-1",
      status: "NEW",
    },
    { Buyer: "Other Buyer", Phone: "invalid", Item: "Unmapped product" },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(data),
    "Orders",
  );
  for (const format of ["xls", "xlsx", "csv"]) {
    const buffer =
      format === "csv"
        ? Buffer.from(XLSX.utils.sheet_to_csv(workbook.Sheets.Orders))
        : XLSX.write(workbook, { type: "buffer", bookType: format });
    assert.equal(
      (await imports.parseFile({ buffer, originalname: `orders.${format}` }))
        .rows.length,
      2,
    );
  }
  const file = {
    buffer: Buffer.from(XLSX.utils.sheet_to_csv(workbook.Sheets.Orders)),
    originalname: "orders.csv",
  };
  const batch = await imports.upload(file, user),
    repeated = await imports.upload(file, user);
  assert.equal(String(batch._id), String(repeated._id));
  const first = await imports.preview(batch._id, {}, user);
  assert.ok(first.rows.every((r) => !r.eligible));
  const mappings = {
    columns: { name: "Buyer", phone: "Phone", product: "Item" },
    products: {
      "Unmapped product": {
        productId: String(p._id),
        variantId: p.commerce.variants[0].id,
      },
    },
    wilayas: { Alger: "16" },
    communes: { "Alger/Centre": "01" },
  };
  const ready = await imports.preview(batch._id, mappings, user);
  assert.equal(ready.rows.filter((r) => r.eligible).length, 1);
  const result = await imports.commit(
    batch._id,
    [2, 3],
    user,
    ready.previewRevision,
  );
  assert.equal(result[0].status, "IMPORTED");
  assert.equal(result[1].status, "ERROR");
  const replay = await imports.commit(
    batch._id,
    [2],
    user,
    ready.previewRevision,
  );
  assert.equal(replay[0].orderNumber, result[0].orderNumber);
  const duplicates = await imports.preview(batch._id, mappings, user);
  assert.match(duplicates.rows[0].error, /DUPLICATE_EXISTING/);
  await assert.rejects(
    imports.commit(batch._id, [2], user, ready.previewRevision),
    /preview changed/,
  );
  const update = await imports.preview(
    batch._id,
    { ...mappings, updateNew: true },
    user,
  );
  assert.equal(update.rows[0].action, "UPDATE_NEW");
  const updated = await imports.commit(
    batch._id,
    [2],
    user,
    update.previewRevision,
  );
  assert.equal(updated[0].status, "UPDATED");
  assert.equal(String(updated[0].orderId), String(result[0].orderId));
  const updateReplay = await imports.commit(
    batch._id,
    [2],
    user,
    update.previewRevision,
  );
  assert.equal(updateReplay[0].status, "UPDATED");
  let imported = await Order.findById(result[0].orderId).lean();
  imported = await transition(imported, "CONFIRMED");
  imported = await transition(imported, "PREPARING");
  imported = await transition(imported, "READY_TO_SHIP");
  imported = await act(imported, "shipment", {
    agency: "Manual",
    trackingNumber: "IMPORT-REF1",
  });
  imported = await transition(imported, "SHIPPED");
  imported = await transition(imported, "DELIVERED");
  assert.match(
    (await imports.preview(batch._id, { ...mappings, updateNew: true }, user))
      .rows[0].error,
    /DUPLICATE_EXISTING/,
  );
  assert.throws(() =>
    imports.parseFile({ buffer: Buffer.from("bad"), originalname: "bad.exe" }),
  );
  assert.throws(() =>
    imports.parseFile({
      buffer: Buffer.from("not an xlsx workbook"),
      originalname: "bad.xlsx",
    }),
  );
  const row = {
    name: "Test",
    phone: "0770123456",
    product: p.productId,
    quantity: 1,
    wilaya: "16",
    commune: "01",
    deliveryType: "home",
    address: "123 Example",
    status: "DELIVERED",
  };
  const historical = await imports.upload(
    {
      originalname: "history.csv",
      buffer: Buffer.from(
        XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet([row])),
      ),
    },
    user,
  );
  assert.match(
    (await imports.preview(historical._id, {}, user)).rows[0].error,
    /HISTORICAL_STATUS/,
  );
});
test("migration classifies B2B and ambiguous history and preserves original checkout snapshots idempotently", async () => {
  assert.equal(
    migration.classify({ source: "product_detail_page" }).action,
    "KEEP_QUOTATION",
  );
  const record = {
    _id: new mongoose.Types.ObjectId(),
    source: "landing_product_page",
    status: "submitted",
    createdAt: new Date("2025-01-01"),
    items: [
      {
        product: product._id,
        productName: "Original name",
        productSerialNumber: "OLD-SKU",
        quantity: 2,
      },
    ],
    requester: { fullName: "Old Buyer", phone: "+213550123456" },
    delivery: destination,
    pricing: {
      unitPrice: 55,
      subtotal: 110,
      shippingFee: 50,
      total: 160,
      currency: "DZD",
    },
  };
  assert.equal(
    migration.classify({ ...record, status: "approved" }).action,
    "MANUAL_REVIEW",
  );
  const one = await migration.migrate(record),
    two = await migration.migrate(record);
  assert.equal(one.orderNumber, two.orderNumber);
  assert.equal(one.items[0].unitPrice, 55);
  assert.equal(one.createdAt.toISOString(), record.createdAt.toISOString());
  assert.equal(one.fulfillment.stage, "LEGACY_UNINITIALIZED");
  assert.equal(one.items[0].variantId, null);
  await assert.rejects(transition(one, "CONFIRMED"));
});
test("HTTP admin reads and writes enforce authentication, CSRF, permissions and private scopes", async (t) => {
  const readOnly = await User.create({
    fullName: "Viewer User",
    email: "viewer@example.test",
    password: "x",
    permissions: ["ecommerce.view"],
    role: "admin",
  });
  t.mock.method(TokenServices.prototype, "verify", async function () {
    return { uid: this.token, role: "admin", type: "access" };
  });
  await request(app).get("/ecommerce/orders").expect(401);
  const cookie = `access_token=${readOnly._id}; csrf_token=test-nonce`;
  const response = await request(app)
    .get("/ecommerce/orders")
    .set("Cookie", cookie)
    .expect(200);
  assert.equal(response.body.data.count, 0);
  await request(app)
    .post("/ecommerce/orders")
    .set("Cookie", cookie)
    .send({})
    .expect(403);
  await request(app)
    .post("/ecommerce/orders")
    .set("Cookie", cookie)
    .set("X-CSRF-Token", "test-nonce")
    .send({})
    .expect(403);
  await request(app)
    .get("/ecommerce/customers")
    .set("Cookie", cookie)
    .expect(403);
});
test("analytics distinguishes gross delivered revenue, collection, refunds and explicit denominators", () => {
  const base = {
    customer: {},
    items: [],
    payment: { paid: 0, collected: 0, refunded: 0 },
    financials: { subtotal: 100, discount: 10, total: 390 },
    delivery: {},
    confirmation: { confirmedAt: new Date() },
  };
  const report = summarize([
    { ...base, commercialStatus: "DELIVERED" },
    { ...base, commercialStatus: "RETURNED" },
    { ...base, confirmation: {}, commercialStatus: "NEW" },
  ]);
  assert.equal(report.confirmationRate, 66.67);
  assert.equal(report.deliverySuccessRate, 50);
  assert.equal(report.netRealizedRevenue, 90);
  assert.equal(report.outstandingCollections, 390);
  assert.equal(
    summarize([
      {
        ...base,
        commercialStatus: "RETURNED",
        payment: { paid: 390, collected: 0, refunded: 390 },
      },
    ]).netRealizedRevenue,
    0,
  );
});
test("edits preserve earlier snapshots in immutable audit events and untracked products have no artificial stock limit", async () => {
  const p = await makeProduct(false, 0),
    initial = await create(p, 500);
  assert.equal(initial.items[0].quantity, 500);
  const next = await payload(p, 2),
    changed = await act(initial, "edit", { order: next });
  assert.equal(changed.items[0].quantity, 2);
  const edit = changed.events.find((e) => e.kind === "edit");
  assert.equal(edit.data.previousOrder.items[0].quantity, 500);
  assert.equal(changed.events[0].data.items[0].quantity, 500);
});
test("explicit approved quotation and lead conversions share creation, link both records and never duplicate", async (t) => {
  t.mock.method(TokenServices.prototype, "verify", async function () {
    return { uid: this.token, role: "super_admin", type: "access" };
  });
  const input = await payload(),
    cookie = `access_token=${user.uid}; csrf_token=local-test`;
  const quote = await Quotation.create({
    requester: { fullName: input.customer.name, phone: input.customer.phone },
    items: [{ product: product._id, productName: product.name, quantity: 1 }],
    status: "submitted",
    source: "product_detail_page",
  });
  const endpoint = `/ecommerce/conversions/quotation/${quote._id}`;
  await request(app)
    .post(endpoint)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", "local-test")
    .send(input)
    .expect(409);
  quote.status = "approved";
  await quote.save();
  const one = await request(app)
    .post(endpoint)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", "local-test")
    .send(input)
    .expect(201);
  const two = await request(app)
    .post(endpoint)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", "local-test")
    .send(input)
    .expect(200);
  assert.equal(one.body.data.orderNumber, two.body.data.orderNumber);
  assert.equal(
    String((await Quotation.findById(quote._id)).convertedOrderId),
    one.body.data._id,
  );
  const lead = await Lead.create({
    fullName: input.customer.name,
    phone: input.customer.phone,
    wilaya: "16",
    productId: product._id,
    productName: product.name,
    productSerialNumber: product.serialNumber,
    quantity: 1,
  });
  const converted = await request(app)
    .post(`/ecommerce/conversions/lead/${lead._id}`)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", "local-test")
    .send(input)
    .expect(201);
  assert.equal(converted.body.data.source, "lead");
  assert.equal(
    String((await Lead.findById(lead._id)).convertedOrderId),
    converted.body.data._id,
  );
  const custom = await Quotation.create({
    requester: { fullName: input.customer.name, phone: input.customer.phone },
    items: [
      { product: null, productName: "Custom requested item", quantity: 1 },
    ],
    status: "approved",
  });
  await request(app)
    .post(`/ecommerce/conversions/quotation/${custom._id}`)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", "local-test")
    .send(input)
    .expect(201);
});
test("binary upload HTTP contract and import revisions are enforced with existing session and CSRF", async (t) => {
  t.mock.method(TokenServices.prototype, "verify", async function () {
    return { uid: this.token, role: "super_admin", type: "access" };
  });
  const cookie = `access_token=${user.uid}; csrf_token=local-test`;
  const csv = `name,phone,product,quantity,wilaya,commune,deliveryType,address,externalReference\nRaw Buyer,0770111222,${product.productId},1,16,01,home,123 Example Road,RAW-HTTP\n`;
  const upload = await request(app)
    .post("/ecommerce/imports")
    .set("Cookie", cookie)
    .set("X-CSRF-Token", "local-test")
    .set("X-File-Name", "orders.csv")
    .set("Content-Type", "application/octet-stream")
    .send(Buffer.from(csv))
    .expect(200);
  assert.equal(upload.body.data.rows[0].eligible, true);
  const result = await request(app)
    .post(`/ecommerce/imports/${upload.body.data._id}/commit`)
    .set("Cookie", cookie)
    .set("X-CSRF-Token", "local-test")
    .send({ selected: [2], previewRevision: upload.body.data.previewRevision })
    .expect(200);
  assert.equal(result.body.data[0].status, "IMPORTED");
});
test("cutover blocks legacy checkout quotation writes while preserving the B2B request-quote API", async () => {
  const input = {
    requester: { fullName: "B2B Test", phone: "0550123456" },
    items: [
      { product: String(product._id), productName: "Shelf", quantity: 1 },
    ],
  };
  const response = await request(app)
    .post("/quotations")
    .set("X-Forwarded-For", "203.0.113.10")
    .send({ ...input, source: "product_detail_page" })
    .expect(201);
  assert.ok(response.body.data.id);
  const old = await request(app)
    .post("/quotations")
    .set("X-Forwarded-For", "203.0.113.11")
    .send({
      ...input,
      source: "landing_product_page",
      delivery: {
        ...destination,
        expectedTariffRevision: 0,
        expectedUnitPrice: 100,
      },
    })
    .expect(409);
  assert.equal(old.body.code, "CHECKOUT_UPGRADE_REQUIRED");
});
test("unsupported MongoDB topology refuses the transaction before invoking a mutating callback", async (t) => {
  t.mock.method(mongoose.connection.db, "admin", () => ({
    command: async () => ({ ok: 1 }),
  }));
  let ran = false;
  await assert.rejects(
    require("../src/services/ecommerce/transaction")(async () => {
      ran = true;
    }),
    /transaction support/,
  );
  assert.equal(ran, false);
});
test("existing image upload HTTP contract works with current Multer and Cloudinary storage engine", async (t) => {
  t.mock.method(TokenServices.prototype, "verify", async function () {
    return { uid: this.token, role: "super_admin", type: "access" };
  });
  const { Writable } = require("node:stream");
  t.mock.method(
    require("cloudinary").v2.uploader,
    "upload_stream",
    (options, callback) =>
      new Writable({
        write(chunk, encoding, done) {
          done();
        },
        final(done) {
          callback(null, {
            secure_url: "https://res.cloudinary.com/test/uploaded.png",
            public_id: "content/test",
            bytes: 8,
          });
          done();
        },
      }),
  );
  const result = await request(app)
    .post("/content/upload/image/v1?folder=content")
    .set("Cookie", `access_token=${user.uid}; csrf_token=local-test`)
    .set("X-CSRF-Token", "local-test")
    .attach("image", Buffer.from("test png"), "test.png")
    .expect(200);
  assert.equal(
    result.body.data.path,
    "https://res.cloudinary.com/test/uploaded.png",
  );
});

test('commerce editing preserves legacy identity and omitted technical/media/price fields', async () => {
  const legacy = await Product.create({ author: 'old', productId: 'LEGACY-PRESERVE', serialNumber: `OLD-${key()}`, description: 'Original technical description', gallery: ['https://example.test/image.jpg'], specifications: [{ label: 'Material', value: 'Brass' }], prices: { productPrice: 100, shippingPrice: 777 }, productVariants: [{ variantType: 'color', variants: [{ variantData: 'Legacy black' }] }] });
  const changed = await catalog.save(legacy._id, { revision: 0, name: 'Commerce name', productId: legacy.productId, basePrice: 120, salesMode: 'both', commerce: { published: false, options: [], variants: domain.generateVariants([]) } }, user);
  assert.equal(String(changed._id), String(legacy._id)); assert.equal(changed.serialNumber, legacy.serialNumber);
  assert.equal(changed.description, 'Original technical description'); assert.deepEqual(changed.gallery, ['https://example.test/image.jpg']);
  assert.equal(changed.prices.shippingPrice, 777); assert.equal(changed.specifications[0].value, 'Brass'); assert.equal(changed.productVariants[0].variants[0].variantData, 'Legacy black');
});

test('existing business analytics reconciles order revenue and product refunds without counting won leads', async () => {
  let o = await create(); o = await transition(o, 'CONFIRMED'); o = await transition(o, 'PREPARING'); o = await transition(o, 'READY_TO_SHIP');
  o = await act(o, 'shipment', { agency: 'Manual', trackingNumber: 'ANALYTICS-TEST' }); o = await transition(o, 'SHIPPED'); o = await transition(o, 'DELIVERED');
  o = await act(o, 'payment', { amount: o.financials.total, paymentKind: 'collected' }); o = await act(o, 'payment', { amount: 50, paymentKind: 'refunded' });
  const today = new Date().toISOString().slice(0, 10), from = new Date(today), to = new Date(`${today}T23:59:59.999Z`);
  const expected = summarize(await Order.find({ createdAt: { $gte: from, $lte: to } }).lean());
  const actual = await require('../src/services/businessAnalytics.service').getBusinessAnalytics({ from: today, to: today });
  assert.equal(actual.definitions.orderEntity, 'ecommerceOrder');
  assert.equal(domain.round(actual.kpis.revenue.current), expected.netRealizedRevenue);
  assert.equal(domain.round(actual.products.reduce((sum, p) => sum + p.revenue, 0)), expected.netRealizedRevenue);
});

test('confirmation honors stock tracking enabled after submission and prevents later overselling', async () => {
  const p = await makeProduct(false, 1), earlier = await create(p);
  await Product.updateOne({ _id: p._id }, { $set: { 'commerce.variants.0.trackStock': true } });
  const later = await create(p);
  const confirmed = await transition(earlier, 'CONFIRMED');
  assert.equal(confirmed.items[0].trackStock, true);
  assert.equal((await Product.findById(p._id).lean()).commerce.variants[0].quantity, 0);
  await assert.rejects(transition(later, 'CONFIRMED'));
  assert.equal(confirmed.items[0].unitPrice, earlier.items[0].unitPrice);
});
