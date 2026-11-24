const { createHash, randomUUID } = require("node:crypto");
const ErrorResponse = require("../../utils/CostumeException");
const MAX_LINE_QUANTITY = 1000;
const fail = (message, status = 422, key = "ECOMMERCE_INVALID") => {
  throw new ErrorResponse(message, status, key);
};
const assert = (condition, message, status, key) => {
  if (!condition) fail(message, status, key);
};
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function normalizePhone(value) {
  let digits = String(value || "")
    .replace(/[\s().-]/g, "")
    .replace(/^(?:\+213|00213)0?/, "0");
  if (/^(?:[567]\d{8}|[234]\d{7}|9(?:61|82)\d{6})$/.test(digits)) digits = `0${digits}`;
  assert(/^0(?:[567]\d{8}|[234]\d{7}|9(?:61|82)\d{6})$/.test(digits), "Invalid Algerian phone");
  return `+213${digits.slice(1)}`;
}
function sourceItemsMatch(sourceItems, items) {
  const rows = sourceItems.map((i) => ({
    productId: i.productId || i.product || null,
    quantity: i.quantity,
  }));
  if (rows.some((i) => !i.productId))
    return (
      rows.length === items.length &&
      rows.every(
        (row, index) =>
          row.quantity === items[index].quantity &&
          (!row.productId ||
            String(row.productId) === String(items[index].productId)),
      )
    );
  const quantities = (list) =>
    Object.entries(
      list.reduce((map, i) => {
        const id = String(i.productId);
        map[id] = (map[id] || 0) + i.quantity;
        return map;
      }, {}),
    ).sort();
  return hash(quantities(rows)) === hash(quantities(items));
}
const STATES = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY_TO_SHIP", "CANCELLED"],
  READY_TO_SHIP: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY", "RETURNING"],
  OUT_FOR_DELIVERY: ["DELIVERED", "FAILED_DELIVERY", "RETURNING"],
  FAILED_DELIVERY: ["OUT_FOR_DELIVERY", "RETURNING"],
  RETURNING: ["RETURNED"],
  DELIVERED: ["RETURNING"],
  RETURNED: [],
  CANCELLED: [],
};
const permissionFor = (target) =>
  target === "CONFIRMED"
    ? "ecommerce.confirm"
    : target === "CANCELLED"
      ? "ecommerce.cancel"
      : ["PREPARING", "READY_TO_SHIP"].includes(target)
        ? "ecommerce.fulfill"
        : "ecommerce.ship";
const can = (user, permission) =>
  Boolean(
    user &&
      (user.role === "super_admin" || user.permissions?.includes(permission)),
  );
const blocked = (order) =>
  order.issues?.some(
    (i) => i.status === "OPEN" && (i.blocking || i.severity === "CRITICAL"),
  );
function targets(order, user) {
  if (order.fulfillment.stage === "LEGACY_UNINITIALIZED")
    return can(user, "ecommerce.cancel") ? ["CANCELLED"] : [];
  return (STATES[order.commercialStatus] || []).filter(
    (target) =>
      can(user, permissionFor(target)) &&
      (!blocked(order) ||
        !["PREPARING", "READY_TO_SHIP", "SHIPPED", "OUT_FOR_DELIVERY"].includes(
          target,
        )) &&
      !(
        target === "SHIPPED" &&
        (!order.shipment?.agency || !order.shipment?.trackingNumber)
      ) &&
      !(
        target === "READY_TO_SHIP" &&
        order.fulfillment.requiresProduction &&
        order.fulfillment.stage !== "PREPARED"
      ),
  );
}
const combinationKey = (options) =>
  JSON.stringify(
    Object.entries(options || {}).sort(([a], [b]) => a.localeCompare(b)),
  );
function generateVariants(options = [], existing = [], prefix = "SW") {
  assert(options.length <= 4, "Maximum four option types");
  assert(
    new Set(options.map((o) => o.name.toLowerCase())).size === options.length,
    "Duplicate option type",
  );
  let combinations = [{}];
  for (const option of options) {
    assert(
      option.name?.trim() &&
        option.values?.length &&
        option.values.length <= 20,
      "Invalid option values",
    );
    assert(
      new Set(option.values.map((v) => v.trim().toLowerCase())).size ===
        option.values.length,
      "Duplicate option value",
    );
    assert(
      combinations.length * option.values.length <= 100,
      "Maximum 100 variants",
    );
    combinations = combinations.flatMap((c) =>
      option.values.map((v) => ({ ...c, [option.name.trim()]: v.trim() })),
    );
  }
  return combinations.map((options) => {
    const old = existing.find(
      (v) => combinationKey(v.options) === combinationKey(options),
    );
    return old
      ? { ...old, options }
      : {
          id: randomUUID(),
          sku: `${prefix}-${randomUUID().slice(0, 8)}`,
          options,
          price: null,
          image: "",
          enabled: true,
          trackStock: false,
          quantity: 0,
        };
  });
}
function validateCommerce(commerce, basePrice) {
  assert(Number.isFinite(basePrice) && basePrice >= 0, "Base price required");
  const variants = commerce.variants || [];
  assert(
    variants.length > 0 && variants.length <= 100,
    "Generate sellable variants first",
  );
  assert(
    new Set(variants.map((v) => v.id)).size === variants.length,
    "Duplicate variant ID",
  );
  assert(
    new Set(variants.map((v) => v.sku)).size === variants.length,
    "Duplicate SKU",
  );
  assert(
    new Set(variants.map((v) => combinationKey(v.options))).size ===
      variants.length,
    "Duplicate variant combination",
  );
  const expected = generateVariants(commerce.options, variants);
  assert(
    expected.length === variants.length &&
      expected.every((v) =>
        variants.some(
          (x) => combinationKey(x.options) === combinationKey(v.options),
        ),
      ),
    "Variants must match option combinations",
  );
  for (const v of variants) {
    assert(v.id && v.sku?.trim(), "Variant ID and SKU required");
    assert(
      v.price == null || (Number.isFinite(v.price) && v.price >= 0),
      "Invalid variant price",
    );
    assert(
      Number.isInteger(v.quantity) && v.quantity >= 0,
      "Invalid stock quantity",
    );
  }
  const offer = commerce.offer;
  if (offer?.enabled) {
    assert(
      ["percentage", "fixed", "quantity"].includes(offer.type),
      "Invalid discount type",
    );
    assert(
      Number.isFinite(offer.value) &&
        offer.value > 0 &&
        (offer.type !== "percentage" || offer.value <= 100),
      "Invalid discount",
    );
    assert(
      offer.type !== "quantity" ||
        (Number.isInteger(offer.minQuantity) && offer.minQuantity >= 2),
      "Invalid quantity threshold",
    );
    assert(
      !offer.startsAt ||
        !offer.endsAt ||
        new Date(offer.startsAt) <= new Date(offer.endsAt),
      "Invalid offer dates",
    );
  }
  assert(
    !commerce.published || variants.some((v) => v.enabled),
    "Enable a variant before publishing",
  );
}
function priceItem(product, item, now = new Date()) {
  assert(
    product?.isActive &&
      product.commerce?.published &&
      ["ecommerce", "both"].includes(product.salesMode),
    "Product is not available for sale",
    422,
    "PRODUCT_UNAVAILABLE",
  );
  const variant = product.commerce.variants.find(
    (v) => v.id === item.variantId,
  );
  assert(variant?.enabled, "Select an enabled variant", 422, "VARIANT_UNAVAILABLE");
  assert(
    Number.isInteger(item.quantity) &&
      item.quantity >= 1 &&
      item.quantity <= MAX_LINE_QUANTITY,
    "Invalid quantity",
  );
  assert(
    !variant.trackStock || variant.quantity >= item.quantity,
    "Insufficient stock",
    409,
    "OUT_OF_STOCK",
  );
  const unitPrice = variant.price ?? product.prices?.productPrice;
  assert(
    Number.isFinite(unitPrice) && unitPrice >= 0,
    "Product price unavailable",
  );
  const originalTotal = round(unitPrice * item.quantity);
  const offer = product.commerce.offer;
  let discount = 0;
  if (
    offer?.enabled &&
    (!offer.startsAt || now >= new Date(offer.startsAt)) &&
    (!offer.endsAt || now <= new Date(offer.endsAt))
  ) {
    if (offer.type === "percentage")
      discount = round((originalTotal * offer.value) / 100);
    if (
      offer.type === "fixed" ||
      (offer.type === "quantity" && item.quantity >= offer.minQuantity)
    )
      discount = round(offer.value * item.quantity);
  }
  discount = Math.min(originalTotal, discount);
  return {
    productId: product._id,
    variantId: variant.id,
    name: product.name || product.productId,
    sku: variant.sku,
    options: variant.options || {},
    image: variant.image || product.gallery?.[0] || "",
    unitPrice,
    quantity: item.quantity,
    discount,
    lineTotal: round(originalTotal - discount),
    trackStock: variant.trackStock,
    requiresProduction: Boolean(product.commerce.requiresProduction),
  };
}
module.exports = {
  MAX_LINE_QUANTITY,
  assert,
  fail,
  hash,
  round,
  normalizePhone,
  sourceItemsMatch,
  STATES,
  can,
  targets,
  permissionFor,
  blocked,
  generateVariants,
  validateCommerce,
  priceItem,
};
