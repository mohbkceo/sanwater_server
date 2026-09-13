const mongoose = require("mongoose");
const Event = require("../models/event.model");
const Lead = require("../models/lead.model");
const Product = require("../models/product.model");
const {
  MAX_ACTIVE_INSIGHTS,
  MATERIAL_PERCENTAGE_CHANGE,
  MIN_FUNNEL_STAGE_VOLUME,
  QUALIFIED_LEAD_STATUSES,
  VALID_ORDER_LEAD_STATUSES,
} = require("../config/businessAnalytics");
const {
  classifyProducts,
  comparison,
  median,
  mongoRange,
  resolvePeriod,
  safeRate,
  serializePeriod,
} = require("./analytics.helpers");

const EVENT_IDENTITY = {
  $cond: [
    { $and: [{ $ne: ["$visitor_id", null] }, { $ne: ["$visitor_id", ""] }] },
    "$visitor_id",
    { $concat: ["session:", "$session_id"] },
  ],
};

function buildStageMatch(statuses, from, to) {
  const changedAt = mongoRange(from, to);
  const createdAt = mongoRange(from, to);
  return {
    $or: [
      { statusHistory: { $elemMatch: { newStatus: { $in: statuses }, changedAt } } },
      {
        $and: [
          { status: { $in: statuses } },
          { createdAt },
          { statusHistory: { $not: { $elemMatch: { newStatus: { $in: statuses } } } } },
        ],
      },
    ],
  };
}

function buildOrderMatch(from, to) {
  return {
    $and: [
      { status: { $in: VALID_ORDER_LEAD_STATUSES } },
      buildStageMatch(VALID_ORDER_LEAD_STATUSES, from, to),
    ],
  };
}

async function uniqueEventVisitors(from, to, type = "page_view") {
  const rows = await Event.aggregate([
    { $match: { type, ts: mongoRange(from, to), device: { $ne: "bot" } } },
    { $group: { _id: EVENT_IDENTITY } },
    { $count: "count" },
  ]);
  return rows[0]?.count || 0;
}

async function commercialMetrics(from, to) {
  const qualifiedMatch = buildStageMatch(QUALIFIED_LEAD_STATUSES, from, to);
  const orderMatch = buildOrderMatch(from, to);
  const [visitors, qualifiedRows, qualifiedVisitorRows, orderRows] = await Promise.all([
    uniqueEventVisitors(from, to),
    Lead.aggregate([{ $match: qualifiedMatch }, { $count: "count" }]),
    Lead.aggregate([
      { $match: { ...qualifiedMatch, visitorId: { $nin: [null, ""] } } },
      { $group: { _id: "$visitorId" } },
      { $count: "count" },
    ]),
    Lead.aggregate([
      { $match: orderMatch },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: { $sum: { $ifNull: ["$finalValue", 0] } },
          ordersWithoutRevenue: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$finalValue", null] }, null] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const qualifiedLeads = qualifiedRows[0]?.count || 0;
  const qualifiedVisitors = qualifiedVisitorRows[0]?.count || 0;
  const orders = orderRows[0]?.orders || 0;
  const revenue = orderRows[0]?.revenue || 0;
  return {
    visitors,
    qualifiedLeads,
    qualifiedVisitors,
    orders,
    revenue,
    ordersWithoutRevenue: orderRows[0]?.ordersWithoutRevenue || 0,
    visitorToLeadRate: safeRate(qualifiedVisitors, visitors),
    leadToOrderRate: safeRate(orders, qualifiedLeads),
    averageOrderValue: orders > 0 ? revenue / orders : null,
  };
}

function comparableRate(current, previous, key) {
  if (current[key] == null) {
    return { current: null, previous: previous[key] ?? null, absoluteChange: null, percentageChange: null, changeState: "unavailable", available: false };
  }
  const result = comparison(current[key], previous[key] || 0);
  return { ...result, available: true };
}

function buildKpis(current, previous) {
  const aov = comparableRate(current, previous, "averageOrderValue");
  return {
    revenue: comparison(current.revenue, previous.revenue),
    orders: comparison(current.orders, previous.orders),
    qualifiedLeads: comparison(current.qualifiedLeads, previous.qualifiedLeads),
    visitorToLead: comparableRate(current, previous, "visitorToLeadRate"),
    leadToOrder: comparableRate(current, previous, "leadToOrderRate"),
    averageOrderValue: aov,
  };
}

async function eventFunnelCounts(from, to) {
  const types = ["page_view", "product_view", "product_inquiry_started", "lead_submitted"];
  const rows = await Event.aggregate([
    { $match: { type: { $in: types }, ts: mongoRange(from, to), device: { $ne: "bot" } } },
    { $group: { _id: { type: "$type", identity: EVENT_IDENTITY } } },
    { $group: { _id: "$_id.type", count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
}

function buildFunnel(currentEvents, previousEvents, currentOrders, previousOrders) {
  const definitions = [
    ["relevant_visitor", "Relevant Visitors", currentEvents.page_view || 0, previousEvents.page_view || 0],
    ["product_view", "Product View", currentEvents.product_view || 0, previousEvents.product_view || 0],
    ["sales_intent", "Sales Intent", currentEvents.product_inquiry_started || 0, previousEvents.product_inquiry_started || 0],
    ["lead_submitted", "Lead Submitted", currentEvents.lead_submitted || 0, previousEvents.lead_submitted || 0],
    ["order", "Order", currentOrders, previousOrders],
  ];

  const stages = definitions.map(([key, name, current, previous], index) => {
    const prior = index ? definitions[index - 1][2] : null;
    const previousPrior = index ? definitions[index - 1][3] : null;
    const conversionRate = index ? safeRate(current, prior) : 100;
    const previousConversionRate = index ? safeRate(previous, previousPrior) : 100;
    return {
      key,
      name,
      current,
      previous,
      comparison: comparison(current, previous),
      conversionRate,
      previousConversionRate,
      dropOffRate: index && prior > 0 ? Math.max(0, 100 - (conversionRate || 0)) : 0,
    };
  });

  const candidates = stages.slice(1).filter((stage, index) => stages[index].current >= MIN_FUNNEL_STAGE_VOLUME);
  candidates.sort((a, b) => {
    const aPrior = stages[stages.findIndex((stage) => stage.key === a.key) - 1]?.current || 0;
    const bPrior = stages[stages.findIndex((stage) => stage.key === b.key) - 1]?.current || 0;
    return (bPrior - b.current) - (aPrior - a.current);
  });
  const leak = candidates[0];
  const leakIndex = leak ? stages.findIndex((stage) => stage.key === leak.key) : -1;
  const biggestLeak = leak
    ? {
        from: stages[leakIndex - 1].name,
        to: leak.name,
        stageKey: leak.key,
        currentConversion: leak.conversionRate,
        previousConversion: leak.previousConversionRate,
        change: leak.previousConversionRate == null
          ? null
          : comparison(leak.conversionRate || 0, leak.previousConversionRate || 0),
        lostEntities: Math.max(0, stages[leakIndex - 1].current - leak.current),
        minimumVolume: MIN_FUNNEL_STAGE_VOLUME,
      }
    : null;

  return { stages, biggestLeak };
}

function productKeyExpression() {
  return {
    $cond: [
      { $and: [{ $ne: ["$meta.product_id", null] }, { $ne: ["$meta.product_id", ""] }] },
      "$meta.product_id",
      { $ifNull: ["$meta.product_serial", ""] },
    ],
  };
}

async function aggregateProductEvents(from, to) {
  return Event.aggregate([
    { $match: { type: { $in: ["product_view", "product_inquiry_started"] }, ts: mongoRange(from, to), device: { $ne: "bot" } } },
    { $project: { type: 1, identity: EVENT_IDENTITY, productKey: productKeyExpression() } },
    { $match: { productKey: { $ne: "" } } },
    {
      $group: {
        _id: "$productKey",
        viewers: { $addToSet: { $cond: [{ $eq: ["$type", "product_view"] }, "$identity", null] } },
        intenters: { $addToSet: { $cond: [{ $eq: ["$type", "product_inquiry_started"] }, "$identity", null] } },
      },
    },
    {
      $project: {
        uniqueViews: { $size: { $setDifference: ["$viewers", [null]] } },
        uniqueIntent: { $size: { $setDifference: ["$intenters", [null]] } },
      },
    },
  ]);
}

async function aggregateProductLeads(from, to, statuses, requireCurrentStatus = false) {
  return Lead.aggregate([
    { $match: requireCurrentStatus ? { $and: [{ status: { $in: statuses } }, buildStageMatch(statuses, from, to)] } : buildStageMatch(statuses, from, to) },
    {
      $group: {
        _id: { $toString: "$productId" },
        productName: { $first: "$productName" },
        count: { $sum: 1 },
        revenue: { $sum: { $ifNull: ["$finalValue", 0] } },
      },
    },
  ]);
}

async function productPerformance(period) {
  const [events, previousEvents, qualified, orders, previousOrders] = await Promise.all([
    aggregateProductEvents(period.from, period.to),
    aggregateProductEvents(period.comparisonFrom, period.comparisonTo),
    aggregateProductLeads(period.from, period.to, QUALIFIED_LEAD_STATUSES),
    aggregateProductLeads(period.from, period.to, VALID_ORDER_LEAD_STATUSES, true),
    aggregateProductLeads(period.comparisonFrom, period.comparisonTo, VALID_ORDER_LEAD_STATUSES, true),
  ]);
  const previousEventMap = new Map(previousEvents.map((row) => [String(row._id), row]));
  const qualifiedMap = new Map(qualified.map((row) => [String(row._id), row]));
  const orderMap = new Map(orders.map((row) => [String(row._id), row]));
  const previousOrderMap = new Map(previousOrders.map((row) => [String(row._id), row]));
  const keys = new Set([
    ...events.map((row) => String(row._id)),
    ...qualifiedMap.keys(),
    ...orderMap.keys(),
  ]);

  const objectIds = [...keys].filter((key) => mongoose.isValidObjectId(key));
  const serials = [...keys].filter((key) => !mongoose.isValidObjectId(key));
  const productDocs = keys.size
    ? await Product.find({ $or: [{ _id: { $in: objectIds } }, { serialNumber: { $in: serials } }] })
        .select("name productId serialNumber")
        .lean()
    : [];
  const names = new Map();
  productDocs.forEach((product) => {
    names.set(String(product._id), product.name || product.productId || product.serialNumber);
    names.set(String(product.serialNumber), product.name || product.productId || product.serialNumber);
  });

  const rows = [...keys].map((key) => {
    const event = events.find((row) => String(row._id) === key) || {};
    const previousEvent = previousEventMap.get(key) || {};
    const lead = qualifiedMap.get(key) || {};
    const order = orderMap.get(key) || {};
    const previousOrder = previousOrderMap.get(key) || {};
    const uniqueViews = Number(event.uniqueViews || 0);
    return {
      productId: key,
      product: names.get(key) || lead.productName || order.productName || "Deleted or legacy product",
      uniqueViews,
      qualifiedLeads: Number(lead.count || 0),
      salesIntentRate: safeRate(event.uniqueIntent || 0, uniqueViews),
      orderConversionRate: uniqueViews > 0 ? safeRate(order.count || 0, uniqueViews) : null,
      revenue: Number(order.revenue || 0),
      orders: Number(order.count || 0),
      trend: comparison(order.revenue || 0, previousOrder.revenue || 0),
      viewTrend: comparison(uniqueViews, previousEvent.uniqueViews || 0),
    };
  });

  return classifyProducts(rows).sort((a, b) => b.revenue - a.revenue || b.uniqueViews - a.uniqueViews);
}

async function aggregateVisitorsBySource(from, to) {
  return Event.aggregate([
    { $match: { type: "page_view", ts: mongoRange(from, to), device: { $ne: "bot" } } },
    { $group: { _id: { source: { $ifNull: ["$source", "direct"] }, identity: EVENT_IDENTITY } } },
    { $group: { _id: "$_id.source", visitors: { $sum: 1 } } },
  ]);
}

async function aggregateLeadsBySource(from, to, statuses, requireCurrentStatus = false) {
  return Lead.aggregate([
    { $match: requireCurrentStatus ? { $and: [{ status: { $in: statuses } }, buildStageMatch(statuses, from, to)] } : buildStageMatch(statuses, from, to) },
    {
      $group: {
        _id: { $ifNull: ["$source", "direct"] },
        count: { $sum: 1 },
        revenue: { $sum: { $ifNull: ["$finalValue", 0] } },
      },
    },
  ]);
}

async function sourceQuality(period) {
  const [visitors, qualified, orders] = await Promise.all([
    aggregateVisitorsBySource(period.from, period.to),
    aggregateLeadsBySource(period.from, period.to, QUALIFIED_LEAD_STATUSES),
    aggregateLeadsBySource(period.from, period.to, VALID_ORDER_LEAD_STATUSES, true),
  ]);
  const visitorMap = new Map(visitors.map((row) => [String(row._id || "direct"), row]));
  const leadMap = new Map(qualified.map((row) => [String(row._id || "direct"), row]));
  const orderMap = new Map(orders.map((row) => [String(row._id || "direct"), row]));
  const keys = new Set([...visitorMap.keys(), ...leadMap.keys(), ...orderMap.keys()]);
  return [...keys]
    .map((source) => {
      const visitorCount = Number(visitorMap.get(source)?.visitors || 0);
      const leadCount = Number(leadMap.get(source)?.count || 0);
      const orderCount = Number(orderMap.get(source)?.count || 0);
      return {
        source,
        visitors: visitorCount,
        qualifiedLeads: leadCount,
        orders: orderCount,
        revenue: Number(orderMap.get(source)?.revenue || 0),
        visitorToLeadRate: safeRate(leadCount, visitorCount),
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.qualifiedLeads - a.qualifiedLeads || b.visitors - a.visitors);
}

function bucketExpression(granularity, field) {
  const format = granularity === "hour" ? "%Y-%m-%dT%H:00:00Z" : granularity === "week" ? "%G-W%V" : "%Y-%m-%d";
  return { $dateToString: { format, date: field, timezone: "UTC" } };
}

async function aggregateVisitorTrend(period) {
  return Event.aggregate([
    { $match: { type: "page_view", ts: mongoRange(period.from, period.to), device: { $ne: "bot" } } },
    { $group: { _id: { date: bucketExpression(period.granularity, "$ts"), identity: EVENT_IDENTITY } } },
    { $group: { _id: "$_id.date", visitors: { $sum: 1 } } },
  ]);
}

async function aggregateLeadTrend(period, statuses, includeRevenue = false) {
  return Lead.aggregate([
    ...(includeRevenue ? [{ $match: { status: { $in: statuses } } }] : []),
    { $unwind: "$statusHistory" },
    { $match: { "statusHistory.newStatus": { $in: statuses }, "statusHistory.changedAt": mongoRange(period.from, period.to) } },
    { $group: { _id: "$_id", at: { $min: "$statusHistory.changedAt" }, value: { $first: "$finalValue" } } },
    {
      $group: {
        _id: bucketExpression(period.granularity, "$at"),
        count: { $sum: 1 },
        ...(includeRevenue ? { revenue: { $sum: { $ifNull: ["$value", 0] } } } : {}),
      },
    },
  ]);
}

async function businessTrend(period) {
  const [visitors, qualified, orders] = await Promise.all([
    aggregateVisitorTrend(period),
    aggregateLeadTrend(period, QUALIFIED_LEAD_STATUSES),
    aggregateLeadTrend(period, VALID_ORDER_LEAD_STATUSES, true),
  ]);
  const map = new Map();
  const ensure = (date) => {
    if (!map.has(date)) map.set(date, { date, visitors: 0, qualifiedLeads: 0, orders: 0, revenue: 0 });
    return map.get(date);
  };
  visitors.forEach((row) => { ensure(row._id).visitors = Number(row.visitors || 0); });
  qualified.forEach((row) => { ensure(row._id).qualifiedLeads = Number(row.count || 0); });
  orders.forEach((row) => {
    ensure(row._id).orders = Number(row.count || 0);
    ensure(row._id).revenue = Number(row.revenue || 0);
  });
  return [...map.values()]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((row) => ({
      ...row,
      visitorToLeadRate: safeRate(row.qualifiedLeads, row.visitors),
      leadToOrderRate: safeRate(row.orders, row.qualifiedLeads),
    }));
}

function makeInsights(kpis, funnel, products, sources) {
  const insights = [];
  const add = (insight) => insights.push(insight);
  const significant = (metric) => metric.percentageChange != null && Math.abs(metric.percentageChange) >= MATERIAL_PERCENTAGE_CHANGE;

  if (significant(kpis.revenue)) {
    add({
      id: "revenue-change",
      priority: 100,
      severity: kpis.revenue.percentageChange < 0 ? "high_impact" : "opportunity",
      title: `Revenue ${kpis.revenue.percentageChange < 0 ? "decreased" : "increased"} ${Math.abs(kpis.revenue.percentageChange).toFixed(1)}%`,
      detail: "Compared with the immediately preceding equivalent period.",
      action: "Review revenue by product and acquisition source.",
      target: "products",
    });
  }
  if (significant(kpis.visitorToLead)) {
    add({
      id: "visitor-lead-change",
      priority: 90,
      severity: kpis.visitorToLead.percentageChange < 0 ? "high_impact" : "opportunity",
      title: `Visitor → Lead ${kpis.visitorToLead.percentageChange < 0 ? "fell" : "improved"} ${Math.abs(kpis.visitorToLead.percentageChange).toFixed(1)}%`,
      detail: `Current ${Number(kpis.visitorToLead.current || 0).toFixed(1)}% vs ${Number(kpis.visitorToLead.previous || 0).toFixed(1)}%.`,
      action: "Analyze the commercial funnel.",
      target: "conversion",
    });
  }
  if (funnel.biggestLeak) {
    add({
      id: "biggest-leak",
      priority: 80 + Math.min(10, funnel.biggestLeak.lostEntities / 100),
      severity: "high_impact",
      title: `${funnel.biggestLeak.from} → ${funnel.biggestLeak.to} is the largest volume leak`,
      detail: `${funnel.biggestLeak.lostEntities.toLocaleString()} entities did not progress in this period.`,
      action: "Break down the stage by device, source, campaign, product, or landing page.",
      target: "conversion",
    });
  }
  const opportunity = products.find((product) => product.classification === "hidden_opportunity");
  const problem = products.find((product) => product.classification === "conversion_problem");
  if (opportunity) {
    add({
      id: `product-opportunity-${opportunity.productId}`,
      priority: 70,
      severity: "opportunity",
      title: `${opportunity.product} is a hidden opportunity`,
      detail: `${Number(opportunity.orderConversionRate || 0).toFixed(1)}% conversion with ${Number(opportunity.classificationEvidence.trafficShare || 0).toFixed(1)}% of product traffic.`,
      action: opportunity.recommendedAction,
      target: "products",
    });
  } else if (problem) {
    add({
      id: `product-problem-${problem.productId}`,
      priority: 65,
      severity: "warning",
      title: `${problem.product} has a conversion problem`,
      detail: problem.reason,
      action: problem.recommendedAction,
      target: "products",
    });
  }
  const sourceRates = sources.filter((source) => source.visitors >= MIN_FUNNEL_STAGE_VOLUME && source.visitorToLeadRate != null);
  const siteMedianRate = median(sourceRates.map((source) => source.visitorToLeadRate));
  const lowQuality = sourceRates
    .filter((source) => source.visitorToLeadRate < siteMedianRate)
    .sort((a, b) => b.visitors - a.visitors)[0];
  if (lowQuality) {
    add({
      id: `source-quality-${lowQuality.source}`,
      priority: 55,
      severity: "warning",
      title: `${lowQuality.source} sends volume below median lead quality`,
      detail: `${lowQuality.visitors.toLocaleString()} visitors at ${lowQuality.visitorToLeadRate.toFixed(1)}% Visitor → Lead vs ${siteMedianRate.toFixed(1)}% source median.`,
      action: "Review campaign targeting and landing-page fit.",
      target: "acquisition",
    });
  }
  return insights.sort((a, b) => b.priority - a.priority).slice(0, MAX_ACTIVE_INSIGHTS);
}

async function getBusinessAnalytics({ from, to } = {}) {
  const period = resolvePeriod({ from, to });
  const [current, previous, currentEvents, previousEvents, products, sources, trend] = await Promise.all([
    commercialMetrics(period.from, period.to),
    commercialMetrics(period.comparisonFrom, period.comparisonTo),
    eventFunnelCounts(period.from, period.to),
    eventFunnelCounts(period.comparisonFrom, period.comparisonTo),
    productPerformance(period),
    sourceQuality(period),
    businessTrend(period),
  ]);
  const kpis = buildKpis(current, previous);
  const funnel = buildFunnel(currentEvents, previousEvents, current.orders, previous.orders);
  return {
    period: serializePeriod(period),
    definitions: {
      qualifiedLeadStatuses: QUALIFIED_LEAD_STATUSES,
      orderEntity: "lead",
      validOrderStatuses: VALID_ORDER_LEAD_STATUSES,
      orderDefinition: "Closed-won CRM leads",
      revenueDefinition: "Final value recorded on closed-won CRM leads",
      attribution: "Lead → Order is deterministic because the commercial outcome is stored on the same lead. A fulfilled Order model is not currently available.",
    },
    kpis,
    trend,
    funnel,
    products,
    acquisition: { sources },
    insights: makeInsights(kpis, funnel, products, sources),
    dataQuality: {
      visitorIdentifiedQualifiedLeads: current.qualifiedVisitors,
      qualifiedLeads: current.qualifiedLeads,
      visitorIdentityCoverage: safeRate(current.qualifiedVisitors, current.qualifiedLeads),
      ordersWithoutRevenue: current.ordersWithoutRevenue,
    },
  };
}

const FUNNEL_EVENT_TYPES = {
  relevant_visitor: "page_view",
  product_view: "product_view",
  sales_intent: "product_inquiry_started",
  lead_submitted: "lead_submitted",
};

const EVENT_DIMENSIONS = {
  product: productKeyExpression(),
  device: { $ifNull: ["$device", "unknown"] },
  source: { $ifNull: ["$source", "direct"] },
  campaign: { $ifNull: ["$campaign", "unattributed"] },
  landingPage: { $ifNull: ["$path", "/"] },
};

async function getFunnelBreakdown({ from, to, stage, dimension }) {
  const period = resolvePeriod({ from, to });
  const safeStage = FUNNEL_EVENT_TYPES[stage];
  const dimensionExpression = EVENT_DIMENSIONS[dimension];
  if ((!safeStage && stage !== "order") || !dimensionExpression) {
    const error = new Error("Unsupported funnel breakdown");
    error.statusCode = 400;
    throw error;
  }
  if (stage === "order") {
    if (dimension === "device") {
      return { stage, dimension, available: false, reason: "CRM leads do not currently store device class.", rows: [] };
    }
    const leadDimensions = {
      product: { $ifNull: ["$productName", "unknown"] },
      source: { $ifNull: ["$source", "direct"] },
      campaign: { $ifNull: ["$campaign", "unattributed"] },
      landingPage: { $ifNull: ["$landingPage", "unknown"] },
    };
    const rows = await Lead.aggregate([
      { $match: buildOrderMatch(period.from, period.to) },
      { $group: { _id: leadDimensions[dimension], count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);
    return {
      stage,
      dimension,
      available: true,
      rows: rows.map((row) => ({ name: row._id || "unknown", value: row.count })),
    };
  }
  const rows = await Event.aggregate([
    { $match: { type: safeStage, ts: mongoRange(period.from, period.to), device: { $ne: "bot" } } },
    { $group: { _id: { segment: dimensionExpression, identity: EVENT_IDENTITY } } },
    { $group: { _id: "$_id.segment", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);
  return {
    stage,
    dimension,
    available: true,
    rows: rows.map((row) => ({ name: row._id || "unknown", value: row.count })),
  };
}

module.exports = {
  buildFunnel,
  buildKpis,
  buildOrderMatch,
  buildStageMatch,
  getBusinessAnalytics,
  getFunnelBreakdown,
};
