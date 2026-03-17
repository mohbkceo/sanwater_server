const { ERRORS, SUCCESS } = require('../../config/messages');
const CostumeExption = require('../../utils/CostumeException');
const Product = require('../../models/product.model');
const generateSerialNumber = require('../../utils/serialNumberGenerator');
const errorHandler = require('../../utils/error.middleware');
const { returnResponse } = require('../../utils/responseHandler');

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

        return returnResponse(res, 201, 'Product succesfully created!', product);

    } catch (error) {

       errorHandler(res, error)

    }
}
const escapeRegex = str =>  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
async function getProducts(req, res) {
    try {
        const {search } = req.query;
        let query = {};
         if (typeof search === 'string' && search.trim() ) {
                    const safe = escapeRegex(search)
                    query.$or = [
                        { name: { $regex: safe, $options: 'i' } },
                        { family: { $regex: safe, $options: 'i' } },
                        { productId: { $regex: safe, $options: 'i' } },
                    ] 
            }
    
        const products = await Product.find(query);
        return returnResponse(res, 200, 'Products found!', { products, count: products.length });

    } catch (error) {

        errorHandler(res, error);

    }
}

async function getProduct(req, res) {

    try {

        const { serialNumber } = req.params;

        const product = await Product.findOne({ serialNumber });

        if (!product) {
           throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: `product_not_found` });
        }

        return returnResponse(res, 200, SUCCESS.RESOURCES_FOUND.msg, product)

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
            name
        } = req.body;

        const product = await Product.findOneAndUpdate(
            { serialNumber },
            {family,
                name,
                tags,
                gallery,
                productVariants,
                prices },
            { new: true }
        );

        if (!product) {
            throw new CostumeExption(ERRORS.NOT_FOUND.key, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: `product_not_found` })
        }

        return returnResponse(res, 200, 'Product Updated!', product);

    } catch (error) {

        errorHandler(res, error);

    }

}

async function deleteProduct(req, res) {

    try {

        const { serialNumber } = req.params;

        const product = await Product.findOneAndDelete({ serialNumber });

        if (!product) {
         throw new CostumeExption(ERRORS.NOT_FOUND.key, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: `product_not_found` })

        }

        return returnResponse(res, 200, 'Product Deleted!');

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