const cloudinary = require("cloudinary").v2;
const CloudinaryStorage = require("../services/cloudinaryStorage");
const multer = require("multer");
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const storage = new CloudinaryStorage(cloudinary);
module.exports = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 },
});
