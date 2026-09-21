const express = require('express');
const familyController = require('../controllers/products/familyController');
const { PERMISSIONS } = require('../config/permissions');
const { authSanWater, authorize } = require('../middlewares');
const validate = require('../middlewares/validators/validate');
const {
  createFamilySchema, updateFamilySchema, createSubFamilySchema,
  updateSubFamilySchema, deleteFamilySchema, deleteSubFamilySchema,
} = require('../middlewares/validators/schemas/familyValidator');

const router = express.Router();
const canView = [authSanWater, authorize([PERMISSIONS.PRODUCTS.VIEW, PERMISSIONS.PRODUCTS.MANAGE])];
const canManage = [authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE)];

router.get('/admin', ...canView, (req, res) => {
  req.catalogAdmin = true;
  return familyController.getFamilies(req, res);
});
router.get('/', familyController.getFamilies);
router.post('/', ...canManage, validate(createFamilySchema), familyController.createFamily);
router.post('/:familyId/subfamilies', ...canManage, validate(createSubFamilySchema), familyController.createSubFamily);
router.put('/:id', ...canManage, validate(updateFamilySchema), familyController.updateFamily);
router.delete('/:id', ...canManage, validate(deleteFamilySchema), familyController.deleteFamily);
router.put('/subfamilies/:id', ...canManage, validate(updateSubFamilySchema), familyController.updateSubFamily);
router.delete('/subfamilies/:id', ...canManage, validate(deleteSubFamilySchema), familyController.deleteSubFamily);
router.get('/:slug', familyController.getFamily);

module.exports = router;
