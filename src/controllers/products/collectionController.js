const { ERRORS, SUCCESS } = require('../../config/messages');
const CostumeExption = require('../../utils/CostumeException');
const errorHandler = require('../../utils/error.middleware');
const returnResponse = require('../../utils/responseHandler');
const Collection = require('../../models/collection.model');
const Product = require('../../models/product.model');
const { logActivity } = require('../../utils/logger');

async function createCollection(req, res) {
    try {
        const collection = new Collection(req.body);
        await collection.save();
        await logActivity(req, 'CREATE', 'Collection', collection._id, { name: collection.name });
        return returnResponse(res, SUCCESS.RESOURCES_CREATED, collection);
    } catch (error) {
        errorHandler(res, error);
    }
}

async function getCollections(req, res) {
    try {
        const { isAdmin } = req.query;
        const query = isAdmin ? {} : { isActive: true };

        const collections = await Collection.find(query).sort({ name: 1 }).lean();
        return returnResponse(res, SUCCESS.RESOURCES_FOUND, { collections });
    } catch (error) {
        errorHandler(res, error);
    }
}

async function getCollection(req, res) {
    try {
        const { slug } = req.params;
        const collection = await Collection.findOne({ slug }).populate('featuredProducts', 'name slug productId gallery');

        if (!collection) {
            throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'collection_not_found' });
        }

        const products = await Product.find({ collectionRef: collection._id, isActive: true }).lean();

        return returnResponse(res, SUCCESS.RESOURCES_FOUND, { collection, products });
    } catch (error) {
        errorHandler(res, error);
    }
}

async function updateCollection(req, res) {
    try {
        const { slug } = req.params;
        const collection = await Collection.findOneAndUpdate({ slug }, req.body, { new: true, runValidators: true });

        if (!collection) {
            throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'collection_not_found' });
        }

        await logActivity(req, 'UPDATE', 'Collection', collection._id, { name: collection.name });
        return returnResponse(res, SUCCESS.RESOURCES_UPDATED, collection);
    } catch (error) {
        errorHandler(res, error);
    }
}

async function deleteCollection(req, res) {
    try {
        const { slug } = req.params;
        const collection = await Collection.findOne({ slug });

        if (!collection) {
            throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'collection_not_found' });
        }

        await collection.deleteOne();
        await logActivity(req, 'DELETE', 'Collection', collection._id, { name: collection.name });
        return returnResponse(res, SUCCESS.RESOURCES_DELETED);
    } catch (error) {
        errorHandler(res, error);
    }
}

module.exports = { createCollection, getCollections, getCollection, updateCollection, deleteCollection };
