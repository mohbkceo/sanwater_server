const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Product = require('../src/models/product.model');
const ShippingConfig = require('../src/models/shippingConfig.model');
const Quotation = require('../src/models/quotation.model');
const { calculateShipping, quote } = require('../src/services/shipping.service');
const { createQuotation } = require('../src/controllers/quotations/quotationController');
const { createQuotationSchema } = require('../src/middlewares/validators/schemas/quotationValidator');
const authorize = require('../src/middlewares/authentication/authorize');
const { PERMISSIONS } = require('../src/config/permissions');

const productId = new mongoose.Types.ObjectId();
const config = {
  revision: 4,
  wilayas: [{ code: 'W1', name: 'Test wilaya', homePrice: 300, stopDeskPrice: 0,
    homeEnabled: true, stopDeskEnabled: true,
    communes: [{ code: 'C1', name: 'Test commune', homePrice: null, stopDeskPrice: null,
      homeEnabled: true, stopDeskEnabled: true,
      offices: [{ code: 'O1', name: 'Test office', address: 'Main street', enabled: true }] },
    { code: 'C2', name: 'Other commune', homePrice: 200, stopDeskPrice: null,
      homeEnabled: false, stopDeskEnabled: false, offices: [] }] }],
};
const destination = { wilayaCode: 'W1', communeCode: 'C1', deliveryType: 'home', address: '123 Example Road' };
const item = { product: String(productId), productName: 'Client name', quantity: 2 };
const requester = { fullName: 'Test Buyer', phone: '0550000000' };

test('wilaya rates, overrides and valid free Stop Desk shipping', () => {
  assert.equal(calculateShipping(config, destination).shippingFee, 300);
  assert.equal(calculateShipping(config, { ...destination, deliveryType: 'stopDesk', officeCode: 'O1' }).shippingFee, 0);
  const overridden = structuredClone(config);
  overridden.wilayas[0].communes[0].homePrice = 120;
  assert.equal(calculateShipping(overridden, destination).shippingFee, 120);
});
test('invalid relationships, missing rates, disabled methods and wrong offices fail explicitly', () => {
  assert.throws(() => calculateShipping(config, { ...destination, communeCode: 'unknown' }), /Commune does not belong/);
  assert.throws(() => calculateShipping(config, { ...destination, communeCode: 'C2' }), /unavailable/);
  assert.throws(() => calculateShipping(config, { ...destination, deliveryType: 'stopDesk', officeCode: 'bad' }), /office unavailable/);
  const missing = structuredClone(config); missing.wilayas[0].homePrice = null;
  assert.throws(() => calculateShipping(missing, destination), /rate not configured/);
});
test('public quote derives subtotal and total from stored product and tariff', async t => {
  t.mock.method(ShippingConfig, 'findById', () => ({ lean: async () => config }));
  t.mock.method(Product, 'findById', () => ({ lean: async () => ({ _id: productId, name: 'Real product', serialNumber: 'SN1', isActive: true, prices: { productPrice: 1509 } }) }));
  const result = await quote(destination, String(productId), 2);
  assert.equal(result.subtotal, 3018);
  assert.equal(result.shippingFee, 300);
  assert.equal(result.total, 3318);
  assert.equal(result.tariffRevision, 4);
});
test('checkout persists server prices and delivery snapshot; B2B remains compatible', async t => {
  t.mock.method(ShippingConfig, 'findById', () => ({ lean: async () => config }));
  t.mock.method(Product, 'findById', () => ({ lean: async () => ({ _id: productId, name: 'Real product', serialNumber: 'SN1', isActive: true, prices: { productPrice: 1509, shippingPrice: 9999 } }) }));
  const created = [];
  t.mock.method(Quotation, 'create', async payload => { created.push(payload); return { _id: productId, status: 'submitted' }; });
  const response = { status() { return this; }, json() { return this; } };
  let error;
  await createQuotation({ body: { items: [item], requester, source: 'landing_product_page', delivery: { ...destination, expectedTariffRevision: 4, expectedUnitPrice: 1509 } } }, response, err => { error = err; });
  assert.equal(error, undefined);
  assert.equal(created[0].pricing.total, 3318);
  assert.equal(created[0].items[0].productName, 'Real product');
  assert.equal(created[0].items[0].note, undefined);
  assert.equal(created[0].delivery.communeCode, 'C1');
  await createQuotation({ body: { items: [item], requester, source: 'product_detail_page' } }, response, err => { error = err; });
  assert.equal(error, undefined);
  assert.equal(created[1].pricing, undefined);
  assert.equal(created[1].items[0].productName, 'Client name');
});
test('landing payload requires delivery while B2B payload stays valid', () => {
  assert.ok(createQuotationSchema.validate({ items: [item], requester, source: 'landing_product_page' }).error);
  assert.equal(createQuotationSchema.validate({ items: [item], requester, source: 'landing_product_page', delivery: { ...destination, expectedTariffRevision: 4, expectedUnitPrice: 1509 } }).error, undefined);
  assert.equal(createQuotationSchema.validate({ items: [item], requester, source: 'product_detail_page' }).error, undefined);
  const b2b = new Quotation({ items: [item], requester });
  assert.equal(b2b.toObject().pricing, undefined);
});
test('checkout rejects a stale tariff revision before persisting', async t => {
  t.mock.method(ShippingConfig, 'findById', () => ({ lean: async () => config }));
  t.mock.method(Product, 'findById', () => ({ lean: async () => ({ _id: productId, name: 'Real product', serialNumber: 'SN1', isActive: true, prices: { productPrice: 1509 } }) }));
  let persisted = false;
  t.mock.method(Quotation, 'create', async () => { persisted = true; });
  let caught;
  await createQuotation({ body: { items: [item], requester, source: 'landing_product_page', delivery: { ...destination, expectedTariffRevision: 3, expectedUnitPrice: 1509 } } }, {}, err => { caught = err; });
  assert.equal(caught.statusCode, 409);
  assert.equal(persisted, false);
});
test('tariff edits require products.manage', () => {
  let allowed = false;
  const guard = authorize(PERMISSIONS.PRODUCTS.MANAGE);
  assert.throws(() => guard({ user: { role: 'admin', permissions: [PERMISSIONS.PRODUCTS.VIEW] } }, {}, () => { allowed = true; }), /permission/);
  assert.equal(allowed, false);
  guard({ user: { role: 'admin', permissions: [PERMISSIONS.PRODUCTS.MANAGE] } }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
});
