const { Schema, model } = require("mongoose");
exports.Counter = model(
  "CommerceCounter",
  new Schema({ _id: String, value: { type: Number, default: 0 } }),
);
exports.StockMovement = model(
  "CommerceStockMovement",
  new Schema({
    productId: Schema.Types.ObjectId,
    variantId: String,
    orderId: Schema.Types.ObjectId,
    quantity: Number,
    kind: String,
    reason: String,
    actor: Schema.Types.ObjectId,
    at: { type: Date, default: Date.now },
  }),
);
exports.ProductEvent = model(
  "CommerceProductEvent",
  new Schema({
    productId: Schema.Types.ObjectId,
    revision: Number,
    actor: Schema.Types.ObjectId,
    data: Object,
    at: { type: Date, default: Date.now },
  }),
);
exports.ImportBatch = model(
  "CommerceImportBatch",
  new Schema(
    {
      fingerprint: { type: String, unique: true },
      filename: String,
      createdBy: Schema.Types.ObjectId,
      columns: [String],
      rows: [Object],
      previewRevision: { type: Number, default: 0 },
      results: { type: [Object], default: [] },
    },
    { timestamps: true, optimisticConcurrency: true },
  ),
);

// Store-wide E-commerce switches edited in the admin (one document, "store").
// An unset field means nobody has chosen yet: the matching environment
// variable stays the default, so deploying this changes no behaviour.
exports.CommerceSettings = model(
  "CommerceSettings",
  new Schema(
    {
      _id: String,
      checkoutEnabled: Boolean,
      partialPaymentsEnabled: Boolean,
      revision: { type: Number, default: 0 },
      updatedBy: Schema.Types.ObjectId,
      history: { type: [Object], default: [] },
    },
    { timestamps: true },
  ),
);
