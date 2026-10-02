const mongoose = require('mongoose');
const Joi = require('joi');
const Application = require('../../models/application.model');
const User = require('../../models/user.model');
const Hiring = require('../../models/hiring.model');
const AnalyticsSession = require('../../models/analyticsSession.model');
const { SESSION_COOKIE, unsign, emitBusinessEvent } = require('../../services/analytics/tracking');
const { logActivity } = require('../../utils/logger');

const submissionSchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().email().max(254).required(),
  phone: Joi.string().trim().max(30).allow('', null),
  message: Joi.string().trim().max(3000).allow('', null),
}).unknown(false);
async function submit(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(400);
    const { value, error } = submissionSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: 'Invalid application' });
    const position = await Hiring.findOne({ _id: req.params.id, status: 'published' }).select('_id');
    if (!position) return res.sendStatus(404);
    const sessionId = unsign(req.cookies?.[SESSION_COOKIE]);
    const session = sessionId ? await AnalyticsSession.findOne({ sessionId }).lean() : null;
    const application = await Application.create({
      hiringId: position._id, candidate: { fullName: value.fullName, email: value.email, phone: value.phone || null },
      message: value.message || null, stageHistory: [{ stage: 'applied' }],
      source: session?.acquisition?.source || null, medium: session?.acquisition?.medium || null, campaign: session?.acquisition?.campaign || null,
      visitorId: session?.visitorId || null, sessionId: session?.sessionId || null,
    });
    await emitBusinessEvent('application_submitted', 'application', application._id, 'created', { hiringId: String(position._id) }, { visitorId: application.visitorId, sessionId: application.sessionId }).catch(() => null);
    return res.status(201).json({ success: true, data: { id: application._id, stage: application.stage } });
  } catch (error) { next(error); }
}
async function list(req, res, next) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const query = {};
    if (req.query.stage && Application.STAGES.includes(req.query.stage)) query.stage = req.query.stage;
    if (req.query.hiringId && mongoose.isValidObjectId(req.query.hiringId)) query.hiringId = req.query.hiringId;
    const [rows, total] = await Promise.all([
      Application.find(query).select('-notes -stageHistory').populate('hiringId', 'title').populate('assignedTo', 'fullName').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Application.countDocuments(query),
    ]);
    return res.json({ success: true, data: { rows, total, page, limit } });
  } catch (error) { next(error); }
}
async function detail(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(400);
    const row = await Application.findById(req.params.id).populate('hiringId', 'title').populate('assignedTo stageHistory.changedBy notes.author', 'fullName');
    return row ? res.json({ success: true, data: row }) : res.sendStatus(404);
  } catch (error) { next(error); }
}
async function assignees(req, res, next) {
  try {
    const rows = await User.find({ role: { $in: ['admin', 'super_admin'] } }).select('fullName').sort({ fullName: 1 }).lean();
    return res.json({ success: true, data: rows });
  } catch (error) { next(error); }
}
async function update(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.sendStatus(400);
    const { stage, assignedTo, note } = req.body || {};
    if (stage !== undefined && !Application.STAGES.includes(stage)) return res.sendStatus(400);
    if (assignedTo !== undefined && assignedTo !== null && !mongoose.isValidObjectId(assignedTo)) return res.sendStatus(400);
    if (note !== undefined && (typeof note !== 'string' || !note.trim() || note.length > 4000)) return res.sendStatus(400);
    const row = await Application.findById(req.params.id);
    if (!row) return res.sendStatus(404);
    const before = { stage: row.stage, assignedTo: String(row.assignedTo || ''), noteCount: row.notes.length };
    const stageChanged = stage && stage !== row.stage;
    if (stageChanged) { row.stage = stage; row.stageHistory.push({ stage, changedBy: req.user.uid }); }
    if (assignedTo !== undefined) row.assignedTo = assignedTo || null;
    if (note) row.notes.push({ content: note.trim(), author: req.user.uid });
    await row.save();
    const changes = [];
    if (stageChanged) changes.push({ field: 'stage', label: 'Stage', before: before.stage, after: row.stage });
    if (assignedTo !== undefined && String(row.assignedTo || '') !== before.assignedTo) changes.push({ field: 'assignedTo', label: 'Assignee', before: before.assignedTo || null, after: String(row.assignedTo || '') || null });
    if (note) changes.push({ field: 'notes', label: 'Notes', before: before.noteCount, after: row.notes.length });
    await logActivity(req, 'UPDATE', 'Application', row._id, { summary: `Updated application for ${row.candidate.fullName}`, entity: { id: row._id, name: row.candidate.fullName }, changedFields: changes.map(change => change.field), changes });
    if (stageChanged) await emitBusinessEvent('application_stage_changed', 'application', row._id, String(row.stageHistory.at(-1)._id), { stage }, { userId: req.user.uid }).catch(() => null);
    return res.json({ success: true, data: row });
  } catch (error) { next(error); }
}
module.exports = { submit, list, detail, assignees, update };
