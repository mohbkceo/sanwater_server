const Event = require("../models/event.model");

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

  console.log("Event Created:", event);
  return Event.create(event);
}

function buildDateFilter(from, to) {
  const filter = {};

  if (from || to) {
    filter.ts = {};
    if (from) filter.ts.$gte = new Date(from);
    if (to) filter.ts.$lte = new Date(to);
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
};