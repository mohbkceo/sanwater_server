const { Schema, model } = require("mongoose");
const schema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    secondaryPhone: String,
    email: String,
    delivery: Object,
    notes: { type: String, default: "" },
    nextFollowUpAt: Date,
    revision: { type: Number, default: 0 },
    history: { type: [Object], default: [] },
  },
  { timestamps: true },
);
module.exports = model("Customer", schema);
