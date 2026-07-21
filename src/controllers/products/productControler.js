const { ERRORS, SUCCESS } = require('../../config/messages');
const CostumeExption = require('../../utils/CostumeException');
const Product = require('../../models/product.model');
const generateSerialNumber = require('../../utils/serialNumberGenerator');
const errorHandler = require('../../utils/error.middleware');
const  returnResponse  = require('../../utils/responseHandler');
const { default: mongoose } = require('mongoose');
const { logActivity } = require('../../utils/logger');

async function createProduct(req, res) {
    try {

        const {
            family,
            tags,
            name,
            gallery,
            productId,
            productVariants,
            prices
        } = req.body;

        const author = 'sanwater_admin@gmail.com'
        let serialNumber;

        do {
            serialNumber = generateSerialNumber('product');
        } while (await Product.exists({serialNumber}));

        if (!author || !serialNumber) {
            throw new CostumeExption('author and serialNumber are required', ERRORS.REQUIRED.statusCode, ERRORS.REQUIRED.key, {message: `author_or_serialNumber_not_passed`})
        }

        const product = new Product({
            author,
            family,
            name,
            serialNumber,
            tags,
            productId,
            gallery,
            productVariants,
            prices
        });

        await product.save();
        await logActivity(req, 'CREATE', 'Product', serialNumber, { name });

        return returnResponse(res, SUCCESS.RESOURCES_CREATED, product);

    } catch (error) {

       errorHandler(res, error)

    }
}
const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toNumber = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const toBoolean = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return undefined;
};

async function getProducts(req, res) {
  try {
    const {
      search,
      family,
      minPrice,
      maxPrice,
      inStock,
      isAdmin,
      max,
      isEcommerce,
      lastId,
      sortBy,
      sortOrder,
    } = req.query;

    const limit = isAdmin ? 1000 : Math.min(Number(max) || 15, 100);

    const query = {};

    
    if (!isAdmin) {
      query.isActive = true;
      query.isEcommerce = null;
    }

    if(isEcommerce && typeof isEcommerce === 'string'){
      query.isEcommerce = true
    }

    if (lastId && mongoose.isValidObjectId(lastId)) {
      query._id = { $lt: new mongoose.Types.ObjectId(lastId) };
    }

    
    if (typeof search === "string" && search.trim()) {
      const safe = escapeRegex(search.trim());
      query.$or = [
        { name: { $regex: safe, $options: "i" } },
        { family: { $regex: safe, $options: "i" } },
        { productId: { $regex: safe, $options: "i" } },
      ];
    }

    // Family filter
    if (typeof family === "string" && family.trim()) {
      query.family = { $regex: escapeRegex(family.trim()), $options: "i" };
    }

    // Price range
    const min = toNumber(minPrice);
    const maxP = toNumber(maxPrice);

    if (min !== undefined || maxP !== undefined) {
      query.price = {};
      if (min !== undefined) query.price.$gte = min;
      if (maxP !== undefined) query.price.$lte = maxP;
    }

    // Stock filter
    const stock = toBoolean(inStock);
    if (stock === true) {
      query.stock = { $gt: 0 };
    } else if (stock === false) {
      query.stock = { $lte: 0 };
    }

    // Controlled sorting
    const allowedSortFields = new Set(["createdAt", "price", "name", "_id"]);
    const safeSortBy = allowedSortFields.has(sortBy) ? sortBy : "createdAt";
    const safeSortOrder = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;

    const sort = {};
    sort[safeSortBy] = safeSortOrder;

    // Stable tiebreaker
    if (safeSortBy !== "_id") {
      sort._id = -1;
    }

    console.log(query)

    const products = await Product.find(query)
      .sort(sort)
      .limit(limit)
      .lean();

    return returnResponse(res, SUCCESS.RESOURCES_FOUND, {
      products,
      count: products.length,
      hasMore: products.length === limit,
      nextLastId: products.length ? products[products.length - 1]._id : null,
    });
  } catch (error) {
    errorHandler(res, error);
  }
}


async function getProduct(req, res) {

    try {

        const { serialNumber } = req.params;
        const { isAdmin } = req.query;

        const query = { serialNumber };
        
        if (!isAdmin) {
          query.isActive = true;
          
        }

        const product = await Product.findOne(query);

        if (!product) {
           throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: `product_not_found` });
        }

        return returnResponse(res, SUCCESS.RESOURCES_UPDATED, product)

    } catch (error) {

        errorHandler(res, error)

    }

}


async function updateProduct(req, res) {

    try {

        const { serialNumber } = req.params;
        const {
            family,
            tags,
            productVariants,
            gallery,
            prices,
            name,
            isActive
        } = req.body;

        const updateData = {
            family,
            name,
            tags,
            gallery,
            productVariants,
            prices
        };

        // Allow updating isActive field
        if (isActive !== undefined) {
            updateData.isActive = isActive;
        }

        const product = await Product.findOneAndUpdate(
            { serialNumber },
            updateData,
            { new: true }
        );

        if (!product) {
            throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: `product_not_found` })
        }

        await logActivity(req, 'UPDATE', 'Product', serialNumber, { name, isActive: product.isActive });
        return returnResponse(res, SUCCESS.RESOURCES_UPDATED, product);

    } catch (error) {

        errorHandler(res, error);

    }

}

async function deleteProduct(req, res) {

    try {

        const { serialNumber } = req.params;

        const product = await Product.findOneAndDelete({ serialNumber });

        if (!product) {
         throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: `product_not_found` })

        }

        await logActivity(req, 'DELETE', 'Product', serialNumber);
        return returnResponse(res, SUCCESS.RESOURCES_DELETED);

    } catch (error) {

        errorHandler(res, error);

    }

}


module.exports = {
    createProduct,
    getProducts,
    getProduct,
    updateProduct,
    deleteProduct,
};