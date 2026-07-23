const express = require('express');
const router = express.Router();
const productController = require('../controllers/products/productControler');
const { authSanWater, authorize } = require('../middlewares');
const { PERMISSIONS } = require('../config/permissions');


router.post('/', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), productController.createProduct);
router.get('/', productController.getProducts);
router.get('/:serialNumber', productController.getProduct);
router.put('/:serialNumber', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), productController.updateProduct);
router.delete('/:serialNumber', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), productController.deleteProduct);




module.exports = router;