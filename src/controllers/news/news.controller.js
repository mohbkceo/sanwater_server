const mongoose = require('mongoose');
const News = require('../../models/news.model');
const NewsRevision = require('../../models/newsRevision.model');
const Product = require('../../models/product.model');
const User = require('../../models/user.model');
const Event = require('../../models/event.model');
const returnResponse = require('../../utils/responseHandler');
const { SUCCESS, ERRORS } = require('../../config/messages');
const CostumeExption = require('../../utils/CostumeException');
const { logActivity } = require('../../utils/logger');
const sanitizeNewsHtml = require('../../utils/sanitizeNewsHtml');

const EDITABLE_FIELDS = ['title', 'excerpt', 'content', 'coverImage', 'category', 'tags', 'status', 'publishedAt', 'seoTitle', 'seoDescription', 'canonicalUrl', 'isFeatured', 'relatedProducts'];
const AUTOSAVE_FIELDS = EDITABLE_FIELDS.filter((field) => !['status', 'publishedAt'].includes(field));
const generateSlug = (text) => String(text || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-');

async function ensureRelatedProducts(ids = []) {
  if (!ids.length) return [];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new CostumeExption(ERRORS.INVALID.msg, 422, ERRORS.INVALID.key, { message: 'invalid_related_product' });
  const uniqueIds = [...new Set(ids.map(String))];
  const products = await Product.find({ _id: { $in: uniqueIds } }).select('_id').lean();
  if (products.length !== uniqueIds.length) throw new CostumeExption(ERRORS.INVALID.msg, 422, ERRORS.INVALID.key, { message: 'invalid_related_product' });
  return products.map((product) => product._id);
}

function snapshot(article) {
  const raw = article.toObject ? article.toObject() : article;
  return Object.fromEntries(EDITABLE_FIELDS.concat(['slug', 'author']).filter((field) => raw[field] !== undefined).map((field) => [field, raw[field]]));
}

async function createRevision(article, userId, reason = 'manual_save') {
  const latest = await NewsRevision.findOne({ article: article._id }).sort({ version: -1 }).select('version').lean();
  return NewsRevision.create({ article: article._id, version: (latest?.version || 0) + 1, editor: userId, reason, snapshot: snapshot(article) });
}

async function applyPayload(article, payload, fields = EDITABLE_FIELDS) {
  for (const field of fields) {
    if (payload[field] !== undefined && field !== 'relatedProducts') {
      article[field] = field === 'content' ? sanitizeNewsHtml(payload[field]) : payload[field];
    }
  }
  if (payload.relatedProducts !== undefined && fields.includes('relatedProducts')) article.relatedProducts = await ensureRelatedProducts(payload.relatedProducts);
  if (payload.title !== undefined) article.slug = generateSlug(payload.title);
}

function publicFilter() {
  return { $or: [{ status: 'published' }, { status: 'scheduled', publishedAt: { $lte: new Date() } }] };
}

const createNews = async (req, res, next) => {
  try {
    const news = new News({ author: req.user.email || 'Admin', authorUser: req.user.uid, status: 'draft' });
    await applyPayload(news, req.body);
    if (news.status === 'published') news.publishedAt = new Date();
    await news.save();
    await createRevision(news, req.user.uid, news.status === 'published' ? 'publish' : 'manual_save');
    await logActivity(req, 'CREATE', 'News', news._id, { title: news.title, status: news.status });
    return returnResponse(res, SUCCESS.RESOURCES_CREATED, news);
  } catch (err) { next(err); }
};

const getAllNews = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
    const admin = Boolean(req.user);
    const query = admin ? {} : publicFilter();
    if (admin && req.query.status) query.status = req.query.status;
    if (req.query.category) query.category = req.query.category;
    if (admin && req.query.author) query.authorUser = req.query.author;
    if (req.query.tags) query.tags = { $in: String(req.query.tags).split(',').map((tag) => tag.trim()).filter(Boolean) };
    if (req.query.featured === 'true') query.isFeatured = true;
    if (req.query.featured === 'false') query.isFeatured = false;
    if (req.query.from || req.query.to) {
      query.updatedAt = {};
      if (req.query.from) query.updatedAt.$gte = new Date(req.query.from);
      if (req.query.to) query.updatedAt.$lte = new Date(req.query.to);
    }
    if (req.query.search) query.$text = { $search: String(req.query.search).slice(0, 150) };

    const find = News.find(query, admin ? undefined : '-authorUser')
      .populate('relatedProducts', 'name serialNumber slug gallery shortDescription prices');
    if (admin) find.populate('authorUser', 'fullName email');
    const [news, count, counts, filterOptions] = await Promise.all([
      find.sort(req.query.search ? { score: { $meta: 'textScore' } } : { publishedAt: -1, updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      News.countDocuments(query),
      admin ? News.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]) : Promise.resolve([]),
      admin ? Promise.all([News.distinct('category'), User.find({ role: { $in: ['admin', 'super_admin'] } }).select('fullName email').sort({ fullName: 1 }).lean()]) : Promise.resolve([[], []]),
    ]);
    if (admin && news.length) {
      const views = await Event.aggregate([{ $match: { type: 'article_view', 'meta.article_id': { $in: news.map((item) => String(item._id)) } } }, { $group: { _id: '$meta.article_id', count: { $sum: 1 }, visitors: { $addToSet: '$visitor_id' } } }]);
      const viewMap = Object.fromEntries(views.map((item) => [item._id, { views: item.count, uniqueReaders: item.visitors.filter(Boolean).length }]));
      news.forEach((item) => Object.assign(item, viewMap[String(item._id)] || { views: 0, uniqueReaders: 0 }));
    }
    return returnResponse(res, SUCCESS.RESOURCES_FOUND, { news, totalPages: Math.ceil(count / limit), currentPage: page, totalItems: count, counts: admin ? Object.fromEntries(counts.map((item) => [item._id, item.count])) : undefined, filters: admin ? { categories: filterOptions[0].filter(Boolean).sort(), authors: filterOptions[1] } : undefined });
  } catch (err) { next(err); }
};

const getNewsBySlug = async (req, res, next) => {
  try {
    const news = await News.findOne({ slug: req.params.slug, ...publicFilter() }).select('-authorUser').populate('relatedProducts', 'name serialNumber slug gallery shortDescription prices');
    if (!news) return res.status(404).json({ success: false, message: 'News article not found' });
    return returnResponse(res, SUCCESS.RESOURCES_FOUND, news);
  } catch (err) { next(err); }
};

const getAdminNewsById = async (req, res, next) => {
  try {
    const news = await News.findById(req.params.id).populate('authorUser', 'fullName email').populate('relatedProducts', 'name serialNumber slug gallery shortDescription prices');
    if (!news) throw new CostumeExption(ERRORS.NOT_FOUND.msg, 404);
    return returnResponse(res, SUCCESS.RESOURCES_FOUND, news);
  } catch (err) { next(err); }
};

const updateNews = async (req, res, next) => {
  try {
    const news = await News.findById(req.params.id);
    if (!news) throw new CostumeExption(ERRORS.NOT_FOUND.msg, 404);
    const previousStatus = news.status;
    await applyPayload(news, req.body);
    if (news.status === 'published' && previousStatus !== 'published') news.publishedAt = new Date();
    await news.save();
    const reason = news.status === 'published' && previousStatus !== 'published' ? 'publish' : 'manual_save';
    await createRevision(news, req.user.uid, reason);
    await logActivity(req, 'UPDATE', 'News', news._id, { title: news.title, previousStatus, status: news.status });
    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, news);
  } catch (err) { next(err); }
};

const autosaveNews = async (req, res, next) => {
  try {
    const news = await News.findById(req.params.id);
    if (!news) throw new CostumeExption(ERRORS.NOT_FOUND.msg, 404);
    const status = news.status;
    await applyPayload(news, req.body, AUTOSAVE_FIELDS);
    news.status = status;
    await news.save();
    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, { _id: news._id, updatedAt: news.updatedAt, status: news.status });
  } catch (err) { next(err); }
};

const listRevisions = async (req, res, next) => {
  try {
    const revisions = await NewsRevision.find({ article: req.params.id }).select('-snapshot').populate('editor', 'fullName email').sort({ version: -1 }).lean();
    return returnResponse(res, SUCCESS.RESOURCES_FOUND, revisions);
  } catch (err) { next(err); }
};

const getRevision = async (req, res, next) => {
  try {
    const revision = await NewsRevision.findOne({ _id: req.params.revisionId, article: req.params.id }).populate('editor', 'fullName email');
    if (!revision) throw new CostumeExption(ERRORS.NOT_FOUND.msg, 404);
    return returnResponse(res, SUCCESS.RESOURCES_FOUND, revision);
  } catch (err) { next(err); }
};

const restoreRevision = async (req, res, next) => {
  try {
    const [news, revision] = await Promise.all([News.findById(req.params.id), NewsRevision.findOne({ _id: req.params.revisionId, article: req.params.id })]);
    if (!news || !revision) throw new CostumeExption(ERRORS.NOT_FOUND.msg, 404);
    await applyPayload(news, revision.snapshot);
    await news.save();
    await createRevision(news, req.user.uid, 'restore');
    await logActivity(req, 'RESTORE_REVISION', 'News', news._id, { restoredVersion: revision.version });
    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, news);
  } catch (err) { next(err); }
};

const bulkUpdateNews = async (req, res, next) => {
  try {
    const { ids, action } = req.body;
    const articles = await News.find({ _id: { $in: ids } });
    for (const article of articles) {
      if (action === 'publish') { article.status = 'published'; article.publishedAt = new Date(); }
      if (action === 'archive') article.status = 'archived';
      if (action === 'unfeature') article.isFeatured = false;
      await article.save();
      await createRevision(article, req.user.uid, action === 'publish' ? 'publish' : 'manual_save');
    }
    await logActivity(req, 'BULK_UPDATE', 'News', null, { ids, action, updated: articles.length });
    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, { updated: articles.length });
  } catch (err) { next(err); }
};

const deleteNews = async (req, res, next) => {
  try {
    const news = await News.findById(req.params.id);
    if (!news) throw new CostumeExption(ERRORS.NOT_FOUND.msg, 404);
    news.status = 'archived';
    await news.save();
    await createRevision(news, req.user.uid, 'manual_save');
    await logActivity(req, 'ARCHIVE', 'News', news._id, { title: news.title });
    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, news);
  } catch (err) { next(err); }
};

module.exports = { createNews, getAllNews, getNewsBySlug, getAdminNewsById, updateNews, autosaveNews, listRevisions, getRevision, restoreRevision, bulkUpdateNews, deleteNews };
