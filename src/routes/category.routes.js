const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/products/categoryController');
const { authSanWater, authorize } = require('../middlewares');
const { PERMISSIONS } = require('../config/permissions');
const validate = require('../middlewares/validators/validate');
const { categorySchema, updateCategorySchema } = require('../middlewares/validators/schemas/categoryValidator');

// Categories are part of the product catalog, so they're gated behind the
// existing PRODUCTS permission group rather than a new one.
router.get('/', categoryController.getCategories);
router.get('/:slug', categoryController.getCategory);

router.post('/', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), validate(categorySchema), categoryController.createCategory);
router.put('/:slug', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), validate(updateCategorySchema), categoryController.updateCategory);
router.delete('/:slug', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), categoryController.deleteCategory);

module.exports = router;
