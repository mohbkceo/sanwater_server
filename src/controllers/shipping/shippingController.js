const ShippingConfig = require('../../models/shippingConfig.model');
const { quoteQuery, code } = require('../../middlewares/validators/schemas/shippingValidator');
const { quote, validateWilayas } = require('../../services/shipping.service');
const { logUpdateActivity } = require('../../utils/logger');
const { SUCCESS } = require('../../config/messages');
const returnResponse = require('../../utils/responseHandler');
const CostumeException = require('../../utils/CostumeException');

const invalid = message => new CostumeException(message, 422, 'INVALID_SHIPPING');
const config = async () => (await ShippingConfig.findById('noest').lean()) || { revision: 0, wilayas: [] };
const send = (res, data) => returnResponse(res, SUCCESS.RESOURCES_FOUND, data);
const validateCode = value => {
  const result = code.required().validate(value);
  if (result.error) throw invalid(result.error.message);
  return result.value;
};

async function wilayas(req, res, next) {
  try {
    const current = await config();
    send(res, current.wilayas.map(({ code, name }) => ({ code, name })));
  } catch (error) { next(error); }
}
async function communes(req, res, next) {
  try {
    const current = await config();
    const wilaya = current.wilayas.find(item => item.code === validateCode(req.params.wilayaCode));
    if (!wilaya) throw invalid('Unsupported wilaya');
    send(res, wilaya.communes.map(item => ({
      code: item.code, name: item.name,
      homeAvailable: wilaya.homeEnabled && item.homeEnabled && (item.homePrice ?? wilaya.homePrice) != null,
      stopDeskAvailable: wilaya.stopDeskEnabled && item.stopDeskEnabled && (item.stopDeskPrice ?? wilaya.stopDeskPrice) != null && item.offices.some(office => office.enabled),
    })));
  } catch (error) { next(error); }
}
async function offices(req, res, next) {
  try {
    const current = await config();
    const wilaya = current.wilayas.find(item => item.code === validateCode(req.params.wilayaCode));
    const commune = wilaya?.communes.find(item => item.code === validateCode(req.params.communeCode));
    if (!commune) throw invalid('Unsupported commune for wilaya');
    send(res, wilaya.stopDeskEnabled && commune.stopDeskEnabled && (commune.stopDeskPrice ?? wilaya.stopDeskPrice) != null
      ? commune.offices.filter(item => item.enabled).map(({ code, name, address }) => ({ code, name, address })) : []);
  } catch (error) { next(error); }
}
async function getQuote(req, res, next) {
  try {
    const { error, value } = quoteQuery.validate(req.query, { abortEarly: false });
    if (error) throw invalid(error.message);
    send(res, await quote(value, value.product, value.quantity));
  } catch (error) { next(error); }
}
async function adminList(req, res, next) {
  try { send(res, await config()); } catch (error) { next(error); }
}
async function save(req, res, next) {
  try {
    const before = await config();
    if (before.revision !== req.body.revision) throw new CostumeException('Tariffs changed. Reload before saving.', 409, 'STALE_TARIFF');
    const incoming = req.body.wilayas || [req.body.wilaya];
    const merged = [...before.wilayas];
    for (const entry of incoming) {
      const index = merged.findIndex(item => item.code === entry.code);
      if (index < 0) merged.push(entry);
      else merged[index] = entry;
    }
    validateWilayas(merged);
    if (req.body.dryRun) return send(res, { revision: before.revision, wilayas: merged });
    const updated = await ShippingConfig.findOneAndUpdate(
      { _id: 'noest', revision: before.revision },
      { $set: { wilayas: merged }, $inc: { revision: 1 } },
      { new: true, upsert: before.revision === 0 && !before._id, runValidators: true },
    ).lean();
    if (!updated) throw new CostumeException('Tariffs changed. Reload before saving.', 409, 'STALE_TARIFF');
    await logUpdateActivity(req, 'UPDATE', 'ShippingTariffs', 'noest', before, updated, `Updated ${incoming.length} shipping tariff record(s)`);
    send(res, updated);
  } catch (error) {
    if (error.code === 11000) return next(new CostumeException('Tariffs changed. Reload before saving.', 409, 'STALE_TARIFF'));
    next(error);
  }
}

module.exports = { wilayas, communes, offices, getQuote, adminList, save };
