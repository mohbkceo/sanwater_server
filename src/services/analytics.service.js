const Event = require("../models/event.model");
const Lead = require("../models/lead.model");

async function createEvent(data) {
  const event = {
    type: data.type,
    session_id: data.session_id,
    visitor_id: data.visitor_id || null,
    source: data.source || "direct",
    medium: data.medium || null,
    campaign: data.campaign || null,
    path: data.path || null,
    referrer: data.referrer || null,
    user_agent: data.user_agent || null,
    device: data.device || "unknown",
    browser: data.browser || null,
    os: data.os || null,
    country: data.country || null,
    city: data.city || null,
    conversion_name: data.conversion_name || null,
    value: typeof data.value === "number" ? data.value : 0,
    meta: data.meta || {},
    ts: data.ts ? new Date(data.ts) : new Date(),
  };

  return Event.create(event);
}

function buildLeadDateFilter(from, to, field = "createdAt") {
  const range = {};
  if (from) range.$gte = analyticsDate(from, false);
  if (to) range.$lte = analyticsDate(to, true);
  return Object.keys(range).length ? { [field]: range } : {};
}

function analyticsDate(value, endOfDay) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  return new Date(dateOnly ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : value);
}

async function getLeadAnalytics({ from, to }) {
  const createdMatch = buildLeadDateFilter(from, to);
  const [stageEvents, eventCounts, bySource, byProduct, wonBySource, leads] = await Promise.all([
    Lead.aggregate([
      { $unwind: "$statusHistory" },
      { $match: { "statusHistory.newStatus": { $in: ["qualified", "won"] }, ...buildLeadDateFilter(from, to, "statusHistory.changedAt") } },
      { $group: { _id: "$statusHistory.newStatus", count: { $sum: 1 } } },
    ]),
    Event.aggregate([
      { $match: { type: { $in: ["product_view", "product_inquiry_started", "lead_submitted"] }, ...buildDateFilter(from, to) } },
      { $group: { _id: "$type", count: { $sum: 1 } } },
    ]),
    Lead.aggregate([{ $match: createdMatch }, { $group: { _id: { $ifNull: ["$source", "unknown"] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Lead.aggregate([{ $match: createdMatch }, { $group: { _id: { id: "$productId", name: "$productName" }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
    Lead.aggregate([{ $match: { status: "won", ...createdMatch } }, { $group: { _id: { $ifNull: ["$source", "unknown"] }, value: { $sum: { $ifNull: ["$finalValue", "$estimatedValue"] } }, count: { $sum: 1 } } }, { $sort: { value: -1 } }]),
    Lead.find(createdMatch).select("fullName company status source estimatedValue assignedTo updatedAt").populate("assignedTo", "fullName").sort({ updatedAt: -1 }).limit(100).lean(),
  ]);
  const stages = Object.fromEntries(stageEvents.map((item) => [item._id, item.count]));
  const events = Object.fromEntries(eventCounts.map((item) => [item._id, item.count]));
  const submitted = events.lead_submitted || 0;
  const won = stages.won || 0;
  return {
    funnel: [
      { name: "Product View", value: events.product_view || 0 },
      { name: "Inquiry Started", value: events.product_inquiry_started || 0 },
      { name: "Lead Submitted", value: submitted },
      { name: "Qualified", value: stages.qualified || 0 },
      { name: "Won", value: won },
    ],
    bySource: bySource.map((item) => ({ source: item._id, count: item.count })),
    byProduct: byProduct.map((item) => ({ productId: item._id.id, product: item._id.name, count: item.count })),
    wonBySource: wonBySource.map((item) => ({ source: item._id, value: item.value, count: item.count })),
    conversionRate: submitted ? won / submitted : 0,
    crmLeads: leads.map((lead) => ({ id: lead._id, name: lead.fullName || lead.company, stage: lead.status, source: lead.source || "unknown", value: lead.estimatedValue || 0, owner: lead.assignedTo?.fullName || "Unassigned", lastTouch: lead.updatedAt })),
  };
}

async function getArticleAnalytics({ from, to }) {
  return Event.aggregate([
    { $match: { type: { $in: ["article_view", "article_product_clicked", "article_contact_clicked"] }, ...buildDateFilter(from, to) } },
    { $group: { _id: { article: "$meta.article_id", type: "$type" }, count: { $sum: 1 }, visitors: { $addToSet: "$visitor_id" } } },
    { $project: { _id: 0, articleId: "$_id.article", type: "$_id.type", count: 1, uniqueVisitors: { $size: "$visitors" } } },
  ]);
}

function buildDateFilter(from, to) {
  const filter = {};

  if (from || to) {
    filter.ts = {};
    if (from) filter.ts.$gte = analyticsDate(from, false);
    if (to) filter.ts.$lte = analyticsDate(to, true);
  }

  return filter;
}

async function getTraffic({ from, to }) {
  const match = {
    type: "page_view",
    ...buildDateFilter(from, to),
  };

  const result = await Event.aggregate([
    { $match: match },
    { $count: "total" },
  ]);

  return result[0]?.total || 0;
}

async function getConversions({ from, to }) {
  const match = {
    type: "conversion",
    ...buildDateFilter(from, to),
  };

  const result = await Event.aggregate([
    { $match: match },
    { $count: "total" },
  ]);

  return result[0]?.total || 0;
}

async function getUniqueSessions({ from, to }) {
  const match = {
    ...buildDateFilter(from, to),
  };

  const result = await Event.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$session_id",
      },
    },
    {
      $count: "total",
    },
  ]);

  return result[0]?.total || 0;
}

async function getSources({ from, to }) {
  const match = {
    type: "page_view",
    ...buildDateFilter(from, to),
  };

  return Event.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$source",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    {
      $project: {
        source: "$_id",
        count: 1,
        _id: 0,
      },
    },
  ]);
}

async function getTopPages({ from, to, limit = 6 }) {
  const match = {
    type: "page_view",
    ...buildDateFilter(from, to),
  };

  return Event.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$path",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: limit },
    {
      $project: {
        path: { $ifNull: ["$_id", "/"] },
        count: 1,
        _id: 0,
      },
    },
  ]);
}

async function getDevices({ from, to }) {
  const match = {
    ...buildDateFilter(from, to),
  };

  return Event.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$device",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    {
      $project: {
        name: { $ifNull: ["$_id", "unknown"] },
        count: 1,
        _id: 0,
      },
    },
  ]);
}

async function getTrend({ from, to }) {
  const match = {
    ...buildDateFilter(from, to),
  };

  return Event.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          day: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$ts",
            },
          },
        },
        traffic: {
          $sum: {
            $cond: [{ $eq: ["$type", "page_view"] }, 1, 0],
          },
        },
        conversions: {
          $sum: {
            $cond: [{ $eq: ["$type", "conversion"] }, 1, 0],
          },
        },
      },
    },
    { $sort: { "_id.day": 1 } },
    {
      $project: {
        _id: 0,
        date: "$_id.day",
        traffic: 1,
        conversions: 1,
      },
    },
  ]);
}

async function getRecentEvents({ from, to, limit = 10 }) {
  const match = {
    ...buildDateFilter(from, to),
  };

  return Event.find(match)
    .sort({ ts: -1 })
    .limit(limit)
    .lean();
}

async function getFunnel({ from, to }) {
  const match = {
    ...buildDateFilter(from, to),
  };

  const result = await Event.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$type",
        count: { $sum: 1 },
      },
    },
  ]);

  const map = Object.fromEntries(result.map((item) => [item._id, item.count]));

  return [
    { name: "Page Views", value: map.page_view || 0 },
    { name: "Clicks", value: map.cta_click || 0 },
    { name: "Conversions", value: map.conversion || 0 },
  ];
}

async function getConversionRate({ from, to }) {
  const [traffic, conversions] = await Promise.all([
    getTraffic({ from, to }),
    getConversions({ from, to }),
  ]);

  if (traffic === 0) return 0;
  return conversions / traffic;
}

async function getAnalyticsSummary({ from, to }) {
  const [
    traffic,
    conversions,
    uniqueSessions,
    sources,
    topPages,
    devices,
    trend,
    recentEvents,
    funnel,
    leadAnalytics,
    articleAnalytics,
  ] = await Promise.all([
    getTraffic({ from, to }),
    getConversions({ from, to }),
    getUniqueSessions({ from, to }),
    getSources({ from, to }),
    getTopPages({ from, to }),
    getDevices({ from, to }),
    getTrend({ from, to }),
    getRecentEvents({ from, to }),
    getFunnel({ from, to }),
    getLeadAnalytics({ from, to }),
    getArticleAnalytics({ from, to }),
  ]);

  const conversionRate = traffic === 0 ? 0 : conversions / traffic;

  return {
    traffic,
    conversions,
    uniqueSessions,
    conversionRate,
    sources,
    topPages,
    devices,
    trend,
    recentEvents,
    funnel,
    businessFunnel: leadAnalytics.funnel,
    leadsBySource: leadAnalytics.bySource,
    leadsByProduct: leadAnalytics.byProduct,
    wonValueBySource: leadAnalytics.wonBySource,
    leadConversionRate: leadAnalytics.conversionRate,
    crmLeads: leadAnalytics.crmLeads,
    articleAnalytics,
  };
}

module.exports = {
  createEvent,
  getAnalyticsSummary,
  getConversionRate,
  getConversions,
  getSources,
  getTraffic,
  getUniqueSessions,
  getTopPages,
  getDevices,
  getTrend,
  getRecentEvents,
  getFunnel,
  getLeadAnalytics,
  getArticleAnalytics,
};
