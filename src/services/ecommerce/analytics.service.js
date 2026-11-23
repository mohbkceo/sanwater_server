const Order = require("../../models/ecommerceOrder.model");
const { round } = require("./domain");
const { filters } = require("./order.service");
function summarize(orders) {
  const days = new Map();
  let missingDates = 0;
  for (const order of orders) {
    const date = order.createdAt && new Date(order.createdAt);
    if (!date || Number.isNaN(date.getTime())) { missingDates++; continue; }
    const key = date.toISOString().slice(0,10);
    days.set(key,(days.get(key)||0)+1);
  }
  const count = (status) =>
    orders.filter((o) => o.commercialStatus === status).length;
  const confirmed = orders.filter((o) => o.confirmation?.confirmedAt);
  const delivered = orders.filter((o) => o.commercialStatus === "DELIVERED");
  const returned = count("RETURNED");
  const sum = (rows, get) => round(rows.reduce((s, row) => s + get(row), 0));
  const received = (o) =>
    round(o.payment.paid + o.payment.collected - o.payment.refunded);
  const realized = (o) =>
    o.commercialStatus === "DELIVERED"
      ? Math.max(
          0,
          o.financials.subtotal - o.financials.discount - o.payment.refunded,
        )
      : 0;
  const group = (key, rows = orders) => {
    const map = new Map();
    for (const o of rows) {
      const id = key(o) || "unknown",
        old = map.get(id) || { name: id, orders: 0, revenue: 0 };
      old.orders++;
      old.revenue = round(old.revenue + realized(o));
      map.set(id, old);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  };
  const products = new Map();
  for (const o of orders)
    for (const i of o.items) {
      const key = `${i.productId}:${i.variantId}`,
        row = products.get(key) || {
          productId: i.productId,
          variantId: i.variantId,
          name: i.name,
          sku: i.sku,
          orders: 0,
          units: 0,
          revenue: 0,
        };
      row.orders++;
      row.units += i.quantity;
      const merchandise = o.financials.subtotal - o.financials.discount;
      if (o.commercialStatus === "DELIVERED")
        row.revenue = round(
          row.revenue +
            (merchandise ? (i.lineTotal * realized(o)) / merchandise : 0),
        );
      products.set(key, row);
    }
  return {
    timeSeries: { rows:[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>({date,value})),unit:'orders',missing:missingDates?'unknown':'zero',coverage:'persisted',missingDates },
    distribution: { rows:[...new Set(orders.map(order=>order.commercialStatus))].map(label=>({label,value:orders.filter(order=>order.commercialStatus===label).length})),unit:'orders',currentState:true },
    totalOrders: orders.length,
    pendingConfirmation: count("NEW"),
    confirmedOrders: confirmed.length,
    deliveredOrders: delivered.length,
    cancelledOrders: count("CANCELLED"),
    returnedOrders: returned,
    confirmationRate: orders.length
      ? round((confirmed.length / orders.length) * 100)
      : 0,
    deliverySuccessRate:
      delivered.length + returned
        ? round((delivered.length / (delivered.length + returned)) * 100)
        : 0,
    grossSales: sum(
      confirmed.filter((o) => o.commercialStatus !== "CANCELLED"),
      (o) => o.financials.subtotal - o.financials.discount,
    ),
    netRealizedRevenue: sum(delivered, realized),
    averageOrderValue: delivered.length
      ? round(
          sum(delivered, (o) => o.financials.subtotal - o.financials.discount) /
            delivered.length,
        )
      : 0,
    outstandingCollections: sum(delivered, (o) =>
      Math.max(0, o.financials.total - received(o)),
    ),
    bySource: group((o) => o.source),
    byWilaya: group((o) => o.delivery.wilayaName),
    byProduct: [...products.values()],
    definitions: {
      date: "Order createdAt in selected UTC interval; current state of that cohort",
      confirmationRate: "Ever confirmed / all orders",
      deliverySuccessRate: "Delivered / (delivered + returned)",
      revenue:
        "Current delivered merchandise less refunds capped at merchandise value. Refunds reduce merchandise first, then shipping. Returned/cancelled revenue is zero. Delivery does not imply payment.",
    },
  };
}
async function report(query, user) {
  return summarize(
    await Order.find(filters(query, user))
      .select(
        "commercialStatus confirmation.confirmedAt financials payment items source delivery.wilayaName createdAt",
      )
      .lean(),
  );
}
module.exports = { report, summarize };
