const express = require('express');
const router = express.Router();
const quotationController = require('../controllers/quotations/quotationController');
const { authSanWater, authorize } = require('../middlewares');
const { PERMISSIONS } = require('../config/permissions');
const { publicSubmissionLimiter } = require('../middlewares/rateLimit');
const validate = require('../middlewares/validators/validate');
const { createQuotationSchema, updateQuotationStatusSchema } = require('../middlewares/validators/schemas/quotationValidator');

// Public: anyone (consumer, contractor, dealer, ...) can request a quote.
router.post('/', publicSubmissionLimiter, validate(createQuotationSchema), quotationController.createQuotation);

// Admin-only from here down.
router.get('/', authSanWater, authorize(PERMISSIONS.QUOTATIONS.VIEW), quotationController.getQuotations);
router.get('/:id', authSanWater, authorize(PERMISSIONS.QUOTATIONS.VIEW), quotationController.getQuotationById);
router.put('/:id/status', authSanWater, authorize(PERMISSIONS.QUOTATIONS.MANAGE), validate(updateQuotationStatusSchema), quotationController.updateQuotationStatus);
router.put('/:id/assign', authSanWater, authorize(PERMISSIONS.QUOTATIONS.MANAGE), quotationController.assignQuotation);

module.exports = router;
