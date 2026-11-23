const Product = require("../../models/product.model");
const Shipping = require("../../models/shippingConfig.model");
const { calculateShipping } = require("../shipping.service");
const { assert, priceItem, round, hash, can } = require("./domain");
async function calculate(input, user, session = null) {
  const items = [];
  const unique = new Set();
  for (const item of input.items) {
    const key = `${item.productId}:${item.variantId}`;
    assert(!unique.has(key), "Combine duplicate product/variant lines");
    unique.add(key);
    const product = await Product.findById(item.productId)
      .session(session)
      .lean();
    const line = priceItem(product, item);
    if (item.overrideUnitPrice !== undefined) {
      assert(
        can(user, "ecommerce.overridePrice"),
        "Price override permission required",
        403,
      );
      assert(item.overrideReason?.trim(), "Price override reason required");
      line.unitPrice = item.overrideUnitPrice;
      line.overrideReason = item.overrideReason;
      line.discount = 0;
      line.lineTotal = round(item.overrideUnitPrice * item.quantity);
    }
    items.push(line);
  }
  const config = await Shipping.findById("noest").session(session).lean();
  const delivery = {
    ...calculateShipping(config, input.delivery),
    address: input.delivery.address || null,
    tariffRevision: config.revision,
  };
  const subtotal = round(
    items.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
  );
  const discount = round(items.reduce((s, i) => s + i.discount, 0));
  const financials = {
    subtotal,
    discount,
    shippingFee: delivery.shippingFee,
    total: round(subtotal - discount + delivery.shippingFee),
    currency: "DZD",
  };
  return {
    items,
    delivery,
    financials,
    quoteFingerprint: hash({ items, delivery, financials }),
  };
}
module.exports = { calculate };
