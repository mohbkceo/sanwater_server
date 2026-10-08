const ShippingConfig = require('../models/shippingConfig.model');
const Product = require('../models/product.model');
const CostumeException = require('../utils/CostumeException');

function fail(message, statusCode = 422) { throw new CostumeException(message, statusCode, 'SHIPPING_UNAVAILABLE'); }
function uniqueCodes(items, label) {
  const codes = items.map(item => item.code);
  if (codes.length !== new Set(codes).size) fail(`Duplicate ${label} code`);
}
function validateWilayas(wilayas) {
  uniqueCodes(wilayas, 'wilaya');
  for (const wilaya of wilayas) {
    uniqueCodes(wilaya.communes, 'commune');
    for (const commune of wilaya.communes) uniqueCodes(commune.offices, 'office');
  }
}
function calculateShipping(config, destination) {
  if (!['home', 'stopDesk'].includes(destination.deliveryType)) fail('Invalid delivery method');
  const wilaya = config?.wilayas?.find(entry => entry.code === destination.wilayaCode);
  if (!wilaya) fail('Unsupported wilaya');
  const commune = wilaya.communes.find(entry => entry.code === destination.communeCode);
  if (!commune) fail('Commune does not belong to this wilaya');
  const desk = destination.deliveryType === 'stopDesk';
  const enabledKey = desk ? 'stopDeskEnabled' : 'homeEnabled';
  const priceKey = desk ? 'stopDeskPrice' : 'homePrice';
  if (!wilaya[enabledKey] || !commune[enabledKey]) fail('Delivery method unavailable');
  const price = commune[priceKey] ?? wilaya[priceKey];
  if (price == null) fail('Shipping rate not configured');
  let office = null;
  if (desk) {
    office = commune.offices.find(entry => entry.code === destination.officeCode && entry.enabled);
    if (!office) fail('Pickup office unavailable for this commune');
  }
  return {
    wilayaCode: wilaya.code, wilayaName: wilaya.name,
    communeCode: commune.code, communeName: commune.name,
    deliveryType: destination.deliveryType,
    office: office ? { code: office.code, name: office.name, address: office.address } : null,
    shippingFee: price,
  };
}
async function quote(destination, productId, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) fail('Invalid quantity');
  const [config, product] = await Promise.all([
    ShippingConfig.findById('noest').lean(),
    Product.findById(productId).lean(),
  ]);
  if (!product || !product.isActive) fail('Product unavailable', 404);
  const unitPrice = product.prices?.productPrice;
  if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice)) fail('Product price unavailable');
  const shipping = calculateShipping(config, destination);
  const subtotal = Math.round(unitPrice * quantity * 100) / 100;
  return {
    ...shipping, address: destination.address || null,
    product: product._id, productName: product.name || product.productId,
    productSerialNumber: product.serialNumber, quantity, unitPrice,
    subtotal, total: Math.round((subtotal + shipping.shippingFee) * 100) / 100,
    tariffRevision: config.revision, quotedAt: new Date(),
  };
}
module.exports = { calculateShipping, validateWilayas, quote };
