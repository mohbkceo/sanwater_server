const Quotation = require('../../models/quotation.model');
const returnResponse = require('../../utils/responseHandler');
const { SUCCESS, ERRORS } = require('../../config/messages');
const CostumeExption = require('../../utils/CostumeException');
const { logUpdateActivity } = require('../../utils/logger');
const { emitBusinessEvent } = require('../../services/analytics/tracking');
const { quote } = require('../../services/shipping.service');

// Public: a customer (consumer, contractor, dealer, ...) requests a quote
// for one or more products. No auth required — this is the storefront
// lead-gen entry point — but it is rate-limited and Joi-validated (see
// routes/quotation.routes.js), and only ever writes the fields on the
// validated payload (status/assignedAdmin/adminNotes are never client-set).
const createQuotation = async (req, res, next) => {
    try {
        const { items, requester, source, delivery } = req.body;
        let finalItems = items;
        let finalRequester = requester;
        let shippingSnapshot = null;
        let pricing = null;
        if (delivery) {
            if (items.length !== 1 || !items[0].product) {
                throw new CostumeExption('Checkout requires exactly one product', 422, 'INVALID_CHECKOUT');
            }
            const calculated = await quote(delivery, items[0].product, items[0].quantity);
            if (calculated.tariffRevision !== delivery.expectedTariffRevision || calculated.unitPrice !== delivery.expectedUnitPrice) {
                throw new CostumeExption('Shipping tariff or product price changed. Request a new quote.', 409, 'STALE_CHECKOUT_QUOTE');
            }
            finalItems = [{
                product: calculated.product,
                productName: calculated.productName,
                productSerialNumber: calculated.productSerialNumber,
                quantity: calculated.quantity,
            }];
            shippingSnapshot = {
                wilayaCode: calculated.wilayaCode, wilayaName: calculated.wilayaName,
                communeCode: calculated.communeCode, communeName: calculated.communeName,
                deliveryType: calculated.deliveryType, address: calculated.address,
                office: calculated.office,
            };
            finalRequester = { ...requester, address: calculated.address };
            pricing = {
                unitPrice: calculated.unitPrice, subtotal: calculated.subtotal,
                shippingFee: calculated.shippingFee, total: calculated.total,
                currency: 'DZD', tariffRevision: calculated.tariffRevision,
                quotedAt: calculated.quotedAt,
            };
        }

        const quotation = await Quotation.create({
            items: finalItems,
            requester: finalRequester,
            source: source || null,
            ...(delivery ? { delivery: shippingSnapshot, pricing } : {}),
            statusHistory: [{ status: 'submitted', changedAt: new Date() }],
        });
        await emitBusinessEvent('quotation_submitted', 'quotation', quotation._id, 'submitted').catch(() => null);

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

        const before = quotation.toObject();
        quotation.status = status;
        quotation.statusHistory.push({
            status,
            changedBy: req.user.uid,
            changedAt: new Date(),
            note: note || null,
        });
        await quotation.save();

        await logUpdateActivity(req, 'UPDATE', 'Quotation', quotation._id, before, quotation, `Changed quotation status to ${status}`);
        const eventName = `quotation_${status}`;
        if (before.status !== status) await emitBusinessEvent(eventName, 'quotation', quotation._id, String(quotation.statusHistory.at(-1)._id), {}, { userId: req.user.uid }).catch(() => null);

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

        const before = await Quotation.findById(id).lean();
        if (!before) throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'quotation_not_found' });
        const quotation = await Quotation.findByIdAndUpdate(
            id,
            { assignedAdmin: assignedAdmin || null },
            { new: true, runValidators: true }
        );

        if (!quotation) {
            throw new CostumeExption(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message: 'quotation_not_found' });
        }

        await logUpdateActivity(req, 'MOVE', 'Quotation', quotation._id, before, quotation, 'Reassigned quotation');
        if (String(before.assignedAdmin || '') !== String(quotation.assignedAdmin || '')) await emitBusinessEvent('quotation_assigned', 'quotation', quotation._id, `${quotation.updatedAt.getTime()}`, {}, { userId: req.user.uid }).catch(() => null);
        return returnResponse(res, SUCCESS.RESOURCES_UPDATED, quotation);
    } catch (err) {
        next(err);
    }
};

module.exports = { createQuotation, getQuotations, getQuotationById, updateQuotationStatus, assignQuotation };
