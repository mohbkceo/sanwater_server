const express = require('express');
const router = express.Router();
const upload = require('../config/imageCloudinaryConfig')
const imageHandler = require('../controllers/contents/imageController');
const hiringController = require('../controllers/contents/hiringController');
const contactController = require('../controllers/contents/contactController');
const { authSanWater, authorize } = require('../middlewares');
const { getPageContent, updatePageContent } = require('../controllers');
const { placeOrder, getOrders, getOrderById, deleteOrder, setOrderStatus } = require('../controllers/products/orderController');


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


// Psge content
router.get('/page_content/:slug', getPageContent);
router.put('/page_content/:slug', authSanWater, updatePageContent);

router.post("/order/place", placeOrder);
router.get("/orders", getOrders);
router.get("/order/:id", getOrderById);
router.delete("/order/:id", deleteOrder);
router.patch("/order/:id/status", setOrderStatus);
module.exports = router