const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');

const Family = require('../src/models/family.model');
const SubFamily = require('../src/models/subFamily.model');
const Product = require('../src/models/product.model');
const slugify = require('../src/utils/slugify');
const { getFamilyTree, resolveSubFamilyAssignment } = require('../src/services/taxonomy.service');
const {
  createProductSchema, updateProductSchema,
} = require('../src/middlewares/validators/schemas/productValidator');
const {
  createFamilySchema, createSubFamilySchema, deleteFamilySchema, deleteSubFamilySchema,
} = require('../src/middlewares/validators/schemas/familyValidator');

const familyId = new mongoose.Types.ObjectId();
const subFamilyId = new mongoose.Types.ObjectId();

test('creates robust URL slugs', () => {
  assert.equal(slugify('Sanitary Mixers'), 'sanitary-mixers');
  assert.equal(slugify('  Lavabo Premium  '), 'lavabo-premium');
  assert.equal(slugify('Évier & Cuisine'), 'evier-cuisine');
});

test('Family and SubFamily schemas require persisted hierarchy fields', () => {
  const family = new Family({ name: 'Sanitary Mixers', slug: 'sanitary-mixers' });
  const subFamily = new SubFamily({ name: 'Lavabo', slug: 'lavabo', family: familyId });
  assert.equal(family.validateSync(), undefined);
  assert.equal(subFamily.validateSync(), undefined);
  assert.ok(new SubFamily({ name: 'Orphan', slug: 'orphan' }).validateSync().errors.family);
});

test('Product requires ObjectId Family and Sub Family references', () => {
  const product = new Product({
    author: 'admin@example.com', name: 'Mixer', productId: 'ZZ999', serialNumber: 'product-test',
    family: familyId, subFamily: subFamilyId,
  });
  assert.equal(product.validateSync(), undefined);
  assert.ok(new Product({ author: 'a', productId: 'LA100', serialNumber: 'product-orphan' }).validateSync().errors.subFamily);
});

test('changing Product ID never changes taxonomy assignment', () => {
  const product = new Product({
    author: 'admin@example.com', productId: 'LA100', serialNumber: 'product-stable',
    family: familyId, subFamily: subFamilyId,
  });
  product.productId = 'SH900';
  assert.equal(String(product.family), String(familyId));
  assert.equal(String(product.subFamily), String(subFamilyId));
});

function thenableQuery(value) {
  return {
    populate() { return this; },
    session() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function leanQuery(value) {
  return { sort() { return this; }, lean() { return Promise.resolve(value); } };
}

test('server derives Family exclusively from the selected Sub Family', async (t) => {
  t.mock.method(SubFamily, 'findById', () => thenableQuery({
    _id: subFamilyId,
    isActive: true,
    family: { _id: familyId, isActive: true },
  }));
  const assignment = await resolveSubFamilyAssignment(String(subFamilyId));
  assert.equal(String(assignment.subFamily), String(subFamilyId));
  assert.equal(String(assignment.family), String(familyId));
});

test('server rejects nonexistent and inactive Sub Family assignments', async (t) => {
  const method = t.mock.method(SubFamily, 'findById', () => thenableQuery(null));
  await assert.rejects(() => resolveSubFamilyAssignment(String(subFamilyId)), /Resource Invalid/);
  method.mock.mockImplementation(() => thenableQuery({
    _id: subFamilyId,
    isActive: false,
    family: { _id: familyId, isActive: true },
  }));
  await assert.rejects(() => resolveSubFamilyAssignment(String(subFamilyId), { activeOnly: true }), /Resource Invalid/);
});

test('public hierarchy queries only active entities while admin includes inactive entities', async (t) => {
  let familyQuery;
  let subFamilyQuery;
  t.mock.method(Family, 'find', (query) => {
    familyQuery = query;
    return leanQuery([{ _id: familyId, name: 'Mixers', slug: 'mixers', isActive: true }]);
  });
  t.mock.method(SubFamily, 'find', (query) => {
    subFamilyQuery = query;
    return leanQuery([{ _id: subFamilyId, family: familyId, name: 'Lavabo', slug: 'lavabo', isActive: true }]);
  });
  t.mock.method(Product, 'aggregate', (pipeline) => {
    const group = pipeline.find((stage) => stage.$group)?.$group?._id;
    return Promise.resolve(group === '$family'
      ? [{ _id: familyId, count: 3 }]
      : [{ _id: subFamilyId, count: 3 }]);
  });

  const publicTree = await getFamilyTree();
  assert.equal(familyQuery.isActive, true);
  assert.equal(subFamilyQuery.isActive, true);
  assert.equal(publicTree[0].productCount, 3);
  assert.equal(publicTree[0].subFamilies[0].productCount, 3);

  await getFamilyTree({ admin: true });
  assert.equal('isActive' in familyQuery, false);
  assert.equal('isActive' in subFamilyQuery, false);
});

test('Product API accepts only Sub Family assignment and rejects browser Family', () => {
  const valid = createProductSchema.validate({ productId: 'X', subFamily: String(subFamilyId) });
  assert.equal(valid.error, undefined);
  assert.ok(createProductSchema.validate({ productId: 'LA100' }).error);
  assert.ok(createProductSchema.validate({ productId: 'LA100', subFamily: String(subFamilyId), family: String(familyId) }).error);
  assert.equal(updateProductSchema.validate({ productId: 'ZZ999' }).error, undefined);
  assert.equal(updateProductSchema.validate({ subFamily: String(subFamilyId) }).error, undefined);
});

test('taxonomy validators cover slugs, visibility, order, and password deletion', () => {
  assert.equal(createFamilySchema.validate({ name: 'Mixers', slug: 'mixers', order: 2, isActive: false }).error, undefined);
  assert.ok(createFamilySchema.validate({ name: 'Mixers', slug: 'Not Valid' }).error);
  assert.equal(createSubFamilySchema.validate({ name: 'Lavabo', slug: 'lavabo' }).error, undefined);
  assert.ok(deleteFamilySchema.validate({}).error);
  assert.equal(deleteFamilySchema.validate({ password: 'secret' }).error, undefined);
  assert.ok(deleteSubFamilySchema.validate({ password: 'secret', replacementSubFamilyId: 'bad-id' }).error);
});
