const Product = require("../../models/product.model");
const { StockMovement } = require("../../models/commerceSupport.model");
const { assert } = require("./domain");
async function move(order, kind, user, session, reason) {
  for (const item of order.items.filter((i) => i.trackStock)) {
    const reserve = kind === "RESERVE";
    const record = await Product.findById(item.productId).select('variantSchemaVersion').session(session).lean();
    const structured = record?.variantSchemaVersion === 2;
    const result = await Product.updateOne(
      {
        _id: item.productId,
        ...(reserve ? { isActive: true, "commerce.published": true } : {}),
        "commerce.variants": {
          $elemMatch: {
            id: item.variantId,
            trackStock: true,
            ...(reserve
              ? { enabled: true, quantity: { $gte: item.quantity } }
              : {}),
          },
        },
      },
      {
        $inc: {
          "commerce.variants.$.quantity": reserve
            ? -item.quantity
            : item.quantity,
          "commerce.revision": 1,
          catalogRevision: 1,
          ...(structured ? { 'variantsV2.$[variant].stockQuantity': reserve ? -item.quantity : item.quantity } : {}),
          ...(kind === "RESTOCK"
            ? {}
            : {
                "commerce.reservedUnits": reserve
                  ? item.quantity
                  : -item.quantity,
              }),
        },
      },
      { session, ...(structured ? { arrayFilters: [{ 'variant.id': item.variantId }] } : {}) },
    );
    assert(
      result.modifiedCount === 1,
      reserve
        ? "Insufficient stock or unavailable variant"
        : "Inventory variant missing; manual reconciliation required",
      409,
      "OUT_OF_STOCK",
    );
    await StockMovement.create(
      [
        {
          productId: item.productId,
          variantId: item.variantId,
          orderId: order._id,
          quantity: reserve ? -item.quantity : item.quantity,
          kind,
          reason,
          actor: user.uid,
        },
      ],
      { session },
    );
  }
}
async function consume(order, session) {
  for (const item of order.items.filter((i) => i.trackStock)) {
    const result = await Product.updateOne(
      {
        _id: item.productId,
        "commerce.reservedUnits": { $gte: item.quantity },
      },
      {
        $inc: {
          "commerce.reservedUnits": -item.quantity,
          "commerce.revision": 1,
        },
      },
      { session },
    );
    assert(
      result.modifiedCount === 1,
      "Reserved inventory requires reconciliation",
      409,
    );
  }
}
async function reserve(order, user, session) {
  for (const item of order.items) {
    const product = await Product.findById(item.productId).session(session).lean();
    const variant = product?.commerce?.variants.find(v => v.id === item.variantId);
    assert(product?.isActive && product.commerce?.published && ['ecommerce', 'both'].includes(product.salesMode) && variant?.enabled, 'Product or variant is no longer available', 409);
    // Operational tracking follows current configuration; commercial snapshots stay intact.
    item.trackStock = Boolean(variant.trackStock);
    if (!item.trackStock) {
      // Serialize confirmation against a concurrent switch to stock tracking.
      const locked = await Product.updateOne({ _id: product._id, 'commerce.variants': { $elemMatch: { id: item.variantId, trackStock: false, enabled: true } } }, { $inc: { 'commerce.revision': 1 } }, { session });
      assert(locked.modifiedCount === 1, 'Inventory configuration changed. Retry confirmation.', 409);
    }
  }
  await move(order, 'RESERVE', user, session);
}
module.exports = { move, consume, reserve };
