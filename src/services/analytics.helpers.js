const {
  MIN_PRODUCT_VIEW_SAMPLE,
} = require("../config/businessAnalytics");

const DAY_MS = 24 * 60 * 60 * 1000;

function parseBoundary(value, endOfDay = false) {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const parsed = new Date(
    dateOnly
      ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
      : value,
  );
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error("Invalid analytics date range");
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function resolvePeriod({ from, to, now = new Date() } = {}) {
  const currentTo = parseBoundary(to, true) || now;
  const currentFrom = parseBoundary(from, false) || new Date(currentTo.getTime() - (30 * DAY_MS) + 1);
  if (currentFrom > currentTo) {
    const error = new Error("Analytics 'from' must be before 'to'");
    error.statusCode = 400;
    throw error;
  }

  const durationMs = currentTo.getTime() - currentFrom.getTime() + 1;
  const comparisonTo = new Date(currentFrom.getTime() - 1);
  const comparisonFrom = new Date(comparisonTo.getTime() - durationMs + 1);
  const days = durationMs / DAY_MS;
  const granularity = days <= 2 ? "hour" : days > 90 ? "week" : "day";

  return {
    from: currentFrom,
    to: currentTo,
    comparisonFrom,
    comparisonTo,
    durationMs,
    granularity,
  };
}

function mongoRange(from, to) {
  return { $gte: from, $lte: to };
}

function safeRate(numerator, denominator) {
  const top = Number(numerator || 0);
  const bottom = Number(denominator || 0);
  return bottom > 0 ? (top / bottom) * 100 : null;
}

function comparison(currentValue, previousValue) {
  const current = Number(currentValue || 0);
  const previous = Number(previousValue || 0);
  const absoluteChange = current - previous;

  if (previous === 0) {
    return {
      current,
      previous,
      absoluteChange,
      percentageChange: current === 0 ? 0 : null,
      changeState: current === 0 ? "no_change" : "new",
    };
  }

  return {
    current,
    previous,
    absoluteChange,
    percentageChange: (absoluteChange / previous) * 100,
    changeState: absoluteChange === 0 ? "no_change" : "comparable",
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function classifyProducts(products, minimumViews = MIN_PRODUCT_VIEW_SAMPLE) {
  const eligible = products.filter(
    (product) => product.uniqueViews >= minimumViews && product.orderConversionRate != null,
  );
  const siteMedianViews = median(eligible.map((product) => product.uniqueViews));
  const siteMedianConversion = median(eligible.map((product) => product.orderConversionRate));
  const totalViews = products.reduce((sum, product) => sum + product.uniqueViews, 0);

  return products.map((product) => {
    const trafficShare = safeRate(product.uniqueViews, totalViews) || 0;
    const evidence = { siteMedianViews, siteMedianConversion, trafficShare, minimumViews };

    if (product.uniqueViews < minimumViews || product.orderConversionRate == null || eligible.length < 2) {
      return {
        ...product,
        classification: "insufficient_data",
        classificationEvidence: evidence,
        reason: `At least ${minimumViews} unique product views and two comparable products are required.`,
        recommendedAction: "Collect more data before changing promotion.",
      };
    }

    const highDemand = product.uniqueViews >= siteMedianViews;
    const highConversion = product.orderConversionRate >= siteMedianConversion;
    let classification;
    let reason;
    let recommendedAction;

    if (highDemand && highConversion) {
      classification = "winner";
      reason = "Demand and order conversion are both at or above the current product median.";
      recommendedAction = "Maintain or increase promotion.";
    } else if (!highDemand && highConversion) {
      classification = "hidden_opportunity";
      reason = "Conversion is at or above the product median while traffic is below the median.";
      recommendedAction = "Increase visibility or acquisition carefully.";
    } else if (highDemand) {
      classification = "conversion_problem";
      reason = "Traffic is at or above the product median while conversion is below it.";
      recommendedAction = "Investigate the page, offer, pricing, CTA, availability, and traffic quality.";
    } else {
      classification = "low_priority";
      reason = "Demand and conversion are both below the current product median.";
      recommendedAction = "Improve conversion before prioritizing acquisition.";
    }

    return { ...product, classification, classificationEvidence: evidence, reason, recommendedAction };
  });
}

function serializePeriod(period) {
  return {
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    comparisonFrom: period.comparisonFrom.toISOString(),
    comparisonTo: period.comparisonTo.toISOString(),
    granularity: period.granularity,
  };
}

module.exports = {
  classifyProducts,
  comparison,
  median,
  mongoRange,
  resolvePeriod,
  safeRate,
  serializePeriod,
};
