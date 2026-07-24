const ContactSubmission = require("../../models/contactSubmission.model");
const responseHandler = require("../../utils/responseHandler");
const { SUCCESS } = require("../../config/messages");

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
    const submission = await ContactSubmission.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true },
    );
    responseHandler(res, SUCCESS.RESOURCES_UPDATED, submission);
  } catch (err) {
    next(err);
  }
};

const deleteSubmission = async (req, res, next) => {
  try {
    const deleted = await ContactSubmission.findByIdAndDelete(req.params.id);
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

    const result = await ContactSubmission.deleteMany({ _id: { $in: ids } });

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
