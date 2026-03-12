const express = require('express');
const router = express.Router();
const productController = require('../controllers/products/productControler');

router.post('/', productController.createProduct);
router.get('/', productController.getProducts);
router.get('/:serialNumber', productController.getProduct);
router.put('/:serialNumber', productController.updateProduct);
router.delete('/:serialNumber', productController.deleteProduct);


module.exports = router;