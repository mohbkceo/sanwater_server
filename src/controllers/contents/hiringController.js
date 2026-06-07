const Hiring = require('../../models/hiring.model');
const responseHandler = require('../../utils/responseHandler');
const { SUCCESS } = require('../../config/messages');
const { logActivity } = require('../../utils/logger');

const createHiring = async (req, res, next) => {
  try {
    const hiring = await Hiring.create(req.body);
    await logActivity(req, 'CREATE', 'Hiring', hiring._id, { title: hiring.title });
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
    const hiring = await Hiring.findByIdAndUpdate(req.params.id, req.body, { new: true });
    await logActivity(req, 'UPDATE', 'Hiring', hiring._id, { title: hiring.title });
    responseHandler(res, SUCCESS.RESOURCES_UPDATED, hiring);
  } catch (err) {
    next(err);
  }
};

const deleteHiring = async (req, res, next) => {
  try {
    await Hiring.findByIdAndDelete(req.params.id);
    await logActivity(req, 'DELETE', 'Hiring', req.params.id);
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
