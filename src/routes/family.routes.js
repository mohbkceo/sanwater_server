const express = require('express');
const familyController = require('../controllers/products/familyController');
const { PERMISSIONS } = require('../config/permissions');
const { authSanWater, authorize } = require('../middlewares');
const validate = require('../middlewares/validators/validate');
const {
  familyConfigSchema,
  subFamilyConfigSchema,
} = require('../middlewares/validators/schemas/familyValidator');

const router = express.Router();

router.get(
  '/admin',
  authSanWater,
  authorize(PERMISSIONS.PRODUCTS.VIEW),
  (req, res) => {
    req.catalogAdmin = true;
    return familyController.getFamilies(req, res);
  },
);
router.get('/', familyController.getFamilies);
router.get('/:familyKey', familyController.getFamily);
router.put(
  '/:familyKey/config',
  authSanWater,
  authorize(PERMISSIONS.PRODUCTS.MANAGE),
  validate(familyConfigSchema),
  familyController.updateFamilyConfig,
);
router.put(
  '/:familyKey/subfamilies/:subFamilyKey/config',
  authSanWater,
  authorize(PERMISSIONS.PRODUCTS.MANAGE),
  validate(subFamilyConfigSchema),
  familyController.updateSubFamilyConfig,
);

module.exports = router;
