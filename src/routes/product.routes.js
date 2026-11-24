const express = require('express');
const router = express.Router();
const productController = require('../controllers/products/productControler');
const { authSanWater, authorize } = require('../middlewares');
const { PERMISSIONS } = require('../config/permissions');
const validate = require('../middlewares/validators/validate');
const Joi = require('joi');
const catalogActions = require('../controllers/products/catalogActions');
router.get('/admin/health', authSanWater, authorize([PERMISSIONS.PRODUCTS.VIEW, PERMISSIONS.PRODUCTS.MANAGE]), catalogActions.health);
const {
  createProductSchema,
  updateProductSchema,
} = require('../middlewares/validators/schemas/productValidator');

router.post('/', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), validate(createProductSchema), productController.createProduct);
router.post('/admin/bulk', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), validate(Joi.object({
  items: Joi.array().min(1).max(50).unique('serialNumber').items(Joi.object({ serialNumber: Joi.string().required(), catalogRevision: Joi.number().integer().min(0).required() })).required(),
  changes: Joi.object({ isActive: Joi.boolean().strict(), isEcommerce: Joi.boolean().strict(), salesMode: Joi.string().valid('catalog', 'ecommerce'), status: Joi.string().valid('archived', 'draft'), subFamily: Joi.string().hex().length(24) }).min(1).required(),
})), catalogActions.bulk);
router.post('/admin/:serialNumber/duplicate', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), catalogActions.duplicate);
router.get('/admin', authSanWater, authorize([PERMISSIONS.PRODUCTS.VIEW, PERMISSIONS.PRODUCTS.MANAGE]), (req, res) => {
  req.catalogAdmin = true;
  return productController.getProducts(req, res);
});
router.get('/admin/:serialNumber', authSanWater, authorize([PERMISSIONS.PRODUCTS.VIEW, PERMISSIONS.PRODUCTS.MANAGE]), (req, res) => {
  req.catalogAdmin = true;
  return productController.getProduct(req, res);
});
router.get('/', productController.getProducts);
router.get('/:serialNumber', productController.getProduct);
router.put('/:serialNumber', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), validate(updateProductSchema), productController.updateProduct);
router.delete('/:serialNumber', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), productController.deleteProduct);




module.exports = router;
