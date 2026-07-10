const express = require('express');
const router = express.Router();
const productController = require('../controllers/products/productControler');
const { authSanWater } = require('../middlewares');


router.post('/', authSanWater, productController.createProduct);
router.get('/', productController.getProducts);
router.get('/:serialNumber', productController.getProduct);
router.put('/:serialNumber', authSanWater, productController.updateProduct);
router.delete('/:serialNumber', authSanWater, productController.deleteProduct);




module.exports = router;