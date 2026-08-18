const { ERRORS, SUCCESS } = require('../../config/messages');
const CostumeExption = require('../../utils/CostumeException');
const errorHandler = require('../../utils/error.middleware');
const returnResponse = require('../../utils/responseHandler');
const Category = require('../../models/category.model');
const { logActivity } = require('../../utils/logger');

async function createCategory(req, res) {
    try {
        const category = new Category(req.body);
        await category.save();
        await logActivity(req, 'CREATE', 'Category', category._id, { name: category.name });
        return returnResponse(res, SUCCESS.RESOURCES_CREATED, category);
    } catch (error) {
        errorHandler(res, error);
    }
}

// Public: list categories (only active ones unless requested by an admin).
// Nests subcategories under their parent so the response mirrors the
// produits/[category]/[subcategory] hierarchy directly.
async function getCategories(req, res) {
    try {
        const { isAdmin } = req.query;
        const query = isAdmin ? {} : { isActive: true };

        const categories = await Category.find(query).sort({ order: 1, name: 1 }).lean();

        const byId = new Map(categories.map((c) => [String(c._id), { ...c, subcategories: [] }]));
        const roots = [];

        byId.forEach((cat) => {
            if (cat.parentCategory && byId.has(String(cat.parentCategory))) {
                byId.get(String(cat.parentCategory)).subcategories.push(cat);
            } else {
                roots.push(cat);
            }
        });

        return returnResponse(res, SUCCESS.RESOURCES_FOUND, { categories: roots });
    } catch (error) {
        errorHandler(res, error);
    }
}

async function getCategory(req, res) {
    try {
        const { slug } = req.params;
        const category = await Category.findOne({ slug }).populate('parentCategory', 'name slug');

        if (!category) {
            throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'category_not_found' });
        }

        const subcategories = await Category.find({ parentCategory: category._id, isActive: true });

        return returnResponse(res, SUCCESS.RESOURCES_FOUND, { category, subcategories });
    } catch (error) {
        errorHandler(res, error);
    }
}

async function updateCategory(req, res) {
    try {
        const { slug } = req.params;
        const category = await Category.findOneAndUpdate({ slug }, req.body, { new: true, runValidators: true });

        if (!category) {
            throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'category_not_found' });
        }

        await logActivity(req, 'UPDATE', 'Category', category._id, { name: category.name });
        return returnResponse(res, SUCCESS.RESOURCES_UPDATED, category);
    } catch (error) {
        errorHandler(res, error);
    }
}

async function deleteCategory(req, res) {
    try {
        const { slug } = req.params;
        const category = await Category.findOne({ slug });

        if (!category) {
            throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'category_not_found' });
        }

        const childCount = await Category.countDocuments({ parentCategory: category._id });
        if (childCount > 0) {
            throw new CostumeExption('Category has subcategories, reassign or delete them first', ERRORS.CONFLICT.statusCode, ERRORS.CONFLICT.key, { message: 'category_has_children' });
        }

        await category.deleteOne();
        await logActivity(req, 'DELETE', 'Category', category._id, { name: category.name });
        return returnResponse(res, SUCCESS.RESOURCES_DELETED);
    } catch (error) {
        errorHandler(res, error);
    }
}

module.exports = { createCategory, getCategories, getCategory, updateCategory, deleteCategory };
