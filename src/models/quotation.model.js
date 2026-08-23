const mongoose = require('mongoose');

// B2B quotation request (RFQ). Replaces the old order.model.js, which was
// a single-item COD-style order that was never actually wired to a route
// (0 documents in prod) and didn't fit the quote-pipeline the business
// actually needs — company info, multiple line items, a status pipeline.

const QuotationItem = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductSchema', default: null },
    // Denormalized snapshot so a quotation stays meaningful even if the
    // product is later renamed, archived, or deleted.
    productName: { type: String, required: true, trim: true },
    productSerialNumber: { type: String, trim: true, default: null },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    note: { type: String, trim: true, default: null },
}, { _id: false });

const StatusHistoryEntry = new mongoose.Schema({
    status: { type: String, required: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    changedAt: { type: Date, default: Date.now },
    note: { type: String, trim: true, default: null },
}, { _id: false });

const QUOTATION_STATUSES = ['submitted', 'under_review', 'quoted', 'negotiation', 'approved', 'rejected', 'closed'];
const CUSTOMER_TYPES = ['consumer', 'contractor', 'architect', 'designer', 'dealer', 'distributor', 'business'];

const quotationSchema = new mongoose.Schema({
    items: {
        type: [QuotationItem],
        validate: {
            validator: (v) => Array.isArray(v) && v.length > 0,
            message: 'A quotation needs at least one item',
        },
    },

    requester: {
        fullName: { type: String, required: true, trim: true },
        // Not every entry point collects an email (e.g. the direct
        // "place order" landing page only asks for name/phone/address) —
        // phone is the one contact detail we always require.
        email: { type: String, trim: true, lowercase: true, default: null },
        phone: { type: String, required: true, trim: true },
        address: { type: String, trim: true, default: null },
        company: { type: String, trim: true, default: null },
        customerType: { type: String, enum: CUSTOMER_TYPES, default: 'consumer' },
        notes: { type: String, trim: true, default: null },
    },

    status: { type: String, enum: QUOTATION_STATUSES, default: 'submitted' },
    statusHistory: { type: [StatusHistoryEntry], default: [] },

    assignedAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Internal-only — every read endpoint that serves this model is
    // admin-gated (there is no public GET), so this never needs redacting.
    adminNotes: { type: String, trim: true, default: null },

    // Where the request came from (e.g. 'product_detail_page'), for basic
    // conversion attribution later — not user-facing.
    source: { type: String, trim: true, default: null },
}, { timestamps: true });

quotationSchema.index({ status: 1, createdAt: -1 });
quotationSchema.index({ 'requester.email': 1 });

module.exports = mongoose.model('Quotation', quotationSchema);
module.exports.QUOTATION_STATUSES = QUOTATION_STATUSES;
module.exports.CUSTOMER_TYPES = CUSTOMER_TYPES;
