const express = require('express');
const router = express.Router();
const upload = require('../config/imageCloudinaryConfig')
const imageHandler = require('../controllers/contents/imageController')


router.post('/upload/image/v1', upload.single('image'), imageHandler.uploadImage)
router.delete('/destroy/image/v1', imageHandler.destroyCloudinaryImage)

module.exports = router