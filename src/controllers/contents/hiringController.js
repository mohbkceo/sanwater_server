const Hiring = require('../../models/hiring.model');
const responseHandler = require('../../utils/responseHandler');
const { SUCCESS } = require('../../config/messages');
const { logActivity, logUpdateActivity } = require('../../utils/logger');
const { buildEntityDetails } = require('../../utils/audit');

const createHiring = async (req, res, next) => {
  try {
    const hiring = await Hiring.create(req.body);
    await logActivity(req, 'CREATE', 'Hiring', hiring._id, buildEntityDetails('Hiring', hiring, `Created job posting ${hiring.title}`));
    responseHandler(res, SUCCESS.RESOURCES_CREATED, hiring);
  } catch (err) {
    next(err);
  }
};

const getHiringList = async (req, res, next) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    const hiring = await Hiring.find(query).sort({ publishDate: -1 });
    responseHandler(res, SUCCESS.RESOURCES_FOUND, hiring);
  } catch (err) {
    next(err);
  }
};

const getHiringById = async (req, res, next) => {
  try {
    const hiring = await Hiring.findById(req.params.id);
    responseHandler(res, SUCCESS.RESOURCES_FOUND, hiring);
  } catch (err) {
    next(err);
  }
};

const updateHiring = async (req, res, next) => {
  try {
    const before = await Hiring.findById(req.params.id).lean();
    const hiring = await Hiring.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!hiring) { const error = new Error('Hiring record not found'); error.statusCode = 404; throw error; }
    await logUpdateActivity(req, 'UPDATE', 'Hiring', hiring._id, before, hiring, `Updated job posting ${hiring.title}`);
    responseHandler(res, SUCCESS.RESOURCES_UPDATED, hiring);
  } catch (err) {
    next(err);
  }
};

const deleteHiring = async (req, res, next) => {
  try {
    const hiring = await Hiring.findByIdAndDelete(req.params.id);
    if (!hiring) { const error = new Error('Hiring record not found'); error.statusCode = 404; throw error; }
    await logActivity(req, 'DELETE', 'Hiring', hiring._id, buildEntityDetails('Hiring', hiring, `Deleted job posting ${hiring.title}`, { deleted: true }));
    responseHandler(res, SUCCESS.RESOURCES_DELETED);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createHiring,
  getHiringList,
  getHiringById,
  updateHiring,
  deleteHiring
};
