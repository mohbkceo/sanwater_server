const express = require('express');
const router = express.Router();
const controller = require('../controllers/news/news.controller');
const { authSanWater, authorize } = require('../middlewares');
const { PERMISSIONS } = require('../config/permissions');
const { generateSitemap } = require('../controllers/news/sitemap.controller');
const { newsSchema, updateNewsSchema, autosaveNewsSchema, bulkNewsSchema } = require('../middlewares/validators/schemas/newsValidator');
const validate = require('../middlewares/validators/validate');

router.get('/', controller.getAllNews);
router.get('/sitemap.xml', generateSitemap);
router.get('/article/:slug', controller.getNewsBySlug);
router.get('/admin/all', authSanWater, authorize(PERMISSIONS.CONTENT.VIEW), controller.getAllNews);
router.get('/admin/:id', authSanWater, authorize(PERMISSIONS.CONTENT.VIEW), controller.getAdminNewsById);
router.get('/admin/:id/revisions', authSanWater, authorize(PERMISSIONS.CONTENT.VIEW), controller.listRevisions);
router.get('/admin/:id/revisions/:revisionId', authSanWater, authorize(PERMISSIONS.CONTENT.VIEW), controller.getRevision);
router.post('/', authSanWater, authorize(PERMISSIONS.CONTENT.MANAGE), validate(newsSchema), controller.createNews);
router.post('/bulk', authSanWater, authorize(PERMISSIONS.CONTENT.MANAGE), validate(bulkNewsSchema), controller.bulkUpdateNews);
router.put('/:id', authSanWater, authorize(PERMISSIONS.CONTENT.MANAGE), validate(updateNewsSchema), controller.updateNews);
router.patch('/:id/autosave', authSanWater, authorize(PERMISSIONS.CONTENT.MANAGE), validate(autosaveNewsSchema), controller.autosaveNews);
router.post('/:id/revisions/:revisionId/restore', authSanWater, authorize(PERMISSIONS.CONTENT.MANAGE), controller.restoreRevision);
router.delete('/:id', authSanWater, authorize(PERMISSIONS.CONTENT.MANAGE), controller.deleteNews);

module.exports = router;
