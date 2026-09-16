const { ERRORS, SUCCESS } = require('../../config/messages');
const FamilyConfig = require('../../models/familyConfig.model');
const CostumeExption = require('../../utils/CostumeException');
const errorHandler = require('../../utils/error.middleware');
const { logActivity } = require('../../utils/logger');
const returnResponse = require('../../utils/responseHandler');
const {
  discoverFamilies,
  normalizeFamilyKey,
  normalizeSubFamilyKey,
} = require('../../services/catalogFamily.service');

async function getFamilies(req, res) {
  try {
    const families = await discoverFamilies({ isAdmin: Boolean(req.catalogAdmin) });
    return returnResponse(res, SUCCESS.RESOURCES_FOUND, { families });
  } catch (error) {
    return errorHandler(res, error);
  }
}

async function getFamily(req, res) {
  try {
    const familyKey = normalizeFamilyKey(req.params.familyKey);
    const families = await discoverFamilies({ familyKey });
    const family = families.find((entry) => entry.key === familyKey);

    if (!family) {
      throw new CostumeExption(
        ERRORS.NOT_FOUND.msg,
        ERRORS.NOT_FOUND.statusCode,
        ERRORS.NOT_FOUND.key,
        { message: 'family_not_found' },
      );
    }

    return returnResponse(res, SUCCESS.RESOURCES_FOUND, { family });
  } catch (error) {
    return errorHandler(res, error);
  }
}

async function updateFamilyConfig(req, res) {
  try {
    const familyKey = normalizeFamilyKey(req.params.familyKey);
    const config = await FamilyConfig.findOneAndUpdate(
      { familyKey },
      { $set: { ...req.body, familyKey } },
      { new: true, runValidators: true, setDefaultsOnInsert: true, upsert: true },
    );

    await logActivity(req, 'UPDATE', 'FamilyConfig', config._id, { familyKey });
    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, { config });
  } catch (error) {
    return errorHandler(res, error);
  }
}

async function updateSubFamilyConfig(req, res) {
  try {
    const familyKey = normalizeFamilyKey(req.params.familyKey);
    const subFamilyKey = normalizeSubFamilyKey(req.params.subFamilyKey);

    let config = await FamilyConfig.findOne({ familyKey });
    if (!config) {
      config = new FamilyConfig({ familyKey, displayName: familyKey });
    }

    const existing = config.subFamilies.find((entry) => entry.key === subFamilyKey);
    if (existing) {
      Object.assign(existing, req.body, { key: subFamilyKey });
    } else {
      config.subFamilies.push({ ...req.body, key: subFamilyKey });
    }

    await config.save();
    await logActivity(req, 'UPDATE', 'SubFamilyConfig', config._id, {
      familyKey,
      subFamilyKey,
    });

    return returnResponse(res, SUCCESS.RESOURCES_UPDATED, { config });
  } catch (error) {
    return errorHandler(res, error);
  }
}

module.exports = {
  getFamilies,
  getFamily,
  updateFamilyConfig,
  updateSubFamilyConfig,
};
