const { Schema } = require("mongoose");
const value = new Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    swatchHex: String,
  },
  { _id: false },
);
const option = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["color", "size", "material", "finish", "custom"],
      required: true,
    },
    values: [value],
  },
  { _id: false },
);
const selection = new Schema(
  {
    optionId: { type: String, required: true },
    valueId: { type: String, required: true },
  },
  { _id: false },
);
const variant = new Schema(
  {
    id: { type: String, required: true },
    selections: [selection],
    sku: { type: String, required: true },
    priceOverride: { type: Number, default: null, min: 0 },
    trackInventory: { type: Boolean, default: false },
    stockQuantity: { type: Number, default: 0, min: 0 },
    isAvailable: { type: Boolean, default: true },
    imageUrl: { type: String, default: null },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false },
);
module.exports = { option, variant };
