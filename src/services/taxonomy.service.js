const mongoose = require('mongoose');
const Family = require('../models/family.model');
const SubFamily = require('../models/subFamily.model');
const Product = require('../models/product.model');
const CostumeException = require('../utils/CostumeException');
const { ERRORS } = require('../config/messages');

function invalidTaxonomy(message) {
  return new CostumeException(ERRORS.INVALID.msg, ERRORS.INVALID.statusCode, ERRORS.INVALID.key, { message });
}

async function resolveSubFamilyAssignment(subFamilyId, { activeOnly = false, session } = {}) {
  if (!mongoose.isValidObjectId(subFamilyId)) throw invalidTaxonomy('invalid_sub_family');

  const query = SubFamily.findById(subFamilyId).populate('family');
  if (session) query.session(session);
  const subFamily = await query;
  if (!subFamily || !subFamily.family) throw invalidTaxonomy('sub_family_not_found');
  if (activeOnly && (!subFamily.isActive || !subFamily.family.isActive)) {
    throw invalidTaxonomy('inactive_taxonomy');
  }

  return { subFamily: subFamily._id, family: subFamily.family._id };
}

async function validateBulkAssignment(subFamilyId, productIds) {
  if (!mongoose.isValidObjectId(subFamilyId)) throw invalidTaxonomy('invalid_sub_family');

  const uniqueProductIds = [...new Set(productIds.map(String))];
  if (!uniqueProductIds.length || uniqueProductIds.some((id) => !mongoose.isValidObjectId(id))) {
    throw invalidTaxonomy('invalid_product_ids');
  }

  const subFamily = await SubFamily.findById(subFamilyId).select('_id family name');
  if (!subFamily || !subFamily.family) throw invalidTaxonomy('sub_family_not_found');

  const productCount = await Product.countDocuments({ _id: { $in: uniqueProductIds } });
  if (productCount !== uniqueProductIds.length) throw invalidTaxonomy('one_or_more_products_not_found');

  return { subFamily, productIds: uniqueProductIds };
}

async function assignProductsToSubFamily(subFamilyId, productIds) {
  const validated = await validateBulkAssignment(subFamilyId, productIds);
  const result = await Product.updateMany(
    { _id: { $in: validated.productIds } },
    { $set: { subFamily: validated.subFamily._id, family: validated.subFamily.family } },
  );
  return { subFamily: validated.subFamily, matchedCount: result.matchedCount, assignedCount: result.modifiedCount };
}

async function removeProductsFromSubFamily(subFamilyId, productIds) {
  const validated = await validateBulkAssignment(subFamilyId, productIds);
  const result = await Product.updateMany(
    { _id: { $in: validated.productIds }, subFamily: validated.subFamily._id },
    { $set: { subFamily: null, family: null } },
  );
  return { subFamily: validated.subFamily, matchedCount: result.matchedCount, removedCount: result.modifiedCount };
}

async function resolveCatalogFilter({ family, subFamily, publicOnly = false } = {}) {
  const filter = {};
  let familyDoc = null;
  let subFamilyDoc = null;

  if (family) {
    const criteria = mongoose.isValidObjectId(family) ? { _id: family } : { slug: String(family).toLowerCase() };
    familyDoc = await Family.findOne({ ...criteria, ...(publicOnly ? { isActive: true } : {}) }).lean();
    if (!familyDoc) return { _id: null };
    filter.family = familyDoc._id;
  }

  if (subFamily) {
    const criteria = mongoose.isValidObjectId(subFamily) ? { _id: subFamily } : { slug: String(subFamily).toLowerCase() };
    subFamilyDoc = await SubFamily.findOne({
      ...criteria,
      ...(familyDoc ? { family: familyDoc._id } : {}),
      ...(publicOnly ? { isActive: true } : {}),
    }).lean();
    if (!subFamilyDoc) return { _id: null };
    if (familyDoc && String(subFamilyDoc.family) !== String(familyDoc._id)) return { _id: null };
    filter.subFamily = subFamilyDoc._id;
    filter.family = subFamilyDoc.family;
  }

  if (publicOnly) {
    if (!familyDoc && !subFamilyDoc) {
      const activeFamilies = await Family.find({ isActive: true }).distinct('_id');
      const activeSubFamilies = await SubFamily.find({ isActive: true, family: { $in: activeFamilies } }).distinct('_id');
      filter.family = { $in: activeFamilies };
      filter.subFamily = { $in: activeSubFamilies };
    } else if (familyDoc && !subFamilyDoc) {
      const activeSubFamilies = await SubFamily.find({ family: familyDoc._id, isActive: true }).distinct('_id');
      filter.subFamily = { $in: activeSubFamilies };
    } else if (subFamilyDoc && !familyDoc) {
      const parent = await Family.findOne({ _id: subFamilyDoc.family, isActive: true }).lean();
      if (!parent) return { _id: null };
    }
  }

  return filter;
}

async function getFamilyTree({ admin = false, slug } = {}) {
  const familyQuery = { ...(admin ? {} : { isActive: true }), ...(slug ? { slug: String(slug).toLowerCase() } : {}) };
  const families = await Family.find(familyQuery).sort({ order: 1, name: 1 }).lean();
  if (!families.length) return [];

  const familyIds = families.map((family) => family._id);
  const subFamilies = await SubFamily.find({
    family: { $in: familyIds },
    ...(admin ? {} : { isActive: true }),
  }).sort({ order: 1, name: 1 }).lean();

  const visibleProductMatch = admin ? {} : {
    isActive: true,
    isEcommerce: { $in: [false, null] },
    subFamily: { $in: subFamilies.map((entry) => entry._id) },
  };
  const [familyCounts, subFamilyCounts] = await Promise.all([
    Product.aggregate([
      { $match: { family: { $in: familyIds }, ...visibleProductMatch } },
      { $group: { _id: '$family', count: { $sum: 1 } } },
    ]),
    Product.aggregate([
      { $match: { subFamily: { $in: subFamilies.map((entry) => entry._id) }, ...(admin ? {} : { isActive: true, isEcommerce: { $in: [false, null] } }) } },
      { $group: { _id: '$subFamily', count: { $sum: 1 } } },
    ]),
  ]);

  const familyCountMap = new Map(familyCounts.map((entry) => [String(entry._id), entry.count]));
  const subFamilyCountMap = new Map(subFamilyCounts.map((entry) => [String(entry._id), entry.count]));
  const grouped = new Map();
  subFamilies.forEach((entry) => {
    const key = String(entry.family);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({
      _id: entry._id,
      name: entry.name,
      slug: entry.slug,
      description: entry.description,
      image: entry.image,
      order: entry.order,
      isActive: entry.isActive,
      productCount: subFamilyCountMap.get(String(entry._id)) || 0,
    });
  });

  return families.map((family) => ({
    _id: family._id,
    name: family.name,
    slug: family.slug,
    description: family.description,
    image: family.image,
    order: family.order,
    isActive: family.isActive,
    seo: family.seo || {},
    productCount: familyCountMap.get(String(family._id)) || 0,
    subFamilyCount: (grouped.get(String(family._id)) || []).length,
    subFamilies: grouped.get(String(family._id)) || [],
  }));
}

module.exports = {
  assignProductsToSubFamily,
  getFamilyTree,
  removeProductsFromSubFamily,
  resolveCatalogFilter,
  resolveSubFamilyAssignment,
};
