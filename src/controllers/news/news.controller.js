const News = require('../../models/news.model');
const returnResponse = require('../../utils/responseHandler');
const { SUCCESS } = require('../../config/messages');
const { logActivity } = require('../../utils/logger');
const { PERMISSIONS, ROLES } = require('../../config/permissions');

const canViewUnpublished = (user) => {
    if (!user) return false;
    if (user.role === ROLES.SUPER_ADMIN) return true;
    return (user.permissions || []).includes(PERMISSIONS.CONTENT.VIEW);
};

const createNews = async (req, res, next) => {
    try {
        const newsData = { ...req.body, author: req.user.email || 'Admin' };
        const news = await News.create(newsData);
        await logActivity(req, 'CREATE', 'News', news._id, { title: news.title });
        return returnResponse(res, SUCCESS.RESOURCES_CREATED, news);
    } catch (err) {
        next(err);
    }
};

const getAllNews = async (req, res, next) => {
    try {
        const { page = 1, limit = 10, category, tags, search, status, featured } = req.query;
        const query = {};

        // For public access, only show published news (and scheduled that reached their time)
        const isAdmin = canViewUnpublished(req.user);
        if (!isAdmin) {
            query.$or = [
                { status: 'published' },
                { status: 'scheduled', publishedAt: { $lte: new Date() } }
            ];
        } else if (status) {
            query.status = status;
        }

        if (category) query.category = category;
        if (tags) query.tags = { $in: tags.split(',') };
        if (featured === 'true') query.isFeatured = true;
        if (search) {
            query.$text = { $search: search };
        }

        const news = await News.find(query)
            .sort(search ? { score: { $meta: 'textScore' } } : { publishedAt: -1, createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .exec();

        const count = await News.countDocuments(query);

        return returnResponse(res, SUCCESS.RESOURCES_FOUND, {
            news,
            totalPages: Math.ceil(count / limit),
            currentPage: Number(page),
            totalItems: count
        });
    } catch (err) {
        next(err);
    }
};

const getNewsBySlug = async (req, res, next) => {
    try {
        const { slug } = req.params;
        const query = { slug };

        // For public access, only show published/scheduled news
        const isAdmin = canViewUnpublished(req.user);
        if (!isAdmin) {
            query.$or = [
                { status: 'published' },
                { status: 'scheduled', publishedAt: { $lte: new Date() } }
            ];
        }

        const news = await News.findOne(query);
        if (!news) {
            return res.status(404).json({ success: false, message: 'News article not found' });
        }

        return returnResponse(res, SUCCESS.RESOURCES_FOUND, news);
    } catch (err) {
        next(err);
    }
};

const updateNews = async (req, res, next) => {
    try {
        const { id } = req.params;
        const news = await News.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
        if (!news) {
            return res.status(404).json({ success: false, message: 'News article not found' });
        }
        await logActivity(req, 'UPDATE', 'News', news._id, { title: news.title });
        return returnResponse(res, SUCCESS.RESOURCES_UPDATED, news);
    } catch (err) {
        next(err);
    }
};

const deleteNews = async (req, res, next) => {
    try {
        const { id } = req.params;
        const news = await News.findByIdAndDelete(id);
        if (!news) {
            return res.status(404).json({ success: false, message: 'News article not found' });
        }
        await logActivity(req, 'DELETE', 'News', news._id, { title: news.title });
        return returnResponse(res, SUCCESS.RESOURCES_DELETED);
    } catch (err) {
        next(err);
    }
};

module.exports = {
    createNews,
    getAllNews,
    getNewsBySlug,
    updateNews,
    deleteNews
};
