const express = require('express');
const router = express.Router();
const productController = require('../controllers/products/productControler');
const { authSanWater, authorize } = require('../middlewares');
const { PERMISSIONS } = require('../config/permissions');
const validate = require('../middlewares/validators/validate');
const {
  createProductSchema,
  updateProductSchema,
} = require('../middlewares/validators/schemas/productValidator');

router.post('/', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), validate(createProductSchema), productController.createProduct);
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
