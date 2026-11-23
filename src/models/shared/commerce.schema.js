const { Schema } = require("mongoose");
const variant = new Schema(
  {
    id: { type: String, required: true },
    sku: { type: String, required: true, trim: true },
    options: { type: Object, default: {} },
    price: { type: Number, min: 0, default: null },
    image: { type: String, default: "" },
    enabled: { type: Boolean, default: true },
    trackStock: { type: Boolean, default: false },
    quantity: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);
module.exports = new Schema(
  {
    published: { type: Boolean, default: false },
    requiresProduction: { type: Boolean, default: false },
    revision: { type: Number, default: 0 },
    options: {
      type: [{ name: String, values: [String], _id: false }],
      default: [],
    },
    reservedUnits: { type: Number, default: 0, min: 0 },
    variants: { type: [variant], default: [] },
    offer: {
      enabled: { type: Boolean, default: false },
      type: { type: String, enum: ["percentage", "fixed", "quantity"] },
      value: Number,
      minQuantity: Number,
      startsAt: Date,
      endsAt: Date,
    },
  },
  { _id: false },
);
