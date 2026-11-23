const Product = require("../../models/product.model");
const Order = require("../../models/ecommerceOrder.model");
const {
  ProductEvent,
  StockMovement,
} = require("../../models/commerceSupport.model");
const { resolveSubFamilyAssignment } = require("../taxonomy.service");
const transaction = require("./transaction");
const { assert, validateCommerce, combinationKey } = (() => {
  const d = require("./domain");
  return {
    ...d,
    combinationKey: (options) =>
      JSON.stringify(
        Object.entries(options || {}).sort(([a], [b]) => a.localeCompare(b)),
      ),
  };
})();
const { randomUUID } = require("node:crypto");
async function save(id, input, user) {
  validateCommerce(input.commerce, input.basePrice);
  return transaction(async (session) => {
    const product = id
      ? await Product.findById(id).session(session)
      : new Product({
          author: user.email || user.uid,
          serialNumber: `EC-${randomUUID()}`,
          productId: input.productId,
          isActive: true,
        });
    assert(product, "Product not found", 404);
    assert(product.variantSchemaVersion !== 2, 'This product uses structured variants. Edit it through Products.', 409, 'VARIANTS_V2_REQUIRED');
    assert(
      !input.commerce.published || product.isActive,
      "Activate product in catalog before publishing",
    );
    assert(
      (product.commerce?.revision || 0) === input.revision,
      "Product changed. Reload before saving.",
      409,
      "STALE_REVISION",
    );
    for (const old of product.commerce?.variants || []) {
      const next = input.commerce.variants.find((v) => v.id === old.id);
      if (next)
        assert(
          combinationKey(next.options) === combinationKey(old.options),
          "Existing variant identity cannot change",
        );
      const held = await Order.exists({
        inventoryState: "RESERVED",
        items: {
          $elemMatch: {
            productId: product._id,
            variantId: old.id,
            trackStock: true,
          },
        },
      }).session(session);
      assert(
        !held || (next && next.trackStock),
        "A reserved variant cannot be removed or have tracking disabled",
        409,
      );
      if (next && next.quantity !== old.quantity)
        await StockMovement.create(
          [
            {
              productId: product._id,
              variantId: old.id,
              quantity: next.quantity - old.quantity,
              kind: "ADJUST",
              reason: "Product inventory adjustment",
              actor: user.uid,
            },
          ],
          { session },
        );
    }
    for (const variant of input.commerce.variants) {
      if (
        variant.trackStock &&
        variant.quantity > 0 &&
        !product.commerce?.variants.some((v) => v.id === variant.id)
      )
        await StockMovement.create(
          [
            {
              productId: product._id,
              variantId: variant.id,
              quantity: variant.quantity,
              kind: "INITIAL",
              actor: user.uid,
            },
          ],
          { session },
        );
    }
    let assignment = {};
    if (input.subFamily)
      assignment = await resolveSubFamilyAssignment(input.subFamily, {
        session,
      });
    else if (input.subFamily !== undefined)
      assignment = { family: null, subFamily: null };
    Object.assign(product, assignment, {
      name: input.name,
      productId: input.productId,
      description: input.description ?? product.description,
      gallery: input.gallery ?? product.gallery ?? [],
      salesMode: input.salesMode,
      isEcommerce: input.salesMode === "ecommerce",
      prices: {
        ...product.toObject().prices,
        productPrice: input.basePrice,
      },
      commerce: {
        ...(product.commerce?.toObject() || {}),
        ...input.commerce,
        reservedUnits: product.commerce?.reservedUnits || 0,
        revision: input.revision + 1,
      },
    });
    await product.save({ session });
    await ProductEvent.create(
      [
        {
          productId: product._id,
          revision: product.commerce.revision,
          actor: user.uid,
          data: input,
        },
      ],
      { session },
    );
    return product.toObject();
  });
}
function publicProduct(product) {
  return {
    metadata: require('../products/metadata')(product),
    _id: product._id,
    serialNumber: product.serialNumber,
    slug: product.slug,
    name: product.name,
    productId: product.productId,
    description: product.description,
    gallery: product.gallery,
    prices: { productPrice: product.prices?.productPrice },
    variants: product.commerce.variants
      .filter((v) => v.enabled)
      .map((v) => ({
        id: v.id,
        sku: v.sku,
        options: v.options || {},
        price: v.price,
        image: v.image,
        available: !v.trackStock || v.quantity > 0,
      })),
    offer: product.commerce.offer,
    options: product.commerce.options,
  };
}
module.exports = { save, publicProduct };
