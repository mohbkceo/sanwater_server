const Joi = require('joi');
const { QUOTATION_STATUSES, CUSTOMER_TYPES } = require('../../../models/quotation.model');

const quotationItemSchema = Joi.object({
    product: Joi.string().allow(null, '').optional(),
    productName: Joi.string().required().trim().max(150),
    productSerialNumber: Joi.string().allow(null, '').trim(),
    quantity: Joi.number().integer().min(1).default(1),
    note: Joi.string().allow(null, '').trim().max(500),
});

// Public submission payload — this is the only thing an unauthenticated
// caller can set. status/statusHistory/assignedAdmin/adminNotes are always
// server-controlled.
const createQuotationSchema = Joi.object({
    items: Joi.array().items(quotationItemSchema).min(1).max(50).required(),
    requester: Joi.object({
        fullName: Joi.string().required().trim().min(2).max(100),
        email: Joi.string().allow(null, '').trim().email(),
        phone: Joi.string().required().trim().max(30),
        address: Joi.string().allow(null, '').trim().max(300),
        company: Joi.string().allow(null, '').trim().max(150),
        customerType: Joi.string().valid(...CUSTOMER_TYPES).default('consumer'),
        notes: Joi.string().allow(null, '').trim().max(1000),
    }).required(),
    source: Joi.string().allow(null, '').trim().max(100),
});

const updateQuotationStatusSchema = Joi.object({
    status: Joi.string().valid(...QUOTATION_STATUSES).required(),
    note: Joi.string().allow(null, '').trim().max(500),
});

module.exports = { createQuotationSchema, updateQuotationStatusSchema };
