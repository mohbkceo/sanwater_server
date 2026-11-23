const ContactSubmission = require("../../models/contactSubmission.model");
const responseHandler = require("../../utils/responseHandler");
const { SUCCESS } = require("../../config/messages");
const { logActivity, logUpdateActivity } = require('../../utils/logger');
const { buildEntityDetails } = require('../../utils/audit');
const mongoose = require('mongoose');
const statuses = ['pending','read','archived'];
const validId = value => mongoose.isValidObjectId(value);

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
    if (req.query.paged !== 'true') {
      const submissions = await ContactSubmission.find().sort({ createdAt: -1 });
      return responseHandler(res, SUCCESS.RESOURCES_FOUND, submissions);
    }
    const page = Math.max(1, Math.min(10000, parseInt(req.query.page,10)||1));
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit,10)||20));
    const filter = {};
    if (req.query.status) {
      if (!statuses.includes(req.query.status)) return res.status(400).json({success:false,message:'Invalid status'});
      filter.status = req.query.status;
    }
    const search = String(req.query.search || '').trim().slice(0,100);
    if (search) { const literal={ $regex:search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i' };filter.$or=['name','email','subject','message'].map(key=>({[key]:literal})); }
    const [records,total] = await Promise.all([ContactSubmission.find(filter).select('name email subject message status createdAt').sort({createdAt:-1}).skip((page-1)*limit).limit(limit).lean(),ContactSubmission.countDocuments(filter)]);
    const rows = records.map(({message,...row})=>({...row,preview:String(message||'').slice(0,180)}));
    return responseHandler(res, SUCCESS.RESOURCES_FOUND, {rows,total,page,limit});
  } catch (err) {
    next(err);
  }
};

const updateSubmissionStatus = async (req, res, next) => {
  try {
    if (!validId(req.params.id) || !statuses.includes(req.body.status)) return res.status(400).json({success:false,message:'Invalid submission or status'});
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
    if (!validId(req.params.id)) return res.status(400).json({success:false,message:'Invalid submission'});
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

    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || ids.some(id=>!validId(id))) {
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
module.exports.getSubmission = async (req,res,next)=>{
  try {
    if(!validId(req.params.id))return res.status(400).json({success:false,message:'Invalid submission'});
    const row=await ContactSubmission.findById(req.params.id).select('name email subject message status createdAt').lean();
    if(!row)return res.status(404).json({success:false,message:'Submission not found'});
    return responseHandler(res,SUCCESS.RESOURCES_FOUND,row);
  }catch(error){next(error);}
};
