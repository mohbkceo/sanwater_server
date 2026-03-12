const cloudinary = require('cloudinary').v2
const {CloudinaryStorage} = require('multer-storage-cloudinary')
const multer = require('multer')

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key:  process.env.CLOUDINARY_API_KEY,
    api_secret:  process.env.CLOUDINARY_API_SECRET
})

const storage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) => {
        let folder = req?.query?.folder || 'productsImage';
        let transformation = req?.body?.transformation ?? [{ width: 300, height: 300, crop: 'fill' }];
         
        return {
            folder: folder,
            allowed_formats: ['jpg', 'png', 'jpeg', 'heic'],
            transformation: transformation
        }
    }
    
})



const upload = multer({ storage })

module.exports = upload
