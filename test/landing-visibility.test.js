// Public catalog visibility for E-commerce products. Database-free: model
// methods are replaced by in-memory collections and MongoDB filters are
// evaluated with sift, the matcher mongoose itself depends on.
const { test, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Product = require("../src/models/product.model");
const Family = require("../src/models/family.model");
const SubFamily = require("../src/models/subFamily.model");
const visibility = require("../src/services/products/visibility");
const controller = require("../src/controllers/products/productControler");
const { getFamilyTree } = require("../src/services/taxonomy.service");
const { prepare } = require("../src/services/products/catalog");
const v = require("../src/services/products/variants");

const sift = require(require.resolve("sift", {
  paths: [path.dirname(require.resolve("mongoose"))],
})).default;
const matches = (filter, docs) => docs.filter(sift(filter));

const family = { _id: "f1", name: "Robinets", slug: "robinets", isActive: true };
const subFamily = { _id: "s1", name: "Mitigeurs", slug: "mitigeurs", family: "f1", isActive: true };
const base = { isActive: true, family: "f1", subFamily: "s1", status: "published" };
const fixtures = [
  { ...base, _id: "catalog", serialNumber: "CAT-1", name: "Catalog", salesMode: "catalog", isEcommerce: false },
  { ...base, _id: "legacy", serialNumber: "LEG-1", name: "Legacy", isEcommerce: false },
  { ...base, _id: "legacy-null", serialNumber: "LEG-2", name: "Legacy null flag", isEcommerce: null },
  { ...base, _id: "ecommerce", serialNumber: "EC-1", name: "Ecommerce", salesMode: "ecommerce", isEcommerce: true, commerce: { published: true } },
  { ...base, _id: "both", serialNumber: "EC-2", name: "Both", salesMode: "both", isEcommerce: false, commerce: { published: true } },
  { ...base, _id: "legacy-ec", serialNumber: "EC-3", name: "Legacy flag", isEcommerce: true },
  { ...base, _id: "disagree", serialNumber: "EC-4", name: "Flag disagrees", salesMode: "catalog", isEcommerce: true },
  { ...base, _id: "inactive", serialNumber: "OFF-1", name: "Inactive", isActive: false, salesMode: "catalog" },
  { ...base, _id: "unpublished", serialNumber: "OFF-2", name: "Unpublished projection", salesMode: "catalog", commerce: { published: false } },
];
const ids = (docs) => docs.map((doc) => doc._id).sort();

function query(result) {
  const calls = { populate: [] };
  const q = {
    calls,
    populate(arg) { calls.populate.push(arg); return q; },
    sort() { return q; },
    skip() { return q; },
    select() { return q; },
    session() { return q; },
    limit(n) { calls.limit = n; return q; },
    distinct: async (field) => (await result()).map((doc) => doc[field]),
    lean: () => Promise.resolve(result()),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return q;
}
function response() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
let captured;
beforeEach(() => {
  captured = {};
  mock.method(Family, "find", (filter = {}) => query(() => matches(filter, [family])));
  mock.method(Family, "findOne", (filter = {}) => query(() => matches(filter, [family])[0] || null));
  mock.method(SubFamily, "find", (filter = {}) => query(() => matches(filter, [subFamily])));
  mock.method(SubFamily, "findOne", (filter = {}) => query(() => matches(filter, [subFamily])[0] || null));
  mock.method(Product, "find", (filter) => {
    captured.find = filter;
    return (captured.query = query(() => matches(filter, fixtures)));
  });
  mock.method(Product, "findOne", (filter) => {
    captured.findOne = filter;
    return (captured.query = query(() => matches(filter, fixtures)[0] || null));
  });
  mock.method(Product, "countDocuments", async (filter) => matches(filter, fixtures).length);
  mock.method(Product, "aggregate", async ([{ $match }, { $group }]) => {
    const key = $group._id.slice(1);
    const counts = new Map();
    for (const doc of matches($match, fixtures)) counts.set(doc[key], (counts.get(doc[key]) || 0) + 1);
    return [...counts].map(([_id, count]) => ({ _id, count }));
  });
});
afterEach(() => mock.restoreAll());

test("visibility policy hides ecommerce, both and legacy-flag products from the catalog", () => {
  const listed = matches(visibility.publicCatalogFilter(), fixtures);
  assert.deepEqual(ids(listed), ["catalog", "legacy", "legacy-null"]);
  assert.deepEqual(
    ids(matches(visibility.commerceEnabledFilter(), fixtures)),
    ["both", "disagree", "ecommerce", "legacy-ec"],
  );
  for (const doc of fixtures) {
    assert.equal(visibility.isPubliclyListed(doc), listed.includes(doc), doc._id);
    assert.equal(
      visibility.isCommerceEnabled(doc),
      ["ecommerce", "both", "legacy-ec", "disagree"].includes(doc._id),
      doc._id,
    );
  }
});

test("public product list and search exclude E-commerce products and cannot be widened", async () => {
  const res = response();
  await controller.getProducts({ query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(ids(res.body.data.products), ["catalog", "legacy", "legacy-null"]);

  const widened = response();
  await controller.getProducts({ query: { isEcommerce: "true" } }, widened);
  assert.deepEqual(ids(widened.body.data.products), ["catalog", "legacy", "legacy-null"]);

  const search = response();
  await controller.getProducts({ query: { search: "e" } }, search);
  assert.ok(search.body.data.products.every((p) => visibility.isPubliclyListed(p)));
  assert.ok(!search.body.data.products.some((p) => ["Ecommerce", "Both"].includes(p.name)));
});

test("admin product list keeps every product and scopes by sales channel", async () => {
  const all = response();
  await controller.getProducts({ catalogAdmin: true, query: {} }, all);
  assert.equal(all.body.data.products.length, fixtures.length);
  assert.equal(all.body.data.totalCount, fixtures.length);

  const commerce = response();
  await controller.getProducts({ catalogAdmin: true, query: { isEcommerce: "true" } }, commerce);
  assert.deepEqual(ids(commerce.body.data.products), ["both", "disagree", "ecommerce", "legacy-ec"]);

  const catalog = response();
  await controller.getProducts({ catalogAdmin: true, query: { isEcommerce: "false" } }, catalog);
  assert.deepEqual(ids(catalog.body.data.products), ["catalog", "inactive", "legacy", "legacy-null", "unpublished"]);
});

test("public product detail refuses hidden E-commerce products; admin detail still loads them", async () => {
  for (const serialNumber of ["EC-1", "EC-2", "EC-3", "EC-4", "OFF-1"]) {
    const res = response();
    await controller.getProduct({ params: { serialNumber } }, res);
    assert.equal(res.statusCode, 404, serialNumber);
  }
  const visible = response();
  await controller.getProduct({ params: { serialNumber: "CAT-1" } }, visible);
  assert.equal(visible.statusCode, 200);
  assert.equal(visible.body.data.name, "Catalog");

  const admin = response();
  await controller.getProduct({ catalogAdmin: true, params: { serialNumber: "EC-2" } }, admin);
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.body.data.name, "Both");
});

test("related products on a public detail page omit hidden E-commerce products", async () => {
  await controller.getProduct({ params: { serialNumber: "CAT-1" } }, response());
  const related = captured.query.calls.populate.find((arg) => arg?.path === "relatedProducts");
  assert.ok(related?.match, "related products are filtered for public requests");
  assert.deepEqual(ids(matches(related.match, fixtures)), ["catalog", "legacy", "legacy-null"]);

  await controller.getProduct({ catalogAdmin: true, params: { serialNumber: "CAT-1" } }, response());
  const adminRelated = captured.query.calls.populate.find((arg) => arg?.path === "relatedProducts");
  assert.equal(adminRelated.match, undefined);
});

test("public family and subfamily counts exclude E-commerce products; admin counts do not", async () => {
  const [publicFamily] = await getFamilyTree();
  assert.equal(publicFamily.productCount, 3);
  assert.equal(publicFamily.subFamilies[0].productCount, 3);
  const [adminFamily] = await getFamilyTree({ admin: true });
  assert.equal(adminFamily.productCount, fixtures.length);
});

const option = {
  id: "color", name: "Color", type: "color",
  values: [{ id: "black", label: "Black", swatchHex: "#202020" }],
};
function structured(extra = {}) {
  const variants = v.generateCombinations([option], [], () => "variant-1").variants;
  return { variantSchemaVersion: 2, variantOptions: [option], variantsV2: variants, status: "draft", gallery: [], ...extra };
}

test("an explicit sales channel from the product editor sets salesMode and the legacy flag", () => {
  const before = { ...structured(), serialNumber: "P-1", salesMode: "ecommerce", isEcommerce: true };
  const toCatalog = prepare({ ...structured(), salesMode: "catalog" }, before);
  assert.equal(toCatalog.salesMode, "catalog");
  assert.equal(toCatalog.isEcommerce, false);

  const fromBoth = prepare({ ...structured(), salesMode: "ecommerce" }, { ...before, salesMode: "both", isEcommerce: false });
  assert.equal(fromBoth.salesMode, "ecommerce");
  assert.equal(fromBoth.isEcommerce, true);

  // Older clients that only send the flag keep the previous inference.
  const legacy = prepare({ ...structured(), isEcommerce: false }, before);
  assert.equal(legacy.salesMode, "both");
  const untouched = prepare({ ...structured() }, { ...before, salesMode: "both", isEcommerce: false });
  assert.equal(untouched.salesMode, "both");
});

test("simple products follow the explicit channel without changing publication", () => {
  const simple = { variantSchemaVersion: 2, variantOptions: [], variantsV2: [], status: "draft", serialNumber: "S-1" };
  const enabled = prepare({ ...simple, salesMode: "ecommerce" });
  assert.equal(enabled.salesMode, "ecommerce");
  assert.equal(enabled.commerce.published, false);
  const disabled = prepare({ ...simple, salesMode: "catalog" }, { ...simple, salesMode: "ecommerce", isEcommerce: true, commerce: enabled.commerce });
  assert.equal(disabled.salesMode, "catalog");
  assert.equal(disabled.commerce.published, false);
});
