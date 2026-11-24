const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const v = require("../src/services/products/variants");
const { prepare } = require("../src/services/products/catalog");
const { migrateVariants } = require("../src/services/products/migrateVariants");
const option = (id = "color", labels = ["Black", "White"]) => ({
  id,
  name: id,
  type: "custom",
  values: labels.map((label, i) => ({ id: `${id}-${i}`, label })),
});
function generated(options) {
  let i = 0;
  return v.generateCombinations(options, [], () => `variant-${i++}`).variants;
}
test("one option and Cartesian combinations use unique stable identities", () => {
  assert.equal(generated([option()]).length, 2);
  const options = [option(), option("size", ["S", "M", "L"])];
  const variants = generated(options);
  assert.equal(variants.length, 6);
  assert.equal(new Set(variants.map((row) => row.id)).size, 6);
  assert.equal(v.validateVariants(options, variants), true);
  assert.deepEqual(v.generateCombinations([]).variants, []);
});
test("rename and reorder preserve every identity and operational value", () => {
  const options = [option(), option("size")];
  const existing = generated(options).map((row) => ({
    ...row,
    stockQuantity: 9,
    priceOverride: 0,
    imageUrl: "image",
    sku: `CUSTOM-${row.id.toUpperCase()}`,
  }));
  const changed = structuredClone(options).reverse();
  changed[1].name = "Colour";
  changed[1].values[0].label = "Noir";
  changed[1].values.reverse();
  const result = v.generateCombinations(changed, existing);
  assert.equal(result.removed.length, 0);
  for (const row of result.variants) {
    const old = existing.find((x) => x.id === row.id);
    assert.ok(old);
    assert.equal(row.sku, old.sku);
    assert.equal(row.priceOverride, 0);
    assert.equal(row.stockQuantity, 9);
    assert.equal(row.imageUrl, "image");
  }
});
test("additions introduce only new variants; removals are explicitly reported", () => {
  const options = [option()];
  const existing = generated(options);
  const extended = [
    {
      ...options[0],
      values: [...options[0].values, { id: "new", label: "Chrome" }],
    },
  ];
  let id = 0;
  const next = v.generateCombinations(extended, existing, () => `new-${id++}`);
  assert.equal(next.variants.length, 3);
  assert.equal(next.variants[0].id, existing[0].id);
  const removed = v.generateCombinations(
    [{ ...options[0], values: [options[0].values[0]] }],
    existing,
  );
  assert.deepEqual(removed.removed, [existing[1]]);
});
test("duplicate option IDs, names and values and uncontrolled products are rejected", () => {
  assert.throws(() => generated([option(), option()]), /Duplicate option/);
  assert.throws(
    () => generated([option("a", ["same", " SAME "])]),
    /Duplicate option value/,
  );
  assert.throws(
    () =>
      generated([
        {
          ...option(),
          values: [
            { id: "a", label: "A" },
            { id: "a", label: "B" },
          ],
        },
      ]),
    /Duplicate option value/,
  );
  assert.equal(
    generated([
      option(
        "a",
        Array.from({ length: 10 }, (_, i) => String(i)),
      ),
      option(
        "b",
        Array.from({ length: 10 }, (_, i) => String(i)),
      ),
    ]).length,
    100,
  );
  assert.throws(
    () =>
      generated([
        option(
          "a",
          Array.from({ length: 11 }, (_, i) => String(i)),
        ),
        option(
          "b",
          Array.from({ length: 10 }, (_, i) => String(i)),
        ),
      ]),
    /Maximum 100/,
  );
});
test("invalid references, duplicate combinations and SKU collisions are rejected", () => {
  const options = [option()];
  const variants = generated(options);
  for (const change of [
    (rows) => {
      rows[1].selections = rows[0].selections;
    },
    (rows) => {
      rows[0].selections[0].valueId = "missing";
    },
    (rows) => {
      rows[1].sku = rows[0].sku;
    },
    (rows) => {
      rows[0].selections.push(rows[0].selections[0]);
    },
  ]) {
    const rows = structuredClone(variants);
    change(rows);
    assert.throws(() => v.validateVariants(options, rows));
  }
});
test("DZD inheritance retains explicit zero and rejects fractional cents", () => {
  assert.equal(v.effectivePrice({ priceOverride: 0 }, 1200), 0);
  assert.equal(v.effectivePrice({ priceOverride: null }, 1200), 1200);
  const options = [option()];
  const rows = generated(options);
  for (const value of [-1, 1.001, Infinity, NaN]) {
    rows[0].priceOverride = value;
    assert.throws(() => v.validateVariants(options, rows));
  }
  rows[0].priceOverride = 0;
  assert.equal(v.validateVariants(options, rows), true);
});
test("availability explicitly respects tracking, enabled state, and image fallback", () => {
  assert.equal(
    v.available({ isAvailable: true, trackInventory: false, stockQuantity: 0 }),
    true,
  );
  assert.equal(
    v.available({ isAvailable: true, trackInventory: true, stockQuantity: 0 }),
    false,
  );
  assert.equal(
    v.available({
      isAvailable: false,
      trackInventory: false,
      stockQuantity: 10,
    }),
    false,
  );
  assert.equal(
    v.available({ isAvailable: true, trackInventory: true, stockQuantity: 1 }),
    true,
  );
  assert.equal(v.imageFor({ imageUrl: null }, ["primary"]), "primary");
  assert.equal(v.imageFor({ imageUrl: "override" }, ["primary"]), "override");
  const rows = generated([option()]);
  rows[0].stockQuantity = -1;
  assert.throws(() => v.validateVariants([option()], rows));
  rows[0].stockQuantity = 0;
  rows[0].imageUrl = "unowned";
  assert.throws(() => v.validateVariants([option()], rows));
});
test("legacy conversion is repeatable, grouped and untracked, preserving the original input", () => {
  const product = {
    serialNumber: "legacy-1",
    prices: { productPrice: 100 },
    gallery: ["image"],
    productVariants: [
      {
        variantType: "color",
        variants: [
          { variantData: "Black" },
          { variantData: "White" },
          { variantData: " black " },
          {},
        ],
      },
      {
        variantType: "size",
        variants: [{ variantData: "S" }, { variantData: "L" }],
      },
    ],
  };
  const original = structuredClone(product);
  const converted = v.convertLegacy(product);
  assert.deepEqual(converted, v.convertLegacy(product));
  assert.deepEqual(product, original);
  assert.equal(converted.variantsV2.length, 4);
  for (const row of converted.variantsV2) {
    assert.equal(row.priceOverride, null);
    assert.equal(row.trackInventory, false);
    assert.equal(row.isAvailable, true);
  }
  assert.deepEqual(v.convertLegacy({ productVariants: [] }), {
    variantOptions: [],
    variantsV2: [],
  });
  assert.deepEqual(
    v.convertLegacy({ ...converted, variantSchemaVersion: 2 }),
    converted,
  );
});
test("commerce conversion preserves existing SKU, identity, price, stock and image", () => {
  const result = v.convertLegacy({
    gallery: ["image"],
    commerce: {
      options: [{ name: "Color", values: ["Black"] }],
      variants: [
        {
          id: "v1",
          sku: "sw-Legacy1",
          options: { Color: "Black" },
          price: 0,
          quantity: 8,
          trackStock: true,
          enabled: false,
          image: "image",
        },
      ],
    },
  });
  assert.deepEqual(
    { ...result.variantsV2[0], selections: [], sortOrder: 0 },
    {
      id: "v1",
      sku: "sw-Legacy1",
      selections: [],
      sortOrder: 0,
      priceOverride: 0,
      stockQuantity: 8,
      trackInventory: true,
      isAvailable: false,
      imageUrl: "image",
    },
  );
});
test("structured save projects compatibility fields and protects legacy writes and reserved inventory", () => {
  const options = [option()];
  const rows = generated(options);
  const input = {
    variantSchemaVersion: 2,
    variantOptions: options,
    variantsV2: rows,
    status: "draft",
    gallery: [],
  };
  const result = prepare(input, {
    productVariants: [{ variantType: "old", variants: [] }],
  });
  assert.equal(result.legacyVariantSnapshot[0].variantType, "old");
  assert.equal(result.productVariants[0].variantType, "color");
  assert.equal(result.commerce.variants[0].id, rows[0].id);
  assert.throws(
    () => prepare({ productVariants: [] }, input),
    /structured variant builder/,
  );
  assert.throws(
    () => prepare(input, { commerce: { reservedUnits: 1 } }),
    /reserved/,
  );
});
test("simple e-commerce products have an internal untracked purchase representation without fake admin options", () => {
  const input = {
    variantSchemaVersion: 2,
    variantOptions: [],
    variantsV2: [],
    status: "draft",
    isEcommerce: true,
    serialNumber: "simple",
  };
  const result = prepare(input);
  assert.deepEqual(result.variantsV2, []);
  assert.equal(result.commerce.variants[0].id, "base-simple");
  assert.equal(result.commerce.variants[0].trackStock, false);
});
test("publications distinguish mandatory content from recommendations", () => {
  const product = {
    name: "Mixer",
    productId: "M1",
    prices: { productPrice: 0 },
    family: "family",
    subFamily: "sub",
    gallery: ["image"],
  };
  assert.equal(v.readiness(product).ready, true);
  assert.equal(v.readiness(product).recommended.description, false);
  assert.equal(v.readiness({ ...product, gallery: [] }).ready, false);
});
test("migration dry run, idempotency, malformed data, and recovery are explicit", async () => {
  const rows = [
    {
      _id: "legacy",
      serialNumber: "legacy",
      productVariants: [
        { variantType: "Color", variants: [{ variantData: "Black" }] },
      ],
    },
    { _id: "simple", productVariants: [] },
    {
      _id: "converted",
      variantSchemaVersion: 2,
      productVariants: [{ variantType: "old" }],
    },
    { _id: "bad", serialNumber: "bad", productVariants: [option("invalid")] },
  ];
  let writes = 0;
  let fail = true;
  const Product = {
    find: () => ({
      lean: () => ({
        cursor: async function* () {
          yield* rows;
        },
      }),
    }),
    updateOne: async (query, update) => {
      writes++;
      if (fail) throw new Error("recoverable");
      Object.assign(
        rows.find((p) => p._id === query._id),
        update.$set,
      );
      return { modifiedCount: 1 };
    },
  };
  const dry = await migrateVariants({ Product });
  assert.equal(writes, 0);
  assert.equal(dry.converted, 2);
  assert.equal(dry.skipped, 2);
  const failed = await migrateVariants({ Product, dryRun: false });
  assert.equal(failed.failed, 2);
  fail = false;
  const recovered = await migrateVariants({ Product, dryRun: false });
  assert.equal(recovered.converted, 2);
  const repeated = await migrateVariants({ Product, dryRun: false });
  assert.equal(repeated.converted, 0);
  assert.equal(repeated.skipped, 4);
});
test("frontend and backend variant contracts remain byte-for-byte equivalent", (t) => {
  const root = path.resolve(__dirname, "../..");
  if (!fs.existsSync(path.join(root, "client/src/lib/productVariants.js")))
    return t.skip(
      "Frontend checkout is not present; parity is checked in the combined workspace",
    );
  const frontend = fs
    .readFileSync(path.join(root, "client/src/lib/productVariants.js"), "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .replace("export {", "module.exports = {");
  const backend = fs
    .readFileSync(
      path.join(root, "server/src/services/products/variants.js"),
      "utf8",
    )
    .replace(/\r\n/g, "\n")
    .trim();
  assert.equal(frontend, backend);
});
test("backend product metadata uses real content and preserves stored canonical URLs", () => {
  const metadata = require("../src/services/products/metadata");
  const product = {
    name: "Mixer",
    shortDescription: "<p>Brass mixer</p>",
    serialNumber: "serial",
    slug: "stable-slug",
    seo: {
      title: "Historical title",
      canonicalUrl: "https://example.test/stable-product",
    },
    gallery: ["image"],
    isActive: true,
  };
  const original = structuredClone(product);
  const result = metadata(product);
  assert.match(result.title, /^Mixer \| /);
  assert.equal(result.description, "Brass mixer");
  assert.equal(result.canonicalUrl, product.seo.canonicalUrl);
  assert.deepEqual(product, original);
});
