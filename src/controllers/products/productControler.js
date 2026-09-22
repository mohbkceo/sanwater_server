const { ERRORS, SUCCESS } = require("../../config/messages");
const CostumeExption = require("../../utils/CostumeException");
const Product = require("../../models/product.model");
const generateSerialNumber = require("../../utils/serialNumberGenerator");
const errorHandler = require("../../utils/error.middleware");
const returnResponse = require("../../utils/responseHandler");
const { default: mongoose } = require("mongoose");
const { logActivity, logUpdateActivity } = require("../../utils/logger");
const { buildEntityDetails } = require("../../utils/audit");
const {
  resolveCatalogFilter,
} = require("../../services/taxonomy.service");

async function createProduct(req, res) {
  try {
    const {
      tags,
      name,
      gallery,
      productId,
      productVariants,
      prices,
      isActive,
      isEcommerce,
      slug,
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

    const author = req.user.email || req.user.uid;
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
      family: null,
      subFamily: null,
      name,
      serialNumber,
      tags,
      productId,
      gallery,
      productVariants,
      prices,
      isActive,
      isEcommerce,
      slug,
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
    await logActivity(req, "CREATE", "Product", serialNumber, buildEntityDetails('Product', product, `Created product ${product.name || serialNumber}`));

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
      subFamily,
      minPrice,
      maxPrice,
      max,
      isEcommerce,
      lastId,
      sortBy,
      sortOrder,
      assignment,
      page,
      limit: requestedLimit,
    } = req.query;

    const isAdmin = Boolean(req.catalogAdmin);
    const limit = Math.min(Math.max(Number(requestedLimit || max) || (isAdmin ? 50 : 15), 1), 100);
    const currentPage = isAdmin ? Math.max(Number(page) || 1, 1) : 1;

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
        { productId: { $regex: safe, $options: "i" } },
        { serialNumber: { $regex: safe, $options: "i" } },
      ];
    }

    if (isAdmin && assignment === 'unassigned') {
      query.$and = [...(query.$and || []), {
        $or: [{ subFamily: null }, { subFamily: { $exists: false } }],
      }];
    } else if (isAdmin && assignment === 'assigned') {
      query.$and = [...(query.$and || []), { subFamily: { $exists: true, $ne: null } }];
    }

    Object.assign(query, await resolveCatalogFilter({
      family,
      subFamily,
      publicOnly: !isAdmin,
    }));

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

    const findQuery = Product.find(query)
      .populate('family', 'name slug isActive')
      .populate('subFamily', 'name slug family isActive')
      .sort(sort)
      .limit(limit);
    if (isAdmin) findQuery.skip((currentPage - 1) * limit);
    const [products, totalCount] = await Promise.all([
      findQuery.lean(),
      isAdmin ? Product.countDocuments(query) : Promise.resolve(null),
    ]);
    const totalPages = isAdmin ? Math.max(Math.ceil(totalCount / limit), 1) : undefined;

    return returnResponse(res, SUCCESS.RESOURCES_FOUND, {
      products,
      count: products.length,
      ...(isAdmin ? {
        totalCount,
        page: currentPage,
        limit,
        totalPages,
        hasMore: currentPage < totalPages,
        nextLastId: null,
      } : {
        hasMore: products.length === limit,
        nextLastId: products.length ? products[products.length - 1]._id : null,
      }),
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
    const productQuery = {
      $or: [{ serialNumber }, { slug: serialNumber }],
    };
    if (!req.catalogAdmin) {
      Object.assign(productQuery, await resolveCatalogFilter({ publicOnly: true }));
      productQuery.isActive = true;
    }
    const product = await Product.findOne(productQuery)
      .populate('family', 'name slug isActive')
      .populate('subFamily', 'name slug family isActive')
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
      tags,
      productVariants,
      gallery,
      prices,
      isEcommerce,
      name,
      productId,
      isActive,
      slug,
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

    const candidateUpdates = {
      name,
      productId,
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
      isActive,
      slug,
    };
    const updateData = Object.fromEntries(
      Object.entries(candidateUpdates).filter(([, value]) => value !== undefined),
    );

    const before = await Product.findOne({ serialNumber }).populate('family', 'name slug').populate('subFamily', 'name slug family');
    if (!before) {
      throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: `product_not_found` });
    }
    const product = await Product.findOneAndUpdate(
      { serialNumber },
      updateData,
      { new: true, runValidators: true },
    ).populate('family', 'name slug').populate('subFamily', 'name slug family');

    if (!product) {
      throw new CostumeExption(
        ERRORS.NOT_FOUND.msg,
        ERRORS.NOT_FOUND.statusCode,
        ERRORS.NOT_FOUND.key,
        { message: `product_not_found` },
      );
    }

    await logUpdateActivity(req, "UPDATE", "Product", serialNumber, before, product, `Updated product ${product.name || serialNumber}`);
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

    await logActivity(req, "DELETE", "Product", serialNumber, buildEntityDetails('Product', product, `Deleted product ${product.name || serialNumber}`, { deleted: true }));
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
