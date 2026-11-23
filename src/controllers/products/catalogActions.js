const { randomUUID } = require("node:crypto");
const Product = require("../../models/product.model");
const catalog = require("../../services/products/catalog");
const variants = require("../../services/products/variants");
const {
  resolveSubFamilyAssignment,
} = require("../../services/taxonomy.service");
const { logActivity } = require("../../utils/logger");
const errorHandler = require("../../utils/error.middleware");
async function duplicate(req, res) {
  try {
    const original = await Product.findOne({
      serialNumber: req.params.serialNumber,
    }).lean();
    if (!original)
      return res.status(404).json({ message: "Product not found" });
    const copy = { ...original };
    for (const key of [
      "_id",
      "__v",
      "slug",
      "seo",
      "createdAt",
      "updatedAt",
      "commerce",
      "salesMode",
      "catalogRevision",
      "legacyVariantSnapshot",
    ])
      delete copy[key];
    copy.serialNumber = `product-${randomUUID()}`;
    copy.author = req.user.email || req.user.uid;
    copy.name = original.name;
    copy.productId = `${original.productId.slice(0, 35)}-${randomUUID().slice(0, 8).toUpperCase()}`;
    copy.status = "draft";
    copy.isActive = false;
    const converted = variants.convertLegacy(original);
    copy.variantSchemaVersion = 2;
    copy.variantOptions = converted.variantOptions;
    copy.variantsV2 = converted.variantsV2.map((v) => {
      const id = randomUUID();
      return { ...v, id, sku: `SW-${id.toUpperCase()}`, stockQuantity: 0 };
    });
    const product = new Product(catalog.prepare(copy));
    await product.save();
    await product.populate("family subFamily");
    await logActivity(req, "CREATE", "Product", product.serialNumber, {
      message: "Duplicated as draft; tracked stock reset to zero",
      source: original.serialNumber,
    });
    res.status(201).json({ data: catalog.serialize(product) });
  } catch (error) {
    errorHandler(res, error);
  }
}
async function bulk(req, res) {
  try {
    const { items, changes } = req.body;
    const assignment = changes.subFamily
      ? await resolveSubFamilyAssignment(changes.subFamily)
      : {};
    const results = [];
    // Bounded batch, four concurrent writes; each has its own compare-and-swap.
    for (let start = 0; start < items.length; start += 4) {
      results.push(
        ...(await Promise.all(
          items.slice(start, start + 4).map(async (item) => {
            try {
              const product = await Product.findOne({
                serialNumber: item.serialNumber,
              });
              if (!product)
                return {
                  serialNumber: item.serialNumber,
                  success: false,
                  message: "Product not found",
                };
              const input = {
                ...changes,
                ...assignment,
                catalogRevision: item.catalogRevision,
              };
              await catalog.update(item.serialNumber, input, product);
              await logActivity(req, "UPDATE", "Product", item.serialNumber, {
                message: "Bulk catalog update",
                changes,
              });
              return { serialNumber: item.serialNumber, success: true };
            } catch (error) {
              return {
                serialNumber: item.serialNumber,
                success: false,
                message: error.message,
                code: error.key,
              };
            }
          }),
        )),
      );
    }
    res.json({
      data: {
        results,
        succeeded: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      },
    });
  } catch (error) {
    errorHandler(res, error);
  }
}
async function health(req, res) {
  try {
    const rows = await Product.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          essentialsComplete: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $ifNull: ["$name", ""] }, ""] },
                    { $ne: [{ $ifNull: ["$productId", ""] }, ""] },
                    { $ne: [{ $ifNull: ["$family", null] }, null] },
                    { $ne: [{ $ifNull: ["$subFamily", null] }, null] },
                    { $isNumber: "$prices.productPrice" },
                    { $gte: ["$prices.productPrice", 0] },
                    { $gt: [{ $size: { $ifNull: ["$gallery", []] } }, 0] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);
    res.json({ data: rows[0] || { total: 0, essentialsComplete: 0 } });
  } catch (error) {
    errorHandler(res, error);
  }
}
module.exports = { duplicate, bulk, health };
