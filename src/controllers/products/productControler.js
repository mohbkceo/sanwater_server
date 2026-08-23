const { ERRORS, SUCCESS } = require("../../config/messages");
const CostumeExption = require("../../utils/CostumeException");
const Product = require("../../models/product.model");
const generateSerialNumber = require("../../utils/serialNumberGenerator");
const errorHandler = require("../../utils/error.middleware");
const returnResponse = require("../../utils/responseHandler");
const { default: mongoose } = require("mongoose");
const { logActivity } = require("../../utils/logger");

async function createProduct(req, res) {
  try {
    const {
      family,
      tags,
      name,
      gallery,
      productId,
      productVariants,
      prices,
      // catalog / digital-representation fields
      category,
      subcategory,
      collection, // public API name; stored as collectionRef (see product.model.js)
      shortDescription,
      description,
      material,
      finishes,
      dimensions,
      installation,
      applications,
      specifications,
      documents,
      relatedProducts,
      status,
      seo,
    } = req.body;

    const author = "sanwater_admin@gmail.com";
    let serialNumber;

    do {
      serialNumber = generateSerialNumber("product");
    } while (await Product.exists({ serialNumber }));

    if (!author || !serialNumber) {
      throw new CostumeExption(
        "author and serialNumber are required",
        ERRORS.REQUIRED.statusCode,
        ERRORS.REQUIRED.key,
        { message: `author_or_serialNumber_not_passed` },
      );
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
      prices,
      category: category || null,
      subcategory: subcategory || null,
      collectionRef: collection || null,
      shortDescription,
      description,
      material,
      finishes,
      dimensions,
      installation,
      applications,
      specifications,
      documents,
      relatedProducts,
      status,
      seo,
    });

    await product.save();
    await logActivity(req, "CREATE", "Product", serialNumber, { name });

    return returnResponse(res, SUCCESS.RESOURCES_CREATED, product);
  } catch (error) {
    errorHandler(res, error);
  }
}
const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toNumber = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

async function getProducts(req, res) {
  try {
    const {
      search,
      family,
      category,
      collection,
      minPrice,
      maxPrice,
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
      // Public catalog = anything not explicitly flagged e-commerce-only.
      // `isEcommerce` defaults to `false` on the schema, so nearly every
      // real product has it stored as `false`, not missing/null — querying
      // for strictly `null` here was excluding the entire live catalog
      // (confirmed: 210/211 products have isEcommerce:false, 0 have null).
      query.isEcommerce = { $in: [false, null] };
    }

    if (typeof category === "string" && category.trim()) {
      const Category = require("../../models/category.model");
      const categoryDoc = await Category.findOne({ slug: category.trim() }).select("_id");
      // An unknown category slug should return an empty result set, not the
      // full unfiltered catalog, so fall back to an id nothing can match.
      query.category = categoryDoc ? categoryDoc._id : new mongoose.Types.ObjectId();
    }

    if (typeof collection === "string" && collection.trim()) {
      const Collection = require("../../models/collection.model");
      const collectionDoc = await Collection.findOne({ slug: collection.trim() }).select("_id");
      query.collectionRef = collectionDoc ? collectionDoc._id : new mongoose.Types.ObjectId();
    }

    if (isEcommerce === "true") {
      query.isEcommerce = true;
    } else if (isEcommerce === "false") {
      query.isEcommerce = { $in: [false, null] };
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

    if (typeof family === "string" && family.trim()) {
      query.family = { $regex: escapeRegex(family.trim()), $options: "i" };
    }

    const min = toNumber(minPrice);
    const maxP = toNumber(maxPrice);

    // Price lives at `prices.productPrice` on the schema, not a top-level
    // `price` field — querying `price` directly (as this used to) matches
    // nothing since no document has that field.
    if (min !== undefined || maxP !== undefined) {
      query["prices.productPrice"] = {};
      if (min !== undefined) query["prices.productPrice"].$gte = min;
      if (maxP !== undefined) query["prices.productPrice"].$lte = maxP;
    }

    // `inStock` intentionally not implemented as a filter: the Product
    // schema has no stock/inventory quantity field, only `isActive`
    // (already forced true above for the public catalog), so there is no
    // real data to filter on yet.

    const sortFieldMap = { createdAt: "createdAt", price: "prices.productPrice", name: "name", _id: "_id" };
    const safeSortBy = sortFieldMap[sortBy] || "createdAt";
    const safeSortOrder = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;

    const sort = {};
    sort[safeSortBy] = safeSortOrder;

    if (safeSortBy !== "_id") {
      sort._id = -1;
    }

    const products = await Product.find(query)
      .sort(sort)
      .limit(limit)
      .populate("category", "name slug")
      .populate("collectionRef", "name slug")
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

    // Accept either the internal serialNumber or the public SEO slug so the
    // same endpoint keeps working as the frontend migrates its product URLs
    // from /products/view/:serialNumber to slug-based routes.
    const product = await Product.findOne({
      $or: [{ serialNumber }, { slug: serialNumber }],
    })
      .populate("category", "name slug")
      .populate("subcategory", "name slug")
      .populate("collectionRef", "name slug")
      .populate("relatedProducts", "name slug productId gallery shortDescription");

    if (!product) {
      throw new CostumeExption(
        ERRORS.NOT_FOUND.msg,
        ERRORS.NOT_FOUND.statusCode,
        ERRORS.NOT_FOUND.key,
        { message: `product_not_found` },
      );
    }

    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, product);
  } catch (error) {
    errorHandler(res, error);
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
      isEcommerce,
      name,
      isActive,
      // catalog / digital-representation fields
      slug,
      category,
      subcategory,
      collection,
      shortDescription,
      description,
      material,
      finishes,
      dimensions,
      installation,
      applications,
      specifications,
      documents,
      relatedProducts,
      status,
      seo,
    } = req.body;

    const updateData = {
      family,
      name,
      tags,
      gallery,
      productVariants,
      prices,
      isEcommerce,
      shortDescription,
      description,
      material,
      finishes,
      dimensions,
      installation,
      applications,
      specifications,
      documents,
      relatedProducts,
      status,
      seo,
    };

    // Only touch relational/slug fields when explicitly provided, so a
    // partial update never accidentally clears them.
    if (slug !== undefined) updateData.slug = slug;
    if (category !== undefined) updateData.category = category || null;
    if (subcategory !== undefined) updateData.subcategory = subcategory || null;
    if (collection !== undefined) updateData.collectionRef = collection || null;

    // Allow updating isActive field
    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    const product = await Product.findOneAndUpdate(
      { serialNumber },
      updateData,
      { new: true, runValidators: true },
    );

    if (!product) {
      throw new CostumeExption(
        ERRORS.NOT_FOUND.msg,
        ERRORS.NOT_FOUND.statusCode,
        ERRORS.NOT_FOUND.key,
        { message: `product_not_found` },
      );
    }

    await logActivity(req, "UPDATE", "Product", serialNumber, {
      name,
      isActive: product.isActive,
    });
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
      throw new CostumeExption(
        ERRORS.NOT_FOUND.msg,
        ERRORS.NOT_FOUND.statusCode,
        ERRORS.NOT_FOUND.key,
        { message: `product_not_found` },
      );
    }

    await logActivity(req, "DELETE", "Product", serialNumber);
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
