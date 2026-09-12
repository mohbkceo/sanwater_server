const express = require('express');
const router = express.Router();
const controller = require('../controllers/leads/leadController');
const { authSanWater, authorize } = require('../middlewares');
const { PERMISSIONS } = require('../config/permissions');
const { publicSubmissionLimiter } = require('../middlewares/rateLimit');
const validate = require('../middlewares/validators/validate');
const { createLeadSchema, updateLeadSchema, addNoteSchema, assignLeadSchema, updateLeadStatusSchema } = require('../middlewares/validators/schemas/leadValidator');

router.post('/', publicSubmissionLimiter, validate(createLeadSchema), controller.createLead);
router.get('/', authSanWater, authorize(PERMISSIONS.LEADS.VIEW), controller.getLeads);
router.get('/options', authSanWater, authorize(PERMISSIONS.LEADS.VIEW), controller.getLeadOptions);
router.get('/:id', authSanWater, authorize(PERMISSIONS.LEADS.VIEW), controller.getLeadById);
router.patch('/:id', authSanWater, authorize(PERMISSIONS.LEADS.MANAGE), validate(updateLeadSchema), controller.updateLead);
router.post('/:id/notes', authSanWater, authorize(PERMISSIONS.LEADS.MANAGE), validate(addNoteSchema), controller.addNote);
router.put('/:id/assign', authSanWater, authorize(PERMISSIONS.LEADS.MANAGE), validate(assignLeadSchema), controller.assignLead);
router.put('/:id/status', authSanWater, authorize(PERMISSIONS.LEADS.MANAGE), validate(updateLeadStatusSchema), controller.updateStatus);

module.exports = router;
