const mongoose = require('mongoose');
const { ERRORS, SUCCESS } = require('../../config/messages');
const Family = require('../../models/family.model');
const SubFamily = require('../../models/subFamily.model');
const Product = require('../../models/product.model');
const User = require('../../models/user.model');
const CostumeException = require('../../utils/CostumeException');
const errorHandler = require('../../utils/error.middleware');
const { logActivity } = require('../../utils/logger');
const { comparePassword } = require('../../utils/Password');
const returnResponse = require('../../utils/responseHandler');
const { getFamilyTree } = require('../../services/taxonomy.service');

function notFound(message) {
  return new CostumeException(ERRORS.NOT_FOUND.msg, ERRORS.NOT_FOUND.statusCode, ERRORS.NOT_FOUND.key, { message });
}

async function verifyCurrentPassword(req) {
  const user = await User.findById(req.user.uid).select('+password');
  if (!user || !(await comparePassword(req.body.password || '', user.password))) {
    throw new CostumeException('Current password is incorrect', ERRORS.UNAUTHORIZED.statusCode, ERRORS.UNAUTHORIZED.key);
  }
}

function actorFields(req, creating = false) {
  return creating
    ? { createdBy: req.user.uid, updatedBy: req.user.uid }
    : { updatedBy: req.user.uid };
}

async function getFamilies(req, res) {
  try {
    const families = await getFamilyTree({ admin: Boolean(req.catalogAdmin) });
    return returnResponse(res, SUCCESS.RESOURCES_FOUND, { families });
  } catch (error) { return errorHandler(res, error); }
}

async function getFamily(req, res) {
  try {
    const families = await getFamilyTree({ slug: req.params.slug });
    if (!families[0]) throw notFound('family_not_found');
    return returnResponse(res, SUCCESS.RESOURCES_FOUND, { family: families[0] });
  } catch (error) { return errorHandler(res, error); }
}

async function createFamily(req, res) {
  try {
    const family = await Family.create({ ...req.body, ...actorFields(req, true) });
    await logActivity(req, 'CREATE FAMILY', 'Family', family._id, { familyId: family._id, familyName: family.name });
    return returnResponse(res, SUCCESS.RESOURCES_CREATED, { family });
  } catch (error) { return errorHandler(res, error); }
}

async function updateFamily(req, res) {
  try {
    const family = await Family.findByIdAndUpdate(
      req.params.id,
      { ...req.body, ...actorFields(req) },
      { new: true, runValidators: true },
    );
    if (!family) throw notFound('family_not_found');
    await logActivity(req, 'UPDATE FAMILY', 'Family', family._id, { familyId: family._id, familyName: family.name });
    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, { family });
  } catch (error) { return errorHandler(res, error); }
}

async function deleteFamily(req, res) {
  try {
    await verifyCurrentPassword(req);
    const family = await Family.findById(req.params.id);
    if (!family) throw notFound('family_not_found');
    const [subFamilyCount, productCount] = await Promise.all([
      SubFamily.countDocuments({ family: family._id }),
      Product.countDocuments({ family: family._id }),
    ]);
    if (subFamilyCount || productCount) {
      throw new CostumeException(
        'Move or delete all Sub Families before deleting this Family.',
        ERRORS.CONFLICT.statusCode,
        ERRORS.CONFLICT.key,
        { subFamilyCount, productCount },
      );
    }
    await family.deleteOne();
    await logActivity(req, 'DELETE FAMILY', 'Family', family._id, {
      familyId: family._id, familyName: family.name, affectedProductCount: 0,
    });
    return returnResponse(res, SUCCESS.RESOURCES_DELETED);
  } catch (error) { return errorHandler(res, error); }
}

async function createSubFamily(req, res) {
  try {
    const family = await Family.findById(req.params.familyId);
    if (!family) throw notFound('family_not_found');
    const subFamily = await SubFamily.create({
      ...req.body,
      family: family._id,
      ...actorFields(req, true),
    });
    await logActivity(req, 'CREATE SUB_FAMILY', 'SubFamily', subFamily._id, {
      familyId: family._id, familyName: family.name,
      subFamilyId: subFamily._id, subFamilyName: subFamily.name,
    });
    return returnResponse(res, SUCCESS.RESOURCES_CREATED, { subFamily });
  } catch (error) { return errorHandler(res, error); }
}

async function updateSubFamily(req, res) {
  try {
    const subFamily = await SubFamily.findByIdAndUpdate(
      req.params.id,
      { ...req.body, ...actorFields(req) },
      { new: true, runValidators: true },
    ).populate('family', 'name');
    if (!subFamily) throw notFound('sub_family_not_found');
    await logActivity(req, 'UPDATE SUB_FAMILY', 'SubFamily', subFamily._id, {
      familyId: subFamily.family._id, familyName: subFamily.family.name,
      subFamilyId: subFamily._id, subFamilyName: subFamily.name,
    });
    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, { subFamily });
  } catch (error) { return errorHandler(res, error); }
}

async function moveAndDeleteWithFallback(source, target) {
  const movedIds = await Product.find({ subFamily: source._id }).distinct('_id');
  const result = await Product.updateMany(
    { _id: { $in: movedIds }, subFamily: source._id },
    { $set: { subFamily: target._id, family: target.family } },
  );
  try {
    await source.deleteOne();
    return result.modifiedCount;
  } catch (error) {
    await Product.updateMany(
      { _id: { $in: movedIds }, subFamily: target._id },
      { $set: { subFamily: source._id, family: source.family._id || source.family } },
    );
    throw error;
  }
}

async function deleteSubFamily(req, res) {
  try {
    await verifyCurrentPassword(req);
    const source = await SubFamily.findById(req.params.id).populate('family', 'name');
    if (!source) throw notFound('sub_family_not_found');
    const affectedProductCount = await Product.countDocuments({ subFamily: source._id });
    let target = null;

    if (affectedProductCount) {
      if (!mongoose.isValidObjectId(req.body.replacementSubFamilyId)) {
        throw new CostumeException('A replacement Sub Family is required.', ERRORS.CONFLICT.statusCode, ERRORS.CONFLICT.key);
      }
      target = await SubFamily.findById(req.body.replacementSubFamilyId);
      if (!target) throw notFound('replacement_sub_family_not_found');
      if (String(target._id) === String(source._id)) {
        throw new CostumeException('Replacement Sub Family must be different.', ERRORS.INVALID.statusCode, ERRORS.INVALID.key);
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await Product.updateMany(
            { subFamily: source._id },
            { $set: { subFamily: target._id, family: target.family } },
            { session },
          );
          await SubFamily.deleteOne({ _id: source._id }, { session });
        });
      } catch (error) {
        const unsupported = /Transaction numbers|replica set|mongos/i.test(error.message || '');
        if (!unsupported) throw error;
        await moveAndDeleteWithFallback(source, target);
      } finally {
        await session.endSession();
      }
      await logActivity(req, 'MOVE PRODUCTS BETWEEN SUB_FAMILIES', 'SubFamily', source._id, {
        familyId: target.family, subFamilyId: target._id, subFamilyName: target.name, affectedProductCount,
      });
    } else {
      await source.deleteOne();
    }

    await logActivity(req, 'DELETE SUB_FAMILY', 'SubFamily', source._id, {
      familyId: source.family._id, familyName: source.family.name,
      subFamilyId: source._id, subFamilyName: source.name, affectedProductCount,
    });
    return returnResponse(res, SUCCESS.RESOURCES_DELETED, { affectedProductCount });
  } catch (error) { return errorHandler(res, error); }
}

module.exports = {
  createFamily, createSubFamily, deleteFamily, deleteSubFamily,
  getFamilies, getFamily, updateFamily, updateSubFamily,
};
