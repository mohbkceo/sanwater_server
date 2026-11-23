const Events = require('../../models/analyticsEvent.model');
const Sessions = require('../../models/analyticsSession.model');
const Lead = require('../../models/lead.model');
const Quotation = require('../../models/quotation.model');
const Application = require('../../models/application.model');
const { serializePeriod } = require('../analytics.helpers');

async function daily(Model, field, filter, p) {
  const rows = await Model.aggregate([
    { $match: { ...filter, [field]: { $gte: p.from, $lte: p.to } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: 'UTC' } }, value: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map(row => ({ date: row._id, value: row.value }));
}
async function distribution(Model, field, p, dateField = 'createdAt') {
  const rows = await Model.aggregate([{ $match: { [dateField]: { $gte: p.from, $lte: p.to } } }, { $group: { _id: { $ifNull: [`$${field}`, 'unknown'] }, value: { $sum: 1 } } }, { $sort: { value: -1 } }]);
  return rows.map(row => ({ label: row._id, value: row.value }));
}
async function forDomain(domain, p) {
  const definitions = {
    products: [Events, 'occurredAt', { name: 'product_viewed' }, 'productViews', 'unknown'],
    marketing: [Sessions, 'startedAt', {}, 'sessions', 'unknown'],
    sales: [Lead, 'createdAt', {}, 'leads', 'zero'],
    hiring: [Application, 'createdAt', {}, 'applications', 'zero'],
    content: [Events, 'occurredAt', { name: 'article_viewed' }, 'articleViews', 'unknown'],
    operations: [Quotation, 'createdAt', {}, 'quotations', 'zero'],
  };
  const [Model, field, filter, unit, missing] = definitions[domain];
  const group = { marketing: [Sessions, 'acquisition.source', 'startedAt'], sales: [Lead,'status'], hiring: [Application,'stage'], operations: [Quotation,'status'] }[domain];
  const [rows, parts] = await Promise.all([daily(Model,field,filter,p), group ? distribution(group[0],group[1],p,group[2]) : Promise.resolve(null)]);
  return {
    timeSeries: { rows, unit, missing, coverage: missing === 'unknown' ? 'tracked' : 'persisted', period: serializePeriod(p) },
    ...(parts ? { distribution: { rows: parts, unit: domain === 'marketing' ? 'sessions' : unit, currentState: domain !== 'marketing' } } : {}),
  };
}
async function forSubject(type,id,p) {
  return { rows: await daily(Events,'occurredAt',{'subject.type':type,'subject.id':String(id)},p), unit:'events', missing:'unknown', coverage:'tracked', period:serializePeriod(p) };
}
module.exports = { daily, distribution, forDomain, forSubject };
