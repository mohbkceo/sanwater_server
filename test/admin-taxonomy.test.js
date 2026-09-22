const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const mongoose = require('mongoose');

const Family = require('../src/models/family.model');
const SubFamily = require('../src/models/subFamily.model');
const Product = require('../src/models/product.model');
const slugify = require('../src/utils/slugify');
const {
  assignProductsToSubFamily, getFamilyTree, removeProductsFromSubFamily, resolveSubFamilyAssignment,
} = require('../src/services/taxonomy.service');
const {
  createProductSchema, updateProductSchema,
} = require('../src/middlewares/validators/schemas/productValidator');
const {
  createFamilySchema, createSubFamilySchema, deleteFamilySchema, deleteSubFamilySchema, productIdsSchema,
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

test('Product can exist without a Family or Sub Family', () => {
  const product = new Product({
    author: 'admin@example.com', name: 'Mixer', productId: 'ZZ999', serialNumber: 'product-test',
  });
  assert.equal(product.validateSync(), undefined);
  assert.equal(product.family, null);
  assert.equal(product.subFamily, null);
});

test('empty Families and Sub Families are valid', () => {
  const family = new Family({ name: 'Empty Family', slug: 'empty-family' });
  const subFamily = new SubFamily({ name: 'Empty Sub Family', slug: 'empty-sub-family', family: familyId });
  assert.equal(family.validateSync(), undefined);
  assert.equal(subFamily.validateSync(), undefined);
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
    select() { return this; },
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

test('Product API creates and updates products without taxonomy fields', () => {
  const valid = createProductSchema.validate({ productId: 'X' });
  assert.equal(valid.error, undefined);
  assert.equal(createProductSchema.validate({ productId: 'LA100' }).error, undefined);
  assert.ok(createProductSchema.validate({ productId: 'LA100', subFamily: String(subFamilyId) }).error);
  assert.ok(createProductSchema.validate({ productId: 'LA100', family: String(familyId) }).error);
  assert.equal(updateProductSchema.validate({ productId: 'ZZ999' }).error, undefined);
  assert.ok(updateProductSchema.validate({ subFamily: String(subFamilyId) }).error);
});

test('bulk assignment sets both Sub Family and its parent Family, including moves', async (t) => {
  const otherFamilyId = new mongoose.Types.ObjectId();
  const productIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  let update;
  t.mock.method(SubFamily, 'findById', () => thenableQuery({ _id: subFamilyId, family: otherFamilyId, name: 'Kitchen' }));
  t.mock.method(Product, 'countDocuments', () => Promise.resolve(productIds.length));
  t.mock.method(Product, 'updateMany', (query, change) => {
    update = { query, change };
    return Promise.resolve({ matchedCount: 2, modifiedCount: 2 });
  });

  const result = await assignProductsToSubFamily(String(subFamilyId), productIds.map(String));
  assert.equal(result.assignedCount, 2);
  assert.deepEqual(update.change.$set, { subFamily: subFamilyId, family: otherFamilyId });
  assert.deepEqual(update.query._id.$in, productIds.map(String));
});

test('bulk removal only unassigns products in the selected Sub Family', async (t) => {
  const productIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  let update;
  t.mock.method(SubFamily, 'findById', () => thenableQuery({ _id: subFamilyId, family: familyId, name: 'Lavabo' }));
  t.mock.method(Product, 'countDocuments', () => Promise.resolve(productIds.length));
  t.mock.method(Product, 'updateMany', (query, change) => {
    update = { query, change };
    return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
  });

  const result = await removeProductsFromSubFamily(String(subFamilyId), productIds.map(String));
  assert.equal(result.removedCount, 1);
  assert.equal(String(update.query.subFamily), String(subFamilyId));
  assert.deepEqual(update.change.$set, { subFamily: null, family: null });
});

test('bulk assignment rejects missing Products instead of partially assigning', async (t) => {
  const productIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  t.mock.method(SubFamily, 'findById', () => thenableQuery({ _id: subFamilyId, family: familyId, name: 'Lavabo' }));
  t.mock.method(Product, 'countDocuments', () => Promise.resolve(1));
  await assert.rejects(() => assignProductsToSubFamily(String(subFamilyId), productIds.map(String)), /Resource Invalid/);
});

test('runtime taxonomy contains no Product ID prefix derivation', () => {
  const runtimeFiles = [
    '../src/controllers/products/productControler.js',
    '../src/controllers/products/familyController.js',
    '../src/services/taxonomy.service.js',
    '../src/models/product.model.js',
  ].map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
  assert.doesNotMatch(runtimeFiles, /deriveSubFamily/i);
  assert.doesNotMatch(runtimeFiles, /productId\s*\.\s*(?:slice|substring)\s*\(\s*0\s*,\s*2/i);
});

test('taxonomy validators cover slugs, visibility, order, and password deletion', () => {
  assert.equal(createFamilySchema.validate({ name: 'Mixers', slug: 'mixers', order: 2, isActive: false }).error, undefined);
  assert.ok(createFamilySchema.validate({ name: 'Mixers', slug: 'Not Valid' }).error);
  assert.equal(createSubFamilySchema.validate({ name: 'Lavabo', slug: 'lavabo' }).error, undefined);
  assert.ok(deleteFamilySchema.validate({}).error);
  assert.equal(deleteFamilySchema.validate({ password: 'secret' }).error, undefined);
  assert.ok(deleteSubFamilySchema.validate({ password: 'secret', replacementSubFamilyId: 'bad-id' }).error);
  assert.equal(productIdsSchema.validate({ productIds: [String(subFamilyId)] }).error, undefined);
  assert.ok(productIdsSchema.validate({ productIds: [] }).error);
  assert.ok(productIdsSchema.validate({ productIds: [String(subFamilyId), String(subFamilyId)] }).error);
});
