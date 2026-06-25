const express = require('express');
const router = express.Router();
const { authSanWater, authorize } = require('../middlewares');
const { createNews, getAllNews, getNewsBySlug, updateNews, deleteNews } = require('../controllers/news/news.controller');
const { generateSitemap } = require('../controllers/news/sitemap.controller');
const { newsSchema, updateNewsSchema } = require('../middlewares/validators/schemas/newsValidator');
const validate = require('../middlewares/validators/validate');

// Public routes
router.get('/', getAllNews);
router.get('/sitemap.xml', generateSitemap);
router.get('/article/:slug', getNewsBySlug);

// Admin routes
router.post('/', authSanWater, authorize('admin'), validate(newsSchema), createNews);
router.get('/admin/all', authSanWater, authorize('admin'), getAllNews);
router.put('/:id', authSanWater, authorize('admin'), validate(updateNewsSchema), updateNews);
router.delete('/:id', authSanWater, authorize('admin'), deleteNews);

module.exports = router;
