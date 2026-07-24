const express = require("express");
const router = express.Router();
const upload = require("../config/imageCloudinaryConfig");
const imageHandler = require("../controllers/contents/imageController");
const hiringController = require("../controllers/contents/hiringController");
const contactController = require("../controllers/contents/contactController");
const { authSanWater, authorize } = require("../middlewares");
const { PERMISSIONS } = require("../config/permissions");
const { getPageContent, updatePageContent } = require("../controllers");
const {
  placeOrder,
  getOrders,
  getOrderById,
  deleteOrder,
  setOrderStatus,
} = require("../controllers/products/orderController");

router.post(
  "/upload/image/v1",
  authSanWater,
  upload.single("image"),
  imageHandler.uploadImage,
);
router.delete(
  "/destroy/image/v1",
  authSanWater,
  imageHandler.destroyCloudinaryImage,
);

// Hiring routes
router.post(
  "/hiring",
  authSanWater,
  authorize(PERMISSIONS.HIRING.MANAGE),
  hiringController.createHiring,
);
router.get("/hiring", hiringController.getHiringList);
router.get("/hiring/:id", hiringController.getHiringById);
router.put(
  "/hiring/:id",
  authSanWater,
  authorize(PERMISSIONS.HIRING.MANAGE),
  hiringController.updateHiring,
);
router.delete(
  "/hiring/:id",
  authSanWater,
  authorize(PERMISSIONS.HIRING.MANAGE),
  hiringController.deleteHiring,
);

// Contact routes
router.post("/contact", contactController.submitContactForm);
router.get(
  "/contact/submissions",
  authSanWater,
  authorize(PERMISSIONS.SUBMISSIONS.VIEW),
  contactController.getSubmissions,
);
router.put(
  "/contact/submissions/:id",
  authSanWater,
  authorize(PERMISSIONS.SUBMISSIONS.MANAGE),
  contactController.updateSubmissionStatus,
);

router.delete(
  "/contact/submissions/:id",
  authSanWater,
  authorize(PERMISSIONS.SUBMISSIONS.MANAGE),
  contactController.deleteSubmission,
);

router.delete(
  "/contact/submissions",
  authSanWater,
  authorize(PERMISSIONS.SUBMISSIONS.MANAGE),
  contactController.deleteManySubmissions,
);

// Page content
router.get("/page_content/:slug", getPageContent);
router.put(
  "/page_content/:slug",
  authSanWater,
  authorize(PERMISSIONS.CONTENT.MANAGE),
  updatePageContent,
);

// Orders
router.post("/order/place", placeOrder);
router.get(
  "/orders",
  authSanWater,
  authorize(PERMISSIONS.ORDERS.VIEW),
  getOrders,
);
router.get(
  "/order/:id",
  authSanWater,
  authorize(PERMISSIONS.ORDERS.VIEW),
  getOrderById,
);
router.delete(
  "/order/:id",
  authSanWater,
  authorize(PERMISSIONS.ORDERS.MANAGE),
  deleteOrder,
);
router.patch(
  "/order/:id/status",
  authSanWater,
  authorize(PERMISSIONS.ORDERS.MANAGE),
  setOrderStatus,
);
module.exports = router;
