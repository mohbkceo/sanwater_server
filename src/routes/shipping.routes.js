const router = require('express').Router();
const controller = require('../controllers/shipping/shippingController');
const { authSanWater, authorize } = require('../middlewares');
const { PERMISSIONS } = require('../config/permissions');
const validate = require('../middlewares/validators/validate');
const { saveWilaya, bulk } = require('../middlewares/validators/schemas/shippingValidator');

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/wilayas', controller.wilayas);
router.get('/wilayas/:wilayaCode/communes', controller.communes);
router.get('/wilayas/:wilayaCode/communes/:communeCode/offices', controller.offices);
router.get('/quote', controller.getQuote);
router.get('/admin', authSanWater, authorize([PERMISSIONS.PRODUCTS.VIEW, PERMISSIONS.PRODUCTS.MANAGE]), controller.adminList);
router.put('/admin/wilayas/:wilayaCode', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), validate(saveWilaya), (req, res, next) => {
  if (req.params.wilayaCode !== req.body.wilaya.code) return res.status(400).json({ message: 'Wilaya code mismatch' });
  return controller.save(req, res, next);
});
router.put('/admin/bulk', authSanWater, authorize(PERMISSIONS.PRODUCTS.MANAGE), validate(bulk), controller.save);
module.exports = router;
