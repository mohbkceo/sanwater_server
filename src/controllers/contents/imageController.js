const CostumeExption = require('../../utils/CostumeException');
const errorHandler = require('../../utils/error.middleware');
const { returnResponse } = require('../../utils/responseHandler');

const cloudinaryv2 = require('cloudinary').v2
async function uploadImage(req, res) {
    try {
        const path = req.file.path;
        
        if(!path) { 
           throw new CostumeExption(ERRORS.NOT_FOUND.key, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: `image_path_not_found` })
        }

        return returnResponse(res, 200, `Image uploaded`, {path})
    } catch (error) {
        errorHandler(res, error)
    }
}

async function destroyCloudinaryImage(req, res){
        const {imageURL} = req.query;
        if(!imageURL) return;
        const parts = imageURL.split('/upload/')[1];
        const noVersion = parts.replace(/^v\d+\//, '');
        const publicId = noVersion.replace(/\.[^/.]+$/, "");
        await cloudinaryv2.uploader.destroy(publicId);
        return returnResponse(res, 200, `Image removed from DB`, null);
    }
module.exports = { uploadImage, destroyCloudinaryImage }


