const mongoose = require('mongoose');

const officeSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  address: { type: String, trim: true, default: '' },
  enabled: { type: Boolean, default: true },
}, { _id: false });

const communeSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  homePrice: { type: Number, default: null, min: 0 },
  stopDeskPrice: { type: Number, default: null, min: 0 },
  homeEnabled: { type: Boolean, default: true },
  stopDeskEnabled: { type: Boolean, default: true },
  offices: { type: [officeSchema], default: [] },
}, { _id: false });

const wilayaSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  homePrice: { type: Number, default: null, min: 0 },
  stopDeskPrice: { type: Number, default: null, min: 0 },
  homeEnabled: { type: Boolean, default: true },
  stopDeskEnabled: { type: Boolean, default: true },
  communes: { type: [communeSchema], default: [] },
}, { _id: false });

const schema = new mongoose.Schema({
  _id: { type: String, default: 'noest' },
  revision: { type: Number, default: 0 },
  wilayas: { type: [wilayaSchema], default: [] },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('ShippingConfig', schema);
