const mongoose = require('mongoose');
const AnalyticsEvent = require('../../models/analyticsEvent.model');
const AnalyticsSession = require('../../models/analyticsSession.model');
const LegacyEvent = require('../../models/event.model');
const Lead = require('../../models/lead.model');
const Product = require('../../models/product.model');
const Hiring = require('../../models/hiring.model');
const Application = require('../../models/application.model');
const News = require('../../models/news.model');
const ActivityLog = require('../../models/activityLog.model');
const Quotation = require('../../models/quotation.model');
const NewsRevision = require('../../models/newsRevision.model');
const { classifyProducts, comparison, resolvePeriod, safeRate, serializePeriod } = require('../analytics.helpers');
const { buildOrderMatch, buildStageMatch, buildFunnel } = require('../businessAnalytics.service');
const { QUALIFIED_LEAD_STATUSES } = require('../../config/businessAnalytics');
const { SUBJECT_TYPES } = require('../../config/analytics');

const range = (p) => ({ $gte: p.from, $lte: p.to });
const previous = (p) => ({ from: p.comparisonFrom, to: p.comparisonTo });
const unavailable = (reason) => ({ available: false, reason });
async function eventCount(name, p, subject) {
  const match = { name, occurredAt: range(p) };
  if (subject) { match['subject.type'] = subject.type; match['subject.id'] = String(subject.id); }
  const [modern, legacy] = await Promise.all([
    AnalyticsEvent.countDocuments(match),
    // Legacy conversions and CTA clicks are deliberately excluded.
    ({ page_viewed: 'page_view', product_viewed: 'product_view', article_viewed: 'article_view', product_inquiry_started: 'product_inquiry_started', job_viewed: null, job_apply_clicked: null }[name])
      ? LegacyEvent.countDocuments({ type: { page_viewed: 'page_view', product_viewed: 'product_view', article_viewed: 'article_view', product_inquiry_started: 'product_inquiry_started' }[name], ts: range(p), ...(subject ? { [`meta.${subject.type === 'product' ? 'product_id' : 'article_id'}`]: String(subject.id) } : {}) })
      : Promise.resolve(0),
  ]);
  return modern + legacy;
}
async function uniqueEventVisitors(name, p, subject) {
  const match = { name, occurredAt: range(p), visitorId: { $ne: null } };
  if (subject) { match['subject.type'] = subject.type; match['subject.id'] = String(subject.id); }
  const [modern, legacy] = await Promise.all([
    AnalyticsEvent.aggregate([{ $match: match }, { $group: { _id: '$visitorId' } }, { $count: 'count' }]),
    ({ page_viewed: 'page_view', product_viewed: 'product_view', article_viewed: 'article_view', product_inquiry_started: 'product_inquiry_started' }[name])
      ? LegacyEvent.aggregate([{ $match: { type: { page_viewed: 'page_view', product_viewed: 'product_view', article_viewed: 'article_view', product_inquiry_started: 'product_inquiry_started' }[name], ts: range(p), device: { $ne: 'bot' }, ...(subject ? { [`meta.${subject.type === 'product' ? 'product_id' : 'article_id'}`]: String(subject.id) } : {}) } }, { $group: { _id: { $ifNull: ['$visitor_id', '$session_id'] } } }, { $count: 'count' }])
      : Promise.resolve([]),
  ]);
  return (modern[0]?.count || 0) + (legacy[0]?.count || 0);
}
async function commercial(p) {
  const [qualified, won] = await Promise.all([
    Lead.countDocuments(buildStageMatch(QUALIFIED_LEAD_STATUSES, p.from, p.to)),
    Lead.aggregate([{ $match: buildOrderMatch(p.from, p.to) }, { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$finalValue', 0] } }, missingRevenue: { $sum: { $cond: [{ $eq: ['$finalValue', null] }, 1, 0] } } } }]),
  ]);
  return { qualifiedLeads: qualified, wonDeals: won[0]?.count || 0, revenue: won[0]?.revenue || 0, ordersMissingRevenue: won[0]?.missingRevenue || 0 };
}
async function sales(p) {
  const now = new Date();
  const [created, priorCreated, stages, open, overdue, unassigned, current, prior, lostReasons] = await Promise.all([
    Lead.countDocuments({ createdAt: range(p) }),
    Lead.countDocuments({ createdAt: range(previous(p)) }),
    Lead.aggregate([{ $match: { createdAt: range(p) } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: { status: { $nin: ['won', 'lost', 'archived'] } } }, { $group: { _id: null, value: { $sum: '$estimatedValue' } } }]),
    Lead.countDocuments({ status: { $nin: ['won', 'lost', 'archived'] }, nextFollowUpAt: { $lt: now } }),
    Lead.countDocuments({ status: { $nin: ['won', 'lost', 'archived'] }, assignedTo: null }),
    commercial(p), commercial(previous(p)),
    Lead.aggregate([{ $match: { status: 'lost', createdAt: range(p) } }, { $group: { _id: { $ifNull: ['$lostReason', 'unknown'] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
  ]);
  const status = Object.fromEntries(stages.map(r => [r._id, r.count]));
  const qualifiedCohort = (status.qualified || 0) + (status.quote_sent || 0) + (status.won || 0);
  return { period: serializePeriod(p), kpis: {
    newLeads: { ...comparison(created, priorCreated), available: true }, unassigned: { current: unassigned, available: true }, followUpsDue: { current: overdue, available: true },
    qualifiedLeads: comparison(current.qualifiedLeads, prior.qualifiedLeads), quotesSent: { current: status.quote_sent || 0, available: true },
    wonDeals: comparison(current.wonDeals, prior.wonDeals), lost: { current: status.lost || 0, available: true },
    revenue: comparison(current.revenue, prior.revenue), openPipeline: { current: open[0]?.value || 0, available: true },
    averageWonValue: current.wonDeals ? { current: current.revenue / current.wonDeals, available: true } : unavailable('No won deals in this period'),
    leadToQualified: { current: safeRate(qualifiedCohort, created), available: created > 0, ...(created ? {} : { reason: 'No leads created in this period' }) },
    qualifiedToWon: { current: safeRate(status.won || 0, qualifiedCohort), available: qualifiedCohort > 0, ...(qualifiedCohort ? {} : { reason: 'No qualified leads in the created-lead cohort' }) },
  }, lossReasons: lostReasons.map(r => ({ reason: r._id, count: r.count })),
  dataQuality: { ordersMissingRevenue: current.ordersMissingRevenue, firstResponseTime: unavailable('Historical first contact timestamps are incomplete') } };
}
async function productRows(p) {
  const [products, modernViews, legacyViews, intent, legacyIntent, qualified, won] = await Promise.all([
    Product.find().select('name productId serialNumber family subFamily status isActive').limit(5000).lean(),
    AnalyticsEvent.aggregate([{ $match: { name: 'product_viewed', occurredAt: range(p), 'subject.type': 'product', visitorId: { $ne: null } } }, { $group: { _id: { product: '$subject.id', visitor: '$visitorId' } } }, { $group: { _id: '$_id.product', count: { $sum: 1 } } }]),
    LegacyEvent.aggregate([{ $match: { type: 'product_view', ts: range(p), device: { $ne: 'bot' } } }, { $group: { _id: { product: { $ifNull: ['$meta.product_id', '$meta.product_serial'] }, visitor: { $ifNull: ['$visitor_id', '$session_id'] } } } }, { $group: { _id: '$_id.product', count: { $sum: 1 } } }]),
    AnalyticsEvent.aggregate([{ $match: { name: 'product_inquiry_started', occurredAt: range(p), 'subject.type': 'product' } }, { $group: { _id: '$subject.id', count: { $sum: 1 } } }]),
    LegacyEvent.aggregate([{ $match: { type: 'product_inquiry_started', ts: range(p), device: { $ne: 'bot' } } }, { $group: { _id: { $ifNull: ['$meta.product_id', '$meta.product_serial'] }, count: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: buildStageMatch(QUALIFIED_LEAD_STATUSES, p.from, p.to) }, { $group: { _id: '$productId', count: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: buildOrderMatch(p.from, p.to) }, { $group: { _id: '$productId', count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$finalValue', 0] } } } }]),
  ]);
  const map = rows => new Map(rows.map(r => [String(r._id), r]));
  const mv = map(modernViews), lv = map(legacyViews), im = map(intent), li = map(legacyIntent), qm = map(qualified), wm = map(won);
  const rows = products.map(product => {
    const id = String(product._id);
    const uniqueViews = (mv.get(id)?.count || 0) + (lv.get(id)?.count || 0) + (lv.get(product.serialNumber)?.count || 0);
    const orders = wm.get(id)?.count || 0;
    const salesIntent = (im.get(id)?.count || 0) + (li.get(id)?.count || 0) + (li.get(product.serialNumber)?.count || 0);
    return { productId: id, product: product.name || product.productId || product.serialNumber, serialNumber: product.serialNumber,
      family: String(product.family || ''), subFamily: String(product.subFamily || ''), status: product.status,
      uniqueViews, salesIntent, salesIntentRate: safeRate(salesIntent, uniqueViews),
      qualifiedLeads: qm.get(id)?.count || 0, orders, orderConversionRate: safeRate(orders, uniqueViews), revenue: wm.get(id)?.revenue || 0 };
  });
  return classifyProducts(rows).sort((a, b) => b.revenue - a.revenue || b.uniqueViews - a.uniqueViews);
}
async function products(p) {
  const [rows, priorRows] = await Promise.all([productRows(p), productRows(previous(p))]);
  const priorMap = new Map(priorRows.map(row => [row.productId, row]));
  const withTrend = rows.map(row => ({ ...row, trend: comparison(row.revenue, priorMap.get(row.productId)?.revenue || 0), viewTrend: comparison(row.uniqueViews, priorMap.get(row.productId)?.uniqueViews || 0) }));
  const sum = (list, key) => list.reduce((n, r) => n + (r[key] || 0), 0);
  return { period: serializePeriod(p), rows: withTrend, kpis: {
    uniqueViewers: comparison(sum(rows, 'uniqueViews'), sum(priorRows, 'uniqueViews')),
    inquiries: comparison(sum(rows, 'salesIntent'), sum(priorRows, 'salesIntent')),
    qualifiedLeads: comparison(sum(rows, 'qualifiedLeads'), sum(priorRows, 'qualifiedLeads')),
    wonDeals: comparison(sum(rows, 'orders'), sum(priorRows, 'orders')),
    revenue: comparison(sum(rows, 'revenue'), sum(priorRows, 'revenue')),
    activeProducts: { current: rows.filter(r => r.status === 'published').length, available: true },
  }, dataQuality: { note: 'Historical product viewers may include legacy browser identities; post-migration visitor IDs are cookie based.' } };
}
function buildSourceQuality(sourceIdentityRows, qualifiedSources, wonSources) {
  const normalize = value => String(value || 'unknown').trim().toLowerCase();
  const sourceVisitors = new Map(), qualifiedMap = new Map(), wonMap = new Map();
  for (const row of sourceIdentityRows) { const key = normalize(row._id); sourceVisitors.set(key, (sourceVisitors.get(key) || 0) + row.visitors); }
  for (const row of qualifiedSources) { const key = normalize(row._id); qualifiedMap.set(key, (qualifiedMap.get(key) || 0) + row.count); }
  for (const row of wonSources) { const key = normalize(row._id); const current = wonMap.get(key) || { count: 0, revenue: 0 }; wonMap.set(key, { count: current.count + (row.count || 0), revenue: current.revenue + (row.revenue || 0) }); }
  return [...new Set([...sourceVisitors.keys(), ...qualifiedMap.keys(), ...wonMap.keys()])].map(source => ({ source, visitors: sourceVisitors.get(source) || 0, qualifiedLeads: qualifiedMap.get(source) || 0, wonDeals: wonMap.get(source)?.count || 0, revenue: wonMap.get(source)?.revenue || 0, visitorToQualifiedRate: safeRate(qualifiedMap.get(source) || 0, sourceVisitors.get(source) || 0), available: (sourceVisitors.get(source) || 0) >= 20 }));
}
async function marketing(p) {
  const [visitors, sessions, sourceRows, sourceIdentityRows, current, prior, productViewers, intent, submitted, submittedVisitors, wonCohort, leadsWithoutSource, leadsWithoutVisitor, eventsWithoutSubject, qualifiedSources, wonSources] = await Promise.all([
    uniqueEventVisitors('page_viewed', p), AnalyticsSession.countDocuments({ startedAt: range(p) }),
    AnalyticsSession.aggregate([{ $match: { startedAt: range(p) } }, { $group: { _id: { channel: '$acquisition.channel', source: '$acquisition.source', campaign: '$acquisition.campaign', creative: '$acquisition.content', landingPage: '$landingPage', device: '$device.type' }, visitors: { $addToSet: '$visitorId' } } }, { $project: { _id: 1, visitors: { $size: '$visitors' } } }, { $sort: { visitors: -1 } }, { $limit: 100 }]),
    AnalyticsSession.aggregate([{ $match: { startedAt: range(p) } }, { $group: { _id: { source: { $ifNull: ['$acquisition.source', 'direct'] }, visitor: '$visitorId' } } }, { $group: { _id: '$_id.source', visitors: { $sum: 1 } } }]),
    commercial(p), commercial(previous(p)), uniqueEventVisitors('product_viewed', p), uniqueEventVisitors('product_inquiry_started', p),
    Lead.countDocuments({ createdAt: range(p) }),
    Lead.aggregate([{ $match: { createdAt: range(p), visitorId: { $nin: [null, ''] } } }, { $group: { _id: '$visitorId' } }, { $count: 'count' }]),
    Lead.countDocuments({ createdAt: range(p), status: 'won' }),
    Lead.countDocuments({ createdAt: range(p), source: { $in: [null, ''] } }),
    Lead.countDocuments({ createdAt: range(p), visitorId: { $in: [null, ''] } }),
    AnalyticsEvent.countDocuments({ occurredAt: range(p), name: { $in: ['product_viewed', 'product_inquiry_started', 'article_viewed', 'job_viewed'] }, 'subject.id': { $exists: false } }),
    Lead.aggregate([{ $match: buildStageMatch(QUALIFIED_LEAD_STATUSES, p.from, p.to) }, { $group: { _id: { $ifNull: ['$source', 'unknown'] }, count: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: buildOrderMatch(p.from, p.to) }, { $group: { _id: { $ifNull: ['$source', 'unknown'] }, count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$finalValue', 0] } } } }]),
  ]);
  const funnel = buildFunnel({ page_view: visitors, product_view: productViewers, product_inquiry_started: intent, lead_submitted: submitted }, {}, current.wonDeals, 0);
  funnel.stages.splice(4, 0, { key: 'qualified_lead', name: 'Qualified Lead', current: current.qualifiedLeads, previous: prior.qualifiedLeads, comparison: comparison(current.qualifiedLeads, prior.qualifiedLeads), conversionRate: null, previousConversionRate: null, dropOffRate: null });
  for (const stage of funnel.stages) if (['lead_submitted', 'qualified_lead', 'order'].includes(stage.key)) { stage.conversionRate = null; stage.previousConversionRate = null; stage.dropOffRate = null; }
  if (['lead_submitted', 'order'].includes(funnel.biggestLeak?.stageKey)) funnel.biggestLeak = null;
  const attributedRevenue = wonSources.filter(row => String(row._id || '').toLowerCase() !== 'unknown').reduce((sum, row) => sum + (row.revenue || 0), 0);
  const sourceQuality = buildSourceQuality(sourceIdentityRows, qualifiedSources, wonSources);
  return { period: serializePeriod(p), kpis: {
    visitors: { current: visitors, available: true }, sessions: { current: sessions, available: true },
    qualifiedLeads: comparison(current.qualifiedLeads, prior.qualifiedLeads), wonDeals: comparison(current.wonDeals, prior.wonDeals),
    attributedRevenue: { current: attributedRevenue, available: true }, visitorToLead: { current: safeRate(submittedVisitors[0]?.count || 0, visitors), available: visitors > 0 && (submitted === 0 || (submittedVisitors[0]?.count || 0) > 0), ...(submitted > 0 && !submittedVisitors[0]?.count ? { reason: 'Submitted leads lack verified visitor identity' } : {}) },
    leadToWon: { current: safeRate(wonCohort, submitted), available: submitted > 0, ...(submitted ? {} : { reason: 'No submitted leads in this period' }) },
  }, funnel, campaigns: sourceRows.map(r => ({ channel: r._id.channel || 'Unknown', source: r._id.source || 'direct', campaign: r._id.campaign || null, creative: r._id.creative || null, landingPage: r._id.landingPage || null, device: r._id.device || 'unknown', visitors: r.visitors })), sourceQuality,
  dataQuality: { leadsMissingAttribution: leadsWithoutSource, visitorIdentityCoverage: safeRate(submitted - leadsWithoutVisitor, submitted), eventsWithoutSubject, ordersMissingRevenue: current.ordersMissingRevenue, attributionModel: 'Session acquisition; historical campaigns are unavailable where no UTM was captured', funnelRates: unavailable('Lead and won stages mix visitor and CRM entities; cross-entity stage rates require a verified cohort') } };
}
async function hiring(p) {
  const [open, applications, priorApplications, applicationsWithoutSource, stageRows, stageTransitions, views, clicks, jobs] = await Promise.all([
    Hiring.countDocuments({ status: 'published' }), Application.countDocuments({ createdAt: range(p) }),
    Application.countDocuments({ createdAt: range(previous(p)) }),
    Application.countDocuments({ createdAt: range(p), source: null }),
    Application.aggregate([{ $match: { createdAt: range(p) } }, { $group: { _id: '$stage', count: { $sum: 1 } } }]),
    Application.aggregate([{ $match: { createdAt: range(p) } }, { $unwind: '$stageHistory' }, { $match: { 'stageHistory.changedAt': { $lte: p.to } } }, { $group: { _id: { application: '$_id', stage: '$stageHistory.stage' } } }, { $group: { _id: '$_id.stage', count: { $sum: 1 } } }]),
    AnalyticsEvent.aggregate([{ $match: { name: 'job_viewed', occurredAt: range(p), 'subject.type': 'hiring_position' } }, { $group: { _id: '$subject.id', count: { $sum: 1 } } }]),
    AnalyticsEvent.aggregate([{ $match: { name: 'job_apply_clicked', occurredAt: range(p), 'subject.type': 'hiring_position' } }, { $group: { _id: '$subject.id', count: { $sum: 1 } } }]),
    Hiring.find({ status: 'published' }).select('title status').limit(500).lean(),
  ]);
  const stage = Object.fromEntries(stageRows.map(r => [r._id, r.count]));
  const reached = Object.fromEntries(stageTransitions.map(r => [r._id, r.count]));
  const vm = new Map(views.map(r => [r._id, r.count])); const cm = new Map(clicks.map(r => [r._id, r.count]));
  const applicationRows = await Application.aggregate([{ $match: { createdAt: range(p) } }, { $group: { _id: '$hiringId', count: { $sum: 1 } } }]);
  const am = new Map(applicationRows.map(r => [String(r._id), r.count]));
  return { period: serializePeriod(p), kpis: { openPositions: open, applications: comparison(applications, priorApplications), awaitingReview: stage.applied || 0, shortlisted: stage.shortlisted || 0, interviews: stage.interview || 0, offers: stage.offer || 0, hires: stage.hired || 0 },
    rates: {
      viewToApplyClick: safeRate(clicks.reduce((n, r) => n + r.count, 0), views.reduce((n, r) => n + r.count, 0)),
      applicationToShortlist: safeRate(reached.shortlisted || 0, applications),
      shortlistToInterview: safeRate(reached.interview || 0, reached.shortlisted || 0),
      interviewToOffer: safeRate(reached.offer || 0, reached.interview || 0),
      offerToHire: safeRate(reached.hired || 0, reached.offer || 0),
      applyClickToApplication: unavailable('Clicks and submissions are not yet linked as a verified cohort'),
    },
    rows: jobs.map(j => ({ id: String(j._id), title: j.title, views: vm.get(String(j._id)) || 0, applyClicks: cm.get(String(j._id)) || 0, applications: am.get(String(j._id)) || 0, applyRate: safeRate(am.get(String(j._id)) || 0, vm.get(String(j._id)) || 0) })),
    dataQuality: { applicationsWithoutSource, stageCounts: 'Current stage of applications created in the selected period; historical as-of-stage counts are unavailable', historicalApplications: unavailable('External Google Form submissions before the internal form were not imported'), timeToReview: unavailable('Insufficient stage-history coverage for historical applications'), timeToHire: unavailable('Insufficient stage-history coverage for historical applications') } };
}
async function content(p) {
  const [published, articles, views, legacyViews, priorReaders, clicks, legacyClicks, contacts, legacyContacts, progress] = await Promise.all([
    News.countDocuments({ status: 'published' }), News.find({ status: 'published' }).select('title slug').limit(500).lean(),
    AnalyticsEvent.aggregate([{ $match: { name: 'article_viewed', occurredAt: range(p), 'subject.type': 'article', visitorId: { $ne: null } } }, { $group: { _id: { article: '$subject.id', visitor: '$visitorId' } } }, { $group: { _id: '$_id.article', count: { $sum: 1 } } }]),
    LegacyEvent.aggregate([{ $match: { type: 'article_view', ts: range(p), device: { $ne: 'bot' } } }, { $group: { _id: { article: '$meta.article_id', visitor: { $ifNull: ['$visitor_id', '$session_id'] } } } }, { $group: { _id: '$_id.article', count: { $sum: 1 } } }]),
    uniqueEventVisitors('article_viewed', previous(p)),
    AnalyticsEvent.aggregate([{ $match: { name: 'article_product_clicked', occurredAt: range(p) } }, { $group: { _id: '$subject.id', count: { $sum: 1 } } }]),
    LegacyEvent.aggregate([{ $match: { type: 'article_product_clicked', ts: range(p) } }, { $group: { _id: '$meta.article_id', count: { $sum: 1 } } }]),
    AnalyticsEvent.aggregate([{ $match: { name: 'article_contact_clicked', occurredAt: range(p) } }, { $group: { _id: '$subject.id', count: { $sum: 1 } } }]),
    LegacyEvent.aggregate([{ $match: { type: 'article_contact_clicked', ts: range(p) } }, { $group: { _id: '$meta.article_id', count: { $sum: 1 } } }]),
    AnalyticsEvent.aggregate([{ $match: { name: 'article_reading_progress', occurredAt: range(p), 'subject.type': 'article', visitorId: { $ne: null } } }, { $group: { _id: { article: '$subject.id', visitor: '$visitorId' }, maxProgress: { $max: '$properties.progress' } } }, { $group: { _id: '$_id.article', averageProgress: { $avg: '$maxProgress' } } }]),
  ]);
  const vm = new Map(views.map(r => [r._id, r.count])), lm = new Map(legacyViews.map(r => [r._id, r.count])), cm = new Map(clicks.map(r => [r._id, r.count])), lc = new Map(legacyClicks.map(r => [r._id, r.count])), tm = new Map(contacts.map(r => [r._id, r.count])), lt = new Map(legacyContacts.map(r => [r._id, r.count])), pm = new Map(progress.map(r => [r._id, r.averageProgress]));
  const rows = articles.map(a => { const id = String(a._id); const readers = (vm.get(id) || 0) + (lm.get(id) || 0); const productClicks = (cm.get(id) || 0) + (lc.get(id) || 0); const contactClicks = (tm.get(id) || 0) + (lt.get(id) || 0); return { id, title: a.title, readers, productClicks, contactClicks, readingProgress: pm.get(id) ?? null,
    productCtr: safeRate(productClicks, readers), contactCtr: safeRate(contactClicks, readers) }; });
  const eligible = rows.filter(r => r.readers >= 20);
  const medianValue = values => { const sorted = values.sort((a, b) => a - b); return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null; };
  const medianReaders = medianValue(eligible.map(r => r.readers));
  const medianActionRate = medianValue(eligible.map(r => safeRate(r.productClicks + r.contactClicks, r.readers) || 0));
  rows.forEach(row => {
    if (row.readers < 20 || eligible.length < 2) { row.classification = 'insufficient_data'; return; }
    const highTraffic = row.readers >= medianReaders;
    const highAction = (safeRate(row.productClicks + row.contactClicks, row.readers) || 0) >= medianActionRate;
    row.classification = `${highTraffic ? 'high' : 'low'}_traffic_${highAction ? 'high' : 'low'}_action`;
    row.classificationEvidence = { readers: row.readers, medianReaders, actionRate: safeRate(row.productClicks + row.contactClicks, row.readers), medianActionRate, minimumReaders: 20 };
  });
  const readers = await uniqueEventVisitors('article_viewed', p);
  return { period: serializePeriod(p), kpis: { publishedArticles: published, uniqueReaders: comparison(readers, priorReaders), productClicks: rows.reduce((n, r) => n + r.productClicks, 0), contactClicks: rows.reduce((n, r) => n + r.contactClicks, 0) }, rows,
    dataQuality: { assistedLeads: unavailable('A verified content-to-lead journey is not yet available for historical traffic') } };
}
async function operations(p) {
  const now = new Date();
  const [staleLeads, overdueFollowups, unassignedQuotes, quoteStatuses] = await Promise.all([
    Lead.countDocuments({ status: { $in: ['new', 'qualified'] }, updatedAt: { $lt: new Date(now - 7 * 86400000) } }),
    Lead.countDocuments({ nextFollowUpAt: { $lt: now }, status: { $nin: ['won', 'lost', 'archived'] } }),
    Quotation.countDocuments({ assignedAdmin: null, status: { $nin: ['closed', 'rejected'] } }),
    Quotation.aggregate([{ $match: { createdAt: range(p) } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  return { period: serializePeriod(p), kpis: { staleLeads, overdueFollowups, unassignedQuotes }, quoteStatuses: quoteStatuses.map(r => ({ status: r._id, count: r.count })), dataQuality: { definition: 'Workflow health uses current open records; quotation status counts use the selected creation period' } };
}
function attentionFromReports(reports, base) {
  const findings = [];
  const add = item => findings.push({ ...item, explanation: item.explanation, recommendedInspection: item.recommendedInspection, targetRoute: `${base}/${item.targetRoute}`, severity: item.severity || 'warning' });
  const salesReport = reports.sales;
  if (salesReport?.kpis.followUpsDue.current > 0) add({ id: 'sales-overdue-followups', domain: 'sales', title: 'Follow-ups are overdue', explanation: 'Open leads have a follow-up date before now.', evidence: { count: salesReport.kpis.followUpsDue.current }, recommendedInspection: 'Review the overdue lead queue.', subjectType: null, subjectId: null, targetRoute: 'leads', severity: 'high' });
  for (const row of reports.products?.rows || []) if (['hidden_opportunity', 'conversion_problem'].includes(row.classification)) add({ id: `product-${row.productId}-${row.classification}`, domain: 'products', title: `${row.product}: ${row.classification.replace(/_/g, ' ')}`, explanation: row.reason, evidence: { uniqueViews: row.uniqueViews, orderConversionRate: row.orderConversionRate, ...row.classificationEvidence }, recommendedInspection: row.recommendedAction, subjectType: 'product', subjectId: row.productId, targetRoute: `subjects/product/${row.productId}` });
  for (const row of reports.hiring?.rows || []) if (row.views >= 20 && row.applications === 0) add({ id: `hiring-no-applications-${row.id}`, domain: 'hiring', title: `${row.title} has views but no applications`, explanation: 'No submitted internal applications were recorded for this published role in the selected period.', evidence: { views: row.views, applyClicks: row.applyClicks, applications: row.applications }, recommendedInspection: 'Review the role details and application flow.', subjectType: 'hiring_position', subjectId: row.id, targetRoute: `subjects/hiring_position/${row.id}` });
  for (const row of reports.content?.rows || []) if (row.readers >= 20 && row.productClicks + row.contactClicks === 0) add({ id: `article-low-action-${row.id}`, domain: 'content', title: `${row.title} has readers but no tracked actions`, explanation: 'Readers did not trigger tracked product or contact actions in this period.', evidence: { readers: row.readers, productClicks: row.productClicks, contactClicks: row.contactClicks }, recommendedInspection: 'Review the article calls to action.', subjectType: 'article', subjectId: row.id, targetRoute: `subjects/article/${row.id}` });
  return findings.slice(0, 8);
}
const TARGETS = { product: ['Product'], lead: ['Lead'], quotation: ['Quotation'], hiring_position: ['Hiring'], application: ['Application'], article: ['News'], admin_user: ['User'] };
function productFunnel(performance) {
  return [
    { name: 'Product viewers', count: performance.uniqueViews },
    { name: 'Inquiry starts', count: performance.salesIntent },
    { name: 'Qualified leads', count: performance.qualifiedLeads },
    { name: 'Won deals', count: performance.orders },
  ];
}
async function subject(type, id, p, options = {}) {
  if (!SUBJECT_TYPES.includes(type) || (type !== 'campaign' && !/^[a-f\d]{24}$/i.test(id)) || (type === 'campaign' && !/^[^/?#]{1,160}$/.test(id))) { const error = new Error('Invalid subject'); error.statusCode = 400; throw error; }
  const subjectFilter = { 'subject.type': type, 'subject.id': id, occurredAt: range(p) };
  const [events, activity] = await Promise.all([
    AnalyticsEvent.aggregate([{ $match: subjectFilter }, { $group: { _id: '$name', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    options.includeActivity !== false && TARGETS[type] ? ActivityLog.find({ target: { $in: TARGETS[type] }, targetId: { $in: [id, ...(options.aliases || [])] }, createdAt: range(p) }).select('userId action eventName target targetId details.summary details.changes createdAt').populate('userId', 'fullName').sort({ createdAt: -1 }).limit(50).lean() : [],
  ]);
  let performance = null;
  let acquisition = null;
  let funnel = null;
  if (type === 'product') {
    performance = (await products(p)).rows.find(r => r.productId === id) || null;
    if (performance) {
      funnel = productFunnel(performance);
      const segments = await AnalyticsEvent.aggregate([
        { $match: { name: 'product_viewed', 'subject.type': 'product', 'subject.id': id, occurredAt: range(p), sessionId: { $ne: null }, visitorId: { $ne: null } } },
        { $lookup: { from: AnalyticsSession.collection.name, localField: 'sessionId', foreignField: 'sessionId', as: 'session' } },
        { $unwind: '$session' },
        { $group: { _id: { visitor: '$visitorId', channel: { $ifNull: ['$session.acquisition.channel', 'Unknown'] }, source: { $ifNull: ['$session.acquisition.source', 'direct'] }, campaign: { $ifNull: ['$session.acquisition.campaign', ''] }, landingPage: '$session.landingPage', device: '$session.device.type' } } },
        { $group: { _id: { channel: '$_id.channel', source: '$_id.source', campaign: '$_id.campaign', landingPage: '$_id.landingPage', device: '$_id.device' }, visitors: { $sum: 1 } } },
        { $sort: { visitors: -1 } }, { $limit: 20 },
      ]);
      acquisition = segments.map(row => ({ channel: row._id.channel, source: row._id.source, campaign: row._id.campaign || null, landingPage: row._id.landingPage || null, device: row._id.device || 'unknown', visitors: row.visitors }));
    }
  }
  let journey = [];
  if (type === 'lead') {
    const lead = await Lead.findById(id).select('status productName source estimatedValue finalValue createdAt statusHistory assignmentHistory').lean();
    if (lead) { performance = { status: lead.status, product: lead.productName, source: lead.source, estimatedValue: lead.estimatedValue, finalValue: lead.finalValue }; journey = (lead.statusHistory || []).map(item => ({ name: item.newStatus, at: item.changedAt })); }
  }
  if (type === 'quotation') {
    const quotation = await Quotation.findById(id).select('status source createdAt statusHistory').lean();
    if (quotation) { performance = { status: quotation.status, source: quotation.source }; journey = (quotation.statusHistory || []).map(item => ({ name: item.status, at: item.changedAt })); }
  }
  if (type === 'hiring_position') performance = (await hiring(p)).rows.find(r => r.id === id) || null;
  if (type === 'application') {
    const application = await Application.findById(id).select('stage hiringId source createdAt stageHistory').lean();
    if (application) { performance = { stage: application.stage, hiringId: String(application.hiringId), source: application.source }; journey = (application.stageHistory || []).map(item => ({ name: item.stage, at: item.changedAt })); }
  }
  if (type === 'article') performance = (await content(p)).rows.find(r => r.id === id) || null;
  if (type === 'article') journey = (await NewsRevision.find({ article: id }).select('version reason createdAt').sort({ version: -1 }).limit(20).lean()).map(item => ({ name: `Revision ${item.version}: ${item.reason}`, at: item.createdAt }));
  if (type === 'product_family') {
    const familyProducts = (await productRows(p)).filter(r => r.family === id);
    performance = { products: familyProducts.length, uniqueViews: familyProducts.reduce((n, r) => n + r.uniqueViews, 0), wonDeals: familyProducts.reduce((n, r) => n + r.orders, 0), revenue: familyProducts.reduce((n, r) => n + r.revenue, 0) };
  }
  if (type === 'campaign') {
    const rows = await AnalyticsSession.aggregate([{ $match: { 'acquisition.campaign': id, startedAt: range(p) } }, { $group: { _id: '$visitorId' } }, { $count: 'visitors' }]);
    performance = { campaign: id, visitors: rows[0]?.visitors || 0 };
  }
  return { subjectType: type, subjectId: id, period: serializePeriod(p), performance, acquisition, funnel, journey, events: events.map(r => ({ name: r._id, count: r.count })), activity, activityAvailable: options.includeActivity !== false, dataQuality: { historicalEvents: 'Legacy flat events may lack subject IDs and cannot be recovered for this timeline', acquisition: type === 'product' ? 'Only first-party product views with a recorded session are segmented; legacy views have no trustworthy acquisition join' : undefined, funnel: type === 'product' ? 'Stage counts mix viewer, click, and CRM entities; they are not a verified person-level cohort' : undefined } };
}
module.exports = { eventCount, uniqueEventVisitors, commercial, sales, products, buildSourceQuality, marketing, hiring, content, operations, attentionFromReports, productFunnel, subject, unavailable };
