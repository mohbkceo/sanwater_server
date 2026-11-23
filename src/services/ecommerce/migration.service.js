const Order = require("../../models/ecommerceOrder.model");
const Customer = require("../../models/customer.model");
const transaction = require("./transaction");
const { allocateNumber } = require("./order.service");
const { assert, normalizePhone, round, hash } = require("./domain");
function classify(record) {
  if (
    record.source !== "landing_product_page" ||
    !record.pricing ||
    !record.delivery
  )
    return {
      action: "KEEP_QUOTATION",
      reason: "No reliable landing checkout evidence",
    };
  try {
    assert(
      !record.statusHistory?.some((entry) => entry.status !== "submitted"),
      "Progressed quotation history requires manual review",
    );
    assert(
      record.status === "submitted",
      "Historical commercial status requires manual review",
    );
    assert(
      record.items?.length === 1 && record.items[0].product,
      "Missing single product identity",
    );
    const item = record.items[0],
      p = record.pricing,
      d = record.delivery;
    assert(
      !p.currency || p.currency === "DZD",
      "Unexpected historical currency",
    );
    assert(
      Number.isInteger(item.quantity) && item.quantity > 0,
      "Invalid quantity",
    );
    assert(
      [p.unitPrice, p.subtotal, p.shippingFee, p.total].every(
        (n) => Number.isFinite(n) && n >= 0,
      ),
      "Missing historical price snapshots",
    );
    assert(
      round(p.unitPrice * item.quantity) === p.subtotal &&
        round(p.subtotal + p.shippingFee) === p.total,
      "Inconsistent historical prices",
    );
    assert(
      d.wilayaCode &&
        d.communeCode &&
        ["home", "stopDesk"].includes(d.deliveryType),
      "Missing delivery evidence",
    );
    assert(
      d.deliveryType === "home"
        ? typeof d.address === "string" && d.address.trim().length >= 5
        : Boolean(d.office?.code),
      "Missing historical address or pickup office",
    );
    normalizePhone(record.requester?.phone);
    return {
      action: "ELIGIBLE",
      reason: "Explicit checkout source and consistent immutable snapshots",
    };
  } catch (error) {
    return { action: "MANUAL_REVIEW", reason: error.message };
  }
}
async function migrate(record, userId) {
  assert(
    classify(record).action === "ELIGIBLE",
    "Record is not eligible for automatic migration",
  );
  const sourceRecord = `quotation:${record._id}`,
    existing = await Order.findOne({ sourceRecord }).lean();
  if (existing) return existing;
  const orderNumber = await allocateNumber();
  try {
    return await transaction(async (session) => {
      const phone = normalizePhone(record.requester.phone);
      const customer = await Customer.findOneAndUpdate(
        { phone },
        {
          $setOnInsert: {
            name: record.requester.fullName,
            phone,
            email: record.requester.email,
          },
        },
        { upsert: true, new: true, session },
      );
      const i = record.items[0],
        p = record.pricing;
      const order = new Order({
        orderNumber,
        source: "migration",
        sourceRecord,
        idempotencyKey: `migration:${record._id}`,
        requestHash: hash(record),
        customerId: customer._id,
        customer: {
          name: record.requester.fullName,
          phone,
          email: record.requester.email,
        },
        items: [
          {
            productId: i.product,
            variantId: null,
            name: i.productName,
            sku: i.productSerialNumber,
            options: {},
            unitPrice: p.unitPrice,
            quantity: i.quantity,
            discount: 0,
            lineTotal: p.subtotal,
            trackStock: false,
          },
        ],
        delivery: record.delivery,
        financials: {
          subtotal: p.subtotal,
          discount: 0,
          shippingFee: p.shippingFee,
          total: p.total,
          currency: p.currency || "DZD",
        },
        commercialStatus: "NEW",
        fulfillment: {
          stage: "LEGACY_UNINITIALIZED",
          requiresProduction: false,
        },
        originalData: record,
        legacyCreatedAt: record.createdAt,
        createdAt: record.createdAt,
        createdBy: userId,
        events: [
          {
            kind: "MIGRATED",
            actor: userId,
            at: new Date(),
            revision: 0,
            data: {
              sourceRecord,
              originalCreatedAt: record.createdAt,
              warning:
                "Variant and historical fulfillment unknown; review before confirmation",
            },
          },
        ],
      });
      await order.save({ session });
      return order.toObject();
    });
  } catch (error) {
    if (error.code === 11000) return Order.findOne({ sourceRecord }).lean();
    throw error;
  }
}
module.exports = { classify, migrate };
