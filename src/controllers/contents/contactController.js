const ContactSubmission = require('../../models/contactSubmission.model');
const responseHandler = require('../../utils/responseHandler');
const { SUCCESS } = require('../../config/messages');

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
    const submission = await ContactSubmission.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    responseHandler(res, SUCCESS.RESOURCES_UPDATED, submission);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  submitContactForm,
  getSubmissions,
  updateSubmissionStatus
};
