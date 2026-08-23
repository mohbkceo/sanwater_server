const Quotation = require('../../models/quotation.model');
const returnResponse = require('../../utils/responseHandler');
const { SUCCESS, ERRORS } = require('../../config/messages');
const CostumeExption = require('../../utils/CostumeException');
const { logActivity } = require('../../utils/logger');

// Public: a customer (consumer, contractor, dealer, ...) requests a quote
// for one or more products. No auth required — this is the storefront
// lead-gen entry point — but it is rate-limited and Joi-validated (see
// routes/quotation.routes.js), and only ever writes the fields on the
// validated payload (status/assignedAdmin/adminNotes are never client-set).
const createQuotation = async (req, res, next) => {
    try {
        const { items, requester, source } = req.body;

        const quotation = await Quotation.create({
            items,
            requester,
            source: source || null,
            statusHistory: [{ status: 'submitted', changedAt: new Date() }],
        });

        return returnResponse(res, SUCCESS.RESOURCES_CREATED, {
            id: quotation._id,
            status: quotation.status,
        });
    } catch (err) {
        next(err);
    }
};

// Admin: list/filter quotations.
const getQuotations = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, status, customerType } = req.query;
        const query = {};
        if (status) query.status = status;
        if (customerType) query['requester.customerType'] = customerType;

        const quotations = await Quotation.find(query)
            .populate('assignedAdmin', 'fullName email')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .exec();

        const count = await Quotation.countDocuments(query);

        return returnResponse(res, SUCCESS.RESOURCES_FOUND, {
            quotations,
            totalPages: Math.ceil(count / limit),
            currentPage: Number(page),
            totalItems: count,
        });
    } catch (err) {
        next(err);
    }
};

const getQuotationById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const quotation = await Quotation.findById(id)
            .populate('assignedAdmin', 'fullName email')
            .populate('statusHistory.changedBy', 'fullName email');

        if (!quotation) {
            throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'quotation_not_found' });
        }

        return returnResponse(res, SUCCESS.RESOURCES_FOUND, quotation);
    } catch (err) {
        next(err);
    }
};

// Admin: move a quotation through the status pipeline. No hard-delete
// endpoint by design — 'closed' is the terminal state instead, so a
// quotation record (and its audit trail) is never silently lost.
const updateQuotationStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, note } = req.body;

        const quotation = await Quotation.findById(id);
        if (!quotation) {
            throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'quotation_not_found' });
        }

        quotation.status = status;
        quotation.statusHistory.push({
            status,
            changedBy: req.user.uid,
            changedAt: new Date(),
            note: note || null,
        });
        await quotation.save();

        await logActivity(req, 'UPDATE_STATUS', 'Quotation', quotation._id, { newStatus: status });

        return returnResponse(res, SUCCESS.RESOURCES_UPDATED, quotation);
    } catch (err) {
        next(err);
    }
};

// Admin: claim/reassign a quotation.
const assignQuotation = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { assignedAdmin } = req.body;

        const quotation = await Quotation.findByIdAndUpdate(
            id,
            { assignedAdmin: assignedAdmin || null },
            { new: true, runValidators: true }
        );

        if (!quotation) {
            throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'quotation_not_found' });
        }

        await logActivity(req, 'UPDATE', 'Quotation', quotation._id, { assignedAdmin });
        return returnResponse(res, SUCCESS.RESOURCES_UPDATED, quotation);
    } catch (err) {
        next(err);
    }
};

module.exports = { createQuotation, getQuotations, getQuotationById, updateQuotationStatus, assignQuotation };
