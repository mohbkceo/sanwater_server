const mongoose = require('mongoose')

const VariantValue  = new mongoose.Schema({
    variantData: {type: String},
})
const ProductVariants = new mongoose.Schema({
    variantType: {type: String, default: 'color'},
    variants : { 
        type: [VariantValue],
        default: []
    }
})

const productSchema = new mongoose.Schema({
    author: {type: String, required: true},
    name: {type: String, default: null},
    productId: {type: String, required: true},
    family: {type: String, default: "NO-FAMILLY"},
    serialNumber: {type: String, unique: true, required: true},
    isActive: {type: Boolean, default: true},
    tags: { type: [String], default: [] },
    gallery: { type: [String], default: [] },
    productVariants: {
        type: [ProductVariants],
        default: []
    },
    prices: {
        productPrice: {type: Number, default: 1509, min: 0},
        shippingPrice: {type: Number, default: 800, min: 0},
    }
    
}, {timestamps: true})

module.exports = mongoose.model('ProductSchema', productSchema)