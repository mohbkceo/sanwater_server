const Joi = require('joi');
const code = Joi.string().trim().min(1).max(30).pattern(/^[\p{L}\p{N}._-]+$/u);
const label = Joi.string().trim().min(1).max(150);
const price = Joi.number().min(0).precision(2).allow(null);

const office = Joi.object({
  code: code.required(), name: label.required(), address: Joi.string().trim().max(300).allow('').default(''),
  enabled: Joi.boolean().required(),
});
const commune = Joi.object({
  code: code.required(), name: label.required(), homePrice: price.required(), stopDeskPrice: price.required(),
  homeEnabled: Joi.boolean().required(), stopDeskEnabled: Joi.boolean().required(),
  offices: Joi.array().items(office).required(),
});
const wilaya = Joi.object({
  code: code.required(), name: label.required(), homePrice: price.required(), stopDeskPrice: price.required(),
  homeEnabled: Joi.boolean().required(), stopDeskEnabled: Joi.boolean().required(),
  communes: Joi.array().items(commune).required(),
});
const destination = {
  wilayaCode: code.required(), communeCode: code.required(),
  deliveryType: Joi.string().valid('home', 'stopDesk').required(),
  officeCode: code.when('deliveryType', { is: 'stopDesk', then: Joi.required(), otherwise: Joi.forbidden() }),
};
const quoteQuery = Joi.object({
  ...destination,
  product: Joi.string().hex().length(24).required(),
  quantity: Joi.number().integer().min(1).max(1000).required(),
});
const delivery = Joi.object({
  ...destination,
  address: Joi.string().trim().min(5).max(300).when('deliveryType', { is: 'home', then: Joi.required(), otherwise: Joi.forbidden() }),
  expectedTariffRevision: Joi.number().integer().min(0).required(),
  expectedUnitPrice: Joi.number().min(0).required(),
});
const saveWilaya = Joi.object({ revision: Joi.number().integer().min(0).required(), wilaya: wilaya.required() });
const bulk = Joi.object({ revision: Joi.number().integer().min(0).required(), wilayas: Joi.array().items(wilaya).min(1).required(), dryRun: Joi.boolean().default(false) });

module.exports = { code, wilaya, quoteQuery, delivery, saveWilaya, bulk };
