const { pipeline } = require("node:stream");
const CostumeException = require("../utils/CostumeException");
// Multer's storage-engine interface, retaining the existing gallery metadata.
class CloudinaryStorage {
  constructor(cloudinary) {
    this.cloudinary = cloudinary;
  }
  _handleFile(req, file, callback) {
    const folder = req.query?.folder || "productsImage";
    if (typeof folder !== "string" || !/^[a-zA-Z0-9/_-]{1,100}$/.test(folder))
      return callback(new CostumeException("Invalid image folder", 400));
    let settled = false;
    const finish = (error, data) => {
      if (!settled) {
        settled = true;
        callback(error, data);
      }
    };
    const upload = this.cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        allowed_formats: ["jpg", "png", "jpeg", "webp", "heic"],
      },
      (error, result) => {
        if (error) return finish(error);
        if (!result?.secure_url || !result.public_id)
          return finish(
            new Error("Image storage did not return a valid result"),
          );
        finish(null, {
          path: result.secure_url,
          size: result.bytes,
          filename: result.public_id,
        });
      },
    );
    pipeline(file.stream, upload, (error) => {
      if (error) finish(error);
    });
  }
  _removeFile(req, file, callback) {
    this.cloudinary.uploader.destroy(
      file.filename,
      { invalidate: true },
      callback,
    );
  }
}
module.exports = CloudinaryStorage;
