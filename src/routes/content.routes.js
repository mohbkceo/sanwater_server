const express = require('express');
const router = express.Router();
const upload = require('../config/imageCloudinaryConfig')
const imageHandler = require('../controllers/contents/imageController');
const hiringController = require('../controllers/contents/hiringController');
const contactController = require('../controllers/contents/contactController');
const { authSanWater, authorize } = require('../middlewares');


router.post('/upload/image/v1', authSanWater, upload.single('image'), imageHandler.uploadImage)
router.delete('/destroy/image/v1', authSanWater, imageHandler.destroyCloudinaryImage)

// Hiring routes
router.post('/hiring', authSanWater, authorize('admin'), hiringController.createHiring);
router.get('/hiring', hiringController.getHiringList);
router.get('/hiring/:id', hiringController.getHiringById);
router.put('/hiring/:id', authSanWater, authorize('admin'), hiringController.updateHiring);
router.delete('/hiring/:id', authSanWater, authorize('admin'), hiringController.deleteHiring);

// Contact routes
router.post('/contact', contactController.submitContactForm);
router.get('/contact/submissions', authSanWater, authorize('admin'), contactController.getSubmissions);
router.put('/contact/submissions/:id', authSanWater, authorize('admin'), contactController.updateSubmissionStatus);

module.exports = router