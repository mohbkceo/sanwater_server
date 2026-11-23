const Product = require("../../models/product.model");
const {
  validateVariants,
  legacyProjection,
  commerceProjection,
  readiness,
  summary,
} = require("./variants");
const Exception = require("../../utils/CostumeException");
const conflict = (message) => {
  throw new Exception(message, 409, "STALE_REVISION");
};
const plain = (doc) => (doc?.toObject ? doc.toObject() : doc);
function prepare(input, previous = {}) {
  const before = plain(previous);
  const data = { ...input };
  delete data.catalogRevision;
  if (input.prices) data.prices = { ...before.prices, ...input.prices };
  if (
    input.gallery &&
    before.variantSchemaVersion !== 2 &&
    before.commerce?.variants?.some(
      (v) => v.image && !input.gallery.includes(v.image),
    )
  )
    throw new Exception(
      "Convert existing variants before removing an assigned image.",
      422,
      "INVALID_VARIANTS",
    );
  const structured = [
    "variantOptions",
    "variantsV2",
    "variantSchemaVersion",
  ].some((key) => key in input);
  if (
    before.variantSchemaVersion === 2 &&
    input.productVariants &&
    !structured
  ) {
    throw new Exception(
      "Edit variants through the structured variant builder.",
      409,
      "VARIANTS_V2_REQUIRED",
    );
  }
  if (structured) {
    if (
      input.variantSchemaVersion !== 2 ||
      !input.variantOptions ||
      !input.variantsV2
    )
      throw new Exception(
        "Send the complete structured variant configuration.",
        422,
        "INVALID_VARIANTS",
      );
    if ((before.commerce?.reservedUnits || 0) > 0)
      conflict(
        "Inventory is reserved by an order. Finish or cancel it before changing variant configuration.",
      );
    validateVariants(
      input.variantOptions,
      input.variantsV2,
      input.gallery || before.gallery || [],
    );
    const prior = new Map((before.variantsV2 || []).map((v) => [v.id, v]));
    const { combinationKey } = require("./variants");
    const existingCombinations = new Map(
      (before.variantsV2 || []).map((v) => [
        combinationKey(v.selections),
        v.id,
      ]),
    );
    for (const variant of input.variantsV2) {
      const old = prior.get(variant.id);
      if (
        old &&
        combinationKey(old.selections) !== combinationKey(variant.selections)
      )
        throw new Exception(
          "An existing variant identity cannot be reassigned to a different combination.",
          422,
          "INVALID_VARIANTS",
        );
      if (
        existingCombinations.has(combinationKey(variant.selections)) &&
        existingCombinations.get(combinationKey(variant.selections)) !==
          variant.id
      )
        throw new Exception(
          "Preserve the identity of an unchanged combination.",
          422,
          "INVALID_VARIANTS",
        );
    }
    if (before.variantSchemaVersion !== 2)
      data.legacyVariantSnapshot = before.productVariants || [];
    data.productVariants = legacyProjection(input.variantOptions);
  }
  const merged = {
    ...before,
    ...data,
    prices: { ...before.prices, ...data.prices },
  };
  if (merged.variantSchemaVersion === 2) {
    validateVariants(
      merged.variantOptions || [],
      merged.variantsV2 || [],
      merged.gallery || [],
    );
    if (merged.variantsV2?.length) {
      data.commerce = commerceProjection(merged);
      data.commerce.published =
        merged.status === "published" && merged.isActive === true;
      data.commerce.revision = (before.commerce?.revision || 0) + 1;
      data.salesMode = merged.isEcommerce
        ? "ecommerce"
        : ["ecommerce", "both"].includes(before.salesMode)
          ? "both"
          : "catalog";
    } else if (merged.isEcommerce) {
      const id = `base-${merged.serialNumber || before.serialNumber}`;
      data.commerce = {
        ...before.commerce,
        published: merged.status === "published" && merged.isActive === true,
        revision: (before.commerce?.revision || 0) + 1,
        options: [],
        variants: [
          {
            id,
            sku: id.toUpperCase(),
            options: {},
            price: null,
            image: "",
            enabled: true,
            trackStock: false,
            quantity: 0,
          },
        ],
      };
      data.salesMode = "ecommerce";
    } else if (before.commerce) {
      data.commerce = {
        ...before.commerce,
        options: [],
        variants: [],
        published: false,
        revision: (before.commerce.revision || 0) + 1,
      };
    }
    // Only enforce readiness when publishing or changing a published product's essentials.
    if (
      merged.status === "published" &&
      merged.isActive === true &&
      !readiness(merged).ready
    )
      throw new Exception(
        "Complete the required publication fields.",
        422,
        "PRODUCT_NOT_READY",
        readiness(merged).required,
      );
  }
  return data;
}
async function update(serialNumber, input, previous) {
  const before = plain(previous);
  const data = prepare(input, before);
  const requiresRevision =
    before.variantSchemaVersion === 2 || "variantsV2" in input;
  if (
    requiresRevision &&
    input.catalogRevision !== (before.catalogRevision || 0)
  )
    conflict(
      "Product changed. Reload before saving; your edits have been kept.",
    );
  const criteria = { serialNumber, updatedAt: before.updatedAt };
  // Matches unversioned legacy records as revision zero.
  criteria.$or =
    (before.catalogRevision || 0) === 0
      ? [{ catalogRevision: 0 }, { catalogRevision: { $exists: false } }]
      : [{ catalogRevision: before.catalogRevision }];
  if (before.commerce)
    criteria["commerce.revision"] = before.commerce.revision || 0;
  const product = await Product.findOneAndUpdate(
    criteria,
    { $set: data, $inc: { catalogRevision: 1 } },
    { new: true, runValidators: true },
  )
    .populate("family", "name slug")
    .populate("subFamily", "name slug family");
  if (!product)
    conflict(
      "Product changed. Reload before saving; your edits have been kept.",
    );
  return product;
}
function serialize(doc) {
  const product = plain(doc);
  return product
    ? {
        ...product,
        catalogSummary: summary(product),
        metadata: require("./metadata")(product),
      }
    : product;
}
module.exports = { prepare, update, serialize };
