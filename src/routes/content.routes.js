const express = require('express');
const router = express.Router();
const upload = require('../config/imageCloudinaryConfig')
const imageHandler = require('../controllers/contents/imageController');
const { authSanWater } = require('../middlewares');


router.post('/upload/image/v1', authSanWater, upload.single('image'), imageHandler.uploadImage)
router.delete('/destroy/image/v1', authSanWater, imageHandler.destroyCloudinaryImage)

module.exports = router