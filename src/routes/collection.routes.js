const express = require('express');
const router = express.Router();
const collectionController = require('../controllers/products/collectionController');
const { authSanWater, authorize } = require('../middlewares');
const { PERMISSIONS } = require('../config/permissions');
const validate = require('../middlewares/validators/validate');
const { collectionSchema, updateCollectionSchema } = require('../middlewares/validators/schemas/collectionValidator');

router.get('/', collectionController.getCollections);
router.get('/:slug', collectionController.getCollection);

router.post('/', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), validate(collectionSchema), collectionController.createCollection);
router.put('/:slug', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), validate(updateCollectionSchema), collectionController.updateCollection);
router.delete('/:slug', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), collectionController.deleteCollection);

module.exports = router;
