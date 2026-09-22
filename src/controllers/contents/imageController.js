const { SUCCESS, ERRORS } = require('../../config/messages');
const CostumeExption = require('../../utils/CostumeException');
const errorHandler = require('../../utils/error.middleware');
const returnResponse  = require('../../utils/responseHandler');
const { logActivity } = require('../../utils/logger');

const cloudinaryv2 = require('cloudinary').v2
async function uploadImage(req, res) {
    try {
        const path = req.file?.path;
        
        if(!path) { 
           throw new CostumeExption(ERRORS.NOT_FOUND.key, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: `image_path_not_found` })
        }

        const imageId = req.file.filename || req.file.public_id || path.split('/').pop();
        await logActivity(req, 'CREATE', 'Image', imageId, {
            summary: `Uploaded image ${imageId}`,
            entity: { id: imageId, name: imageId },
            changedFields: [], changes: [],
        });

        return returnResponse(res, SUCCESS.RESOURCES_UPDATED, {path})
    } catch (error) {
        errorHandler(res, error)
    }
}

async function destroyCloudinaryImage(req, res){
        const {imageURL} = req.query;
        if(!imageURL) return res.status(400).json({ success: false, message: 'imageURL is required' });
        const parts = imageURL.split('/upload/')[1];
        if (!parts) return res.status(400).json({ success: false, message: 'Invalid Cloudinary image URL' });
        const noVersion = parts.replace(/^v\d+\//, '');
        const publicId = noVersion.replace(/\.[^/.]+$/, "");
        const result = await cloudinaryv2.uploader.destroy(publicId);
        await logActivity(req, 'DELETE', 'Image', publicId, {
            summary: `Deleted image ${publicId}`,
            entity: { id: publicId, name: publicId },
            changedFields: [], changes: [],
            result: result.result,
        });
        return returnResponse(res, 200, `Image removed from DB`, null);
    }
module.exports = { uploadImage, destroyCloudinaryImage }


