const {
  convertLegacy,
  validateVariants,
  legacyProjection,
  commerceProjection,
} = require("./variants");
async function migrateVariants({
  Product,
  dryRun = true,
  onRecord = () => {},
}) {
  const summary = {
    dryRun,
    scanned: 0,
    converted: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };
  for await (const product of Product.find({}).lean().cursor()) {
    summary.scanned++;
    if (
      product.variantSchemaVersion === 2 ||
      (!product.productVariants?.length && !product.commerce?.variants?.length)
    ) {
      summary.skipped++;
      continue;
    }
    try {
      if (product.commerce?.reservedUnits > 0)
        throw new Error(
          "Reserved inventory: finish active orders before conversion",
        );
      const converted = convertLegacy(product);
      validateVariants(
        converted.variantOptions,
        converted.variantsV2,
        product.gallery || [],
      );
      const changes = {
        ...converted,
        variantSchemaVersion: 2,
        legacyVariantSnapshot: product.productVariants || [],
        productVariants: legacyProjection(converted.variantOptions),
      };
      if (converted.variantsV2.length) {
        changes.commerce = commerceProjection({ ...product, ...changes });
        // Migration preserves visibility, eligibility and all existing publication flags.
        if (!product.commerce)
          changes.commerce.published =
            product.isActive === true && product.status === "published";
        changes.commerce.revision = (product.commerce?.revision || 0) + 1;
      }
      if (!dryRun) {
        const result = await Product.updateOne(
          {
            _id: product._id,
            variantSchemaVersion: { $ne: 2 },
            updatedAt: product.updatedAt,
          },
          { $set: changes, $inc: { catalogRevision: 1 } },
          { runValidators: true },
        );
        if (result.modifiedCount !== 1)
          throw new Error("Concurrent change: rerun conversion");
      }
      summary.converted++;
      onRecord({
        serialNumber: product.serialNumber,
        outcome: dryRun ? "would-convert" : "converted",
      });
    } catch (error) {
      summary.failed++;
      summary.failures.push({
        serialNumber: product.serialNumber,
        message: error.message,
      });
      onRecord({
        serialNumber: product.serialNumber,
        outcome: "failed",
        message: error.message,
      });
    }
  }
  return summary;
}
module.exports = { migrateVariants };
