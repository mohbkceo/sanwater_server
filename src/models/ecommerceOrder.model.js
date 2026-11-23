const { Schema, model } = require("mongoose");
const { STATES } = require("../services/ecommerce/domain");
const ref = (name) => ({ type: Schema.Types.ObjectId, ref: name });
const event = new Schema(
  {
    kind: String,
    actor: ref("User"),
    at: { type: Date, default: Date.now },
    revision: Number,
    data: Object,
  },
  { _id: false },
);
const issue = new Schema({
  type: String,
  severity: { type: String, enum: ["INFO", "WARNING", "CRITICAL"] },
  blocking: Boolean,
  description: String,
  reporter: ref("User"),
  responsibleTeam: String,
  createdAt: Date,
  status: { type: String, enum: ["OPEN", "RESOLVED"], default: "OPEN" },
  resolvedBy: ref("User"),
  resolvedAt: Date,
});
const item = new Schema(
  {
    productId: ref("ProductSchema"),
    variantId: String,
    name: String,
    sku: String,
    options: Object,
    image: String,
    unitPrice: Number,
    quantity: Number,
    discount: Number,
    lineTotal: Number,
    trackStock: Boolean,
    requiresProduction: Boolean,
    overrideReason: String,
  },
  { _id: false },
);
const schema = new Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },
    requestHash: { type: String, immutable: true },
    customerId: ref("Customer"),
    customer: { name: String, phone: String, email: String },
    source: {
      type: String,
      enum: [
        "landing",
        "storefront",
        "manual",
        "import",
        "lead",
        "quotation",
        "migration",
      ],
      required: true,
    },
    campaign: String,
    externalReference: String,
    sourceRecord: { type: String, unique: true, sparse: true, immutable: true },
    items: [item],
    delivery: Object,
    financials: {
      subtotal: Number,
      discount: Number,
      shippingFee: Number,
      total: Number,
      currency: String,
    },
    payment: {
      method: { type: String, default: "COD" },
      paid: { type: Number, default: 0 },
      collected: { type: Number, default: 0 },
      refunded: { type: Number, default: 0 },
    },
    commercialStatus: {
      type: String,
      enum: Object.keys(STATES),
      default: "NEW",
      index: true,
    },
    confirmation: {
      attempts: { type: [Object], default: [] },
      followUpAt: Date,
      confirmedAt: Date,
    },
    fulfillment: {
      stage: { type: String, default: "PENDING" },
      requiresProduction: Boolean,
    },
    shipment: {
      provider: { type: String, default: "manual" },
      agency: String,
      trackingNumber: String,
      externalState: String,
    },
    inventoryState: {
      type: String,
      enum: ["NONE", "RESERVED", "CONSUMED", "RELEASED", "RESTOCKED"],
      default: "NONE",
    },
    assignment: ref("User"),
    important: { type: Boolean, default: false },
    internalNotes: { type: [Object], default: [] },
    issues: { type: [issue], default: [] },
    events: { type: [event], default: [] },
    operations: { type: [String], default: [] },
    revision: { type: Number, default: 0 },
    originalData: { type: Object, immutable: true },
    legacyCreatedAt: { type: Date, immutable: true },
    createdBy: ref("User"),
  },
  { timestamps: true, optimisticConcurrency: true },
);
schema.index({ createdAt: -1, _id: -1 });
schema.index({ commercialStatus: 1, createdAt: -1 });
schema.index({ source: 1, createdAt: -1 });
schema.index({ 'fulfillment.stage': 1, createdAt: -1 });
schema.index({ 'issues.status': 1, createdAt: -1 });
schema.index(
  { source: 1, externalReference: 1 },
  {
    unique: true,
    partialFilterExpression: { externalReference: { $type: "string" } },
  },
);
schema.index({ assignment: 1, commercialStatus: 1, createdAt: -1 });
schema.index({ customerId: 1, createdAt: -1 });
schema.index({ "customer.phone": 1 });
module.exports = model("EcommerceOrder", schema);
