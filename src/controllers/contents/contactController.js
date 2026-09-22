const ContactSubmission = require("../../models/contactSubmission.model");
const responseHandler = require("../../utils/responseHandler");
const { SUCCESS } = require("../../config/messages");
const { logActivity, logUpdateActivity } = require('../../utils/logger');
const { buildEntityDetails } = require('../../utils/audit');

const submitContactForm = async (req, res, next) => {
  try {
    const submission = await ContactSubmission.create(req.body);
    responseHandler(res, SUCCESS.RESOURCES_CREATED, submission);
  } catch (err) {
    next(err);
  }
};

const getSubmissions = async (req, res, next) => {
  try {
    const submissions = await ContactSubmission.find().sort({ createdAt: -1 });
    responseHandler(res, SUCCESS.RESOURCES_FOUND, submissions);
  } catch (err) {
    next(err);
  }
};

const updateSubmissionStatus = async (req, res, next) => {
  try {
    const before = await ContactSubmission.findById(req.params.id).lean();
    const submission = await ContactSubmission.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true },
    );
    if (!submission) { const error = new Error('Contact submission not found'); error.statusCode = 404; throw error; }
    await logUpdateActivity(req, 'UPDATE', 'ContactSubmission', submission._id, before, submission, `Changed contact submission status for ${submission.name}`);
    responseHandler(res, SUCCESS.RESOURCES_UPDATED, submission);
  } catch (err) {
    next(err);
  }
};

const deleteSubmission = async (req, res, next) => {
  try {
    const deleted = await ContactSubmission.findByIdAndDelete(req.params.id);
    if (!deleted) { const error = new Error('Contact submission not found'); error.statusCode = 404; throw error; }
    await logActivity(req, 'DELETE', 'ContactSubmission', deleted._id, buildEntityDetails('ContactSubmission', deleted, `Deleted contact submission from ${deleted.name}`, { deleted: true }));
    responseHandler(res, SUCCESS.RESOURCES_DELETED, deleted);
  } catch (err) {
    next(err);
  }
};

const deleteManySubmissions = async (req, res, next) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ids must be a non-empty array",
      });
    }

    const submissions = await ContactSubmission.find({ _id: { $in: ids } }).lean();
    const result = await ContactSubmission.deleteMany({ _id: { $in: ids } });
    for (const submission of submissions) {
      await logActivity(req, 'DELETE', 'ContactSubmission', submission._id, buildEntityDetails('ContactSubmission', submission, `Deleted contact submission from ${submission.name}`, { deleted: true }));
    }

    responseHandler(res, SUCCESS.RESOURCES_DELETED, {
      deletedCount: result.deletedCount,
      ids,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  submitContactForm,
  getSubmissions,
  updateSubmissionStatus,
  deleteSubmission,
  deleteManySubmissions,
};
