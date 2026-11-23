const { test, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const request = require("supertest");
const { randomUUID } = require("node:crypto");
const Product = require("../src/models/product.model");
const Family = require("../src/models/family.model");
const SubFamily = require("../src/models/subFamily.model");
const User = require("../src/models/user.model");
const TokenServices = require("../src/services/tokenServices");
const {
  generateCombinations,
  convertLegacy,
} = require("../src/services/products/variants");
const { migrateVariants } = require("../src/services/products/migrateVariants");
const inventory = require("../src/services/ecommerce/inventory.service");
let repl, app, admin, viewer, family, subFamily;
const img = "https://res.cloudinary.com/test/image/upload/product.png";
const options = [
  {
    id: "color",
    name: "Color",
    type: "color",
    values: [
      { id: "black", label: "Black", swatchHex: "#202020" },
      { id: "white", label: "White", swatchHex: "#FFFFFF" },
    ],
  },
];
function payload() {
  return {
    name: "Test mixer",
    productId: `M-${randomUUID().slice(0, 8)}`,
    family: String(family._id),
    subFamily: String(subFamily._id),
    gallery: [img],
    prices: { productPrice: 100 },
    status: "draft",
    isActive: false,
    isEcommerce: true,
    variantSchemaVersion: 2,
    variantOptions: structuredClone(options),
    variantsV2: generateCombinations(options).variants,
  };
}
const as = (method, url, user = admin) =>
  request(app)
    [method](url)
    .set("Cookie", `access_token=${user._id}; csrf_token=catalog-test`)
    .set("X-CSRF-Token", "catalog-test");
async function create(changes = {}) {
  return (
    await as("post", "/products")
      .send({ ...payload(), ...changes })
      .expect(201)
  ).body.data;
}
before(
  async () => {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_KEY = "test";
    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: "7.0.14" },
    });
    await mongoose.connect(repl.getUri());
    await Promise.all(
      [Product, Family, SubFamily, User].map((model) => model.init()),
    );
    admin = await User.create({
      fullName: "Catalog Admin",
      email: "catalog-admin@example.test",
      password: "test",
      role: "super_admin",
    });
    viewer = await User.create({
      fullName: "Catalog Viewer",
      email: "catalog-viewer@example.test",
      password: "test",
      role: "admin",
      permissions: ["products.view"],
    });
    family = await Family.create({ name: "Mixers" });
    subFamily = await SubFamily.create({ name: "Basin", family: family._id });
    mock.method(TokenServices.prototype, "verify", async function () {
      return { uid: this.token, role: "admin", type: "access" };
    });
    app = require("../src/app");
  },
  { timeout: 180000 },
);
after(async () => {
  mock.restoreAll();
  await mongoose.disconnect();
  await repl?.stop();
});
test("create persists V2 and deterministic public compatibility without changing serial URLs", async () => {
  const product = await create({ status: "published", isActive: true });
  assert.equal(product.variantsV2.length, 2);
  assert.equal(product.commerce.variants.length, 2);
  assert.equal(product.productVariants[0].variantType, "Color");
  assert.equal(product.commerce.variants[0].price, null);
  await request(app).get(`/products/${product.serialNumber}`).expect(200);
  await request(app).get(`/products/${product.slug}`).expect(200);
  const publicProduct = await request(app)
    .get(`/ecommerce/products/${product.serialNumber}`)
    .expect(200);
  assert.equal(
    publicProduct.body.data.variants[0].id,
    product.variantsV2[0].id,
  );
  assert.equal(publicProduct.body.data.variants[0].available, true);
});
test("rename retains identity, zero overrides, stock and images and leaves canonical metadata stable", async () => {
  const product = await create();
  const nextOptions = structuredClone(product.variantOptions);
  nextOptions[0].name = "Colour";
  nextOptions[0].values[0].label = "Noir";
  nextOptions[0].values.reverse();
  const rows = product.variantsV2.map((row) => ({
    ...row,
    priceOverride: 0,
    stockQuantity: 7,
    trackInventory: true,
    imageUrl: img,
  }));
  const response = await as("put", `/products/${product.serialNumber}`)
    .send({
      catalogRevision: product.catalogRevision,
      variantSchemaVersion: 2,
      variantOptions: nextOptions,
      variantsV2: rows,
    })
    .expect(200);
  assert.equal(response.body.data.variantsV2[0].id, product.variantsV2[0].id);
  assert.equal(response.body.data.commerce.variants[0].options.Colour, "Noir");
  assert.equal(response.body.data.slug, product.slug);
  assert.equal(response.body.data.commerce.variants[0].price, 0);
  assert.equal(response.body.data.commerce.variants[0].quantity, 7);
  const legacySave = await as("put", `/products/${product.serialNumber}`)
    .send({ productVariants: [] })
    .expect(409);
  assert.equal(legacySave.body.code, "VARIANTS_V2_REQUIRED");
});
test("concurrent conflicting saves yield one success and one conflict", async () => {
  const product = await create();
  const responses = await Promise.all(
    ["One", "Two"].map((name) =>
      as("put", `/products/${product.serialNumber}`).send({
        name,
        catalogRevision: product.catalogRevision,
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
});
test("invalid stock, cents, option references and unowned images are rejected on the server", async () => {
  for (const change of [
    (row) => {
      row.stockQuantity = -1;
    },
    (row) => {
      row.priceOverride = 0.001;
    },
    (row) => {
      row.selections[0].valueId = "orphan";
    },
    (row) => {
      row.imageUrl = "https://example.test/unowned.png";
    },
  ]) {
    const data = payload();
    change(data.variantsV2[0]);
    const response = await as("post", "/products").send(data);
    assert.ok(
      [400, 422].includes(response.status),
      JSON.stringify(response.body),
    );
  }
  const invalid = payload();
  invalid.variantsV2[1].selections = invalid.variantsV2[0].selections;
  await as("post", "/products").send(invalid).expect(422);
});
test("the database unique multikey index protects SKUs under concurrent product writes", async () => {
  const a = payload(),
    b = payload();
  a.name = `SKU race A ${randomUUID()}`;
  b.name = `SKU race B ${randomUUID()}`;
  b.variantsV2[0].sku = a.variantsV2[0].sku;
  const responses = await Promise.all([
    as("post", "/products").send(a),
    as("post", "/products").send(b),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  assert.ok(
    responses
      .find((r) => r.status === 409)
      .body.message.includes("already exists"),
  );
});
test("legacy records stay readable and unrelated saves do not erase legacy, SEO or V2 data", async () => {
  const legacy = await Product.create({
    author: "legacy",
    productId: "OLD",
    serialNumber: `old-${randomUUID()}`,
    productVariants: [
      { variantType: "Color", variants: [{ variantData: "Chrome" }] },
    ],
    prices: { productPrice: 15, shippingPrice: 12 },
    seo: { title: "Original metadata" },
  });
  const original = legacy.toObject();
  await as("get", `/products/admin/${legacy.serialNumber}`).expect(200);
  await as("put", `/products/${legacy.serialNumber}`)
    .send({ prices: { productPrice: 20 } })
    .expect(200);
  let saved = await Product.findById(legacy._id).lean();
  assert.equal(saved.seo.title, "Original metadata");
  assert.equal(saved.prices.shippingPrice, 12);
  assert.equal(saved.productVariants[0].variants[0].variantData, "Chrome");
  const converted = convertLegacy(saved);
  await as("put", `/products/${legacy.serialNumber}`)
    .send({
      ...converted,
      variantSchemaVersion: 2,
      catalogRevision: saved.catalogRevision,
    })
    .expect(200);
  saved = await Product.findById(legacy._id).lean();
  assert.deepEqual(saved.legacyVariantSnapshot, original.productVariants);
  assert.equal(saved.variantsV2[0].trackInventory, false);
  await as("put", `/products/${legacy.serialNumber}`)
    .send({ name: "Renamed", catalogRevision: saved.catalogRevision })
    .expect(200);
  assert.equal((await Product.findById(legacy._id)).variantsV2.length, 1);
});
test("duplicate creates fresh identity, reference, SKU and URL; never copies stock or publication", async () => {
  const data = payload();
  data.variantsV2[0].trackInventory = true;
  data.variantsV2[0].stockQuantity = 20;
  const original = await create({
    ...data,
    status: "published",
    isActive: true,
  });
  const copy = (
    await as(
      "post",
      `/products/admin/${original.serialNumber}/duplicate`,
    ).expect(201)
  ).body.data;
  assert.notEqual(copy._id, original._id);
  assert.notEqual(copy.productId, original.productId);
  assert.notEqual(copy.serialNumber, original.serialNumber);
  assert.notEqual(copy.slug, original.slug);
  assert.equal(copy.status, "draft");
  assert.equal(copy.isActive, false);
  assert.equal(copy.commerce.published, false);
  assert.equal(copy.variantsV2[0].stockQuantity, 0);
  assert.notEqual(copy.variantsV2[0].sku, original.variantsV2[0].sku);
});
test("bulk actions are bounded, permission checked, and report partial failures", async () => {
  const product = await create();
  await as("post", "/products/admin/bulk", viewer)
    .send({ items: [], changes: { isActive: false } })
    .expect(403);
  const response = await as("post", "/products/admin/bulk")
    .send({
      items: [
        {
          serialNumber: product.serialNumber,
          catalogRevision: product.catalogRevision,
        },
        { serialNumber: "missing", catalogRevision: 0 },
      ],
      changes: { isActive: true },
    })
    .expect(200);
  assert.equal(response.body.data.succeeded, 1);
  assert.equal(response.body.data.failed, 1);
  await as("post", "/products/admin/bulk")
    .send({
      items: Array.from({ length: 51 }, (_, i) => ({
        serialNumber: String(i),
        catalogRevision: 0,
      })),
      changes: { isActive: true },
    })
    .expect(400);
  await as("post", "/products", viewer).send(payload()).expect(403);
});
test("admin filters, stock filters, sorting, catalog health and public visibility preserve real contracts", async () => {
  const data = payload();
  data.variantsV2 = data.variantsV2.map((v) => ({
    ...v,
    trackInventory: true,
    stockQuantity: 0,
  }));
  const product = await create(data);
  const response = await as(
    "get",
    `/products/admin?search=${product.productId}&status=draft&hasVariants=true&stock=outOfStock&sortBy=updatedAt&page=1&limit=1`,
  ).expect(200);
  assert.equal(response.body.data.totalCount, 1);
  assert.equal(
    response.body.data.products[0].catalogSummary.stock,
    "outOfStock",
  );
  await request(app).get(`/products/${product.serialNumber}`).expect(404);
  const health = await as("get", "/products/admin/health", viewer).expect(200);
  assert.ok(health.body.data.total >= 1);
});
test("existing transactional inventory keeps both variant representations and revisions synchronized", async () => {
  const data = payload();
  data.variantsV2[0].trackInventory = true;
  data.variantsV2[0].stockQuantity = 10;
  const product = await create({
    ...data,
    status: "published",
    isActive: true,
  });
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() =>
      inventory.move(
        {
          _id: new mongoose.Types.ObjectId(),
          items: [
            {
              productId: product._id,
              variantId: product.variantsV2[0].id,
              trackStock: true,
              quantity: 2,
            },
          ],
        },
        "RESERVE",
        { uid: admin._id },
        session,
      ),
    );
  } finally {
    await session.endSession();
  }
  const saved = await Product.findById(product._id).lean();
  assert.equal(saved.variantsV2[0].stockQuantity, 8);
  assert.equal(saved.commerce.variants[0].quantity, 8);
  assert.equal(saved.catalogRevision, product.catalogRevision + 1);
  await as("put", `/products/${product.serialNumber}`)
    .send({ name: "Stale", catalogRevision: product.catalogRevision })
    .expect(409);
});
test("real migration dry run makes no writes and repeated conversion is idempotent", async () => {
  const legacy = await Product.create({
    author: "legacy",
    productId: "MIG",
    serialNumber: `migration-${randomUUID()}`,
    productVariants: [
      {
        variantType: "Size",
        variants: [{ variantData: "10 mm" }, { variantData: "20 mm" }],
      },
    ],
  });
  const dry = await migrateVariants({ Product, dryRun: true });
  assert.ok(dry.converted >= 1);
  assert.equal(
    (await Product.findById(legacy._id)).variantSchemaVersion,
    undefined,
  );
  const applied = await migrateVariants({ Product, dryRun: false });
  assert.ok(applied.converted >= 1);
  const saved = await Product.findById(legacy._id).lean();
  assert.equal(saved.variantsV2.length, 2);
  assert.equal(saved.isEcommerce, false);
  assert.equal(saved.status, "draft");
  const repeated = await migrateVariants({ Product, dryRun: false });
  assert.equal(repeated.converted, 0);
});
