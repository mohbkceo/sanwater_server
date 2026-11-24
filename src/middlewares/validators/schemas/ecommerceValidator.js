const Joi = require("joi");
const { MAX_LINE_QUANTITY } = require("../../../services/ecommerce/domain");
const id = Joi.string().hex().length(24);
const text = (max = 150) => Joi.string().trim().max(max);
const money = Joi.number().min(0).max(1e10).precision(2);
const variant = Joi.object({
  id: text(100).required(),
  sku: text(100).required(),
  options: Joi.object()
    .pattern(/^.{1,50}$/, text(100).required())
    .max(4)
    .required(),
  price: money.allow(null),
  image: Joi.string()
    .uri({ scheme: ["https"] })
    .max(2000)
    .allow(""),
  enabled: Joi.boolean().required(),
  trackStock: Joi.boolean().required(),
  quantity: Joi.number().integer().min(0).max(1e9).required(),
});
const options = Joi.array()
  .max(4)
  .items(
    Joi.object({
      name: text(50).required(),
      values: Joi.array().min(1).max(20).items(text(100).required()).required(),
    }),
  );
const commerce = Joi.object({
  published: Joi.boolean().required(),
  requiresProduction: Joi.boolean(),
  options: options.required(),
  variants: Joi.array().min(1).max(100).items(variant).required(),
  offer: Joi.object({
    enabled: Joi.boolean().required(),
    type: Joi.string().valid("percentage", "fixed", "quantity"),
    value: money,
    minQuantity: Joi.number().integer().min(2),
    startsAt: Joi.date().iso().allow(null),
    endsAt: Joi.date().iso().allow(null),
  }),
});
const product = Joi.object({
  revision: Joi.number().integer().min(0).required(),
  name: text().required(),
  productId: text(50).required(),
  description: text(20000).allow(""),
  gallery: Joi.array()
    .max(20)
    .items(
      Joi.string()
        .uri({ scheme: ["https"] })
        .max(2000),
    ),
  subFamily: id.allow(null, ""),
  salesMode: Joi.string().valid("catalog", "ecommerce", "both").required(),
  basePrice: money.required(),
  commerce: commerce.required(),
});
const item = Joi.object({
  productId: id.required(),
  variantId: text(100).required(),
  quantity: Joi.number().integer().min(1).max(MAX_LINE_QUANTITY).required(),
  overrideUnitPrice: money,
  overrideReason: text(1000).when("overrideUnitPrice", {
    is: Joi.exist(),
    then: Joi.required(),
  }),
});
const delivery = Joi.object({
  wilayaCode: text(30).required(),
  communeCode: text(30).required(),
  deliveryType: Joi.string().valid("home", "stopDesk").required(),
  address: text(300).min(5).when("deliveryType", {
    is: "home",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  officeCode: text(30).when("deliveryType", {
    is: "stopDesk",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
});
const cart = {
  items: Joi.array().min(1).max(50).items(item).required(),
  delivery: delivery.required(),
};
const quote = Joi.object(cart);
const create = Joi.object({
  requiresProduction: Joi.boolean(),
  ...cart,
  customer: Joi.object({
    name: text(120).min(2).required(),
    phone: text(30).required(),
    email: Joi.string().email().max(254).allow(""),
  }).required(),
  expectedQuote: text(64).length(64).required(),
  source: Joi.string().valid("landing", "storefront", "manual"),
  campaign: text(160).allow(""),
  internalNote: text(3000).allow(""),
  website: Joi.string().valid("").default(""),
});
const action = Joi.object({
  revision: Joi.number().integer().min(0).required(),
  requestId: Joi.string().guid({ version: "uuidv4" }).required(),
  action: Joi.string()
    .valid(
      "transition",
      "productionStart",
      "productionFinish",
      "confirmation",
      "note",
      "assign",
      "important",
      "issue",
      "resolve",
      "shipment",
      "payment",
      "restock",
      "edit",
    )
    .required(),
  target: Joi.string().valid(
    ...Object.keys(require("../../../services/ecommerce/domain").STATES),
  ),
  reason: text(1000),
  outcome: Joi.string().valid("NO_ANSWER", "POSTPONED"),
  followUpAt: Joi.date().iso().greater("now"),
  note: text(3000),
  assignment: id.allow(null),
  important: Joi.boolean(),
  issueId: id,
  type: text(100),
  severity: Joi.string().valid("INFO", "WARNING", "CRITICAL"),
  blocking: Joi.boolean(),
  responsibleTeam: text(100),
  agency: text(150),
  trackingNumber: text(150),
  externalState: text(150),
  amount: money.positive(),
  paymentKind: Joi.string().valid("paid", "collected", "refunded"),
  order: create,
});
function parse(schema, value) {
  const r = schema.validate(value, { abortEarly: false, convert: true });
  if (r.error)
    require("../../../services/ecommerce/domain").fail(r.error.message, 400);
  return r.value;
}
module.exports = {
  product,
  options,
  variant,
  quote,
  create,
  action,
  parse,
  id,
};
