const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCatalogFilter,
  buildFamilyTree,
  deriveSubFamily,
} = require('../src/services/catalogFamily.service');
const {
  createProductSchema,
  updateProductSchema,
} = require('../src/middlewares/validators/schemas/productValidator');

const products = [
  { family: 'SM', productId: 'LA100', serialNumber: 'product-1', name: 'One', isActive: true },
  { family: 'SM', productId: 'la200', serialNumber: 'product-2', name: 'Two', isActive: true },
  { family: 'SM', productId: 'SH100', serialNumber: 'product-3', name: 'Three', isActive: true },
  { family: 'KM', productId: 'KI100', serialNumber: 'product-4', name: 'Four', isActive: true },
];

test('derives Sub Family from the normalized first two Product ID characters', () => {
  assert.equal(deriveSubFamily('LA100'), 'LA');
  assert.equal(deriveSubFamily(' la100 '), 'LA');
  assert.equal(deriveSubFamily('L'), 'L');
  assert.equal(deriveSubFamily(null), '');
});

test('groups Products into derived Families and Sub Families', () => {
  const tree = buildFamilyTree(products, [], { isAdmin: true });
  const sm = tree.find((family) => family.key === 'SM');
  const km = tree.find((family) => family.key === 'KM');

  assert.equal(sm.productCount, 3);
  assert.deepEqual(
    sm.subFamilies.map(({ key, productCount }) => ({ key, productCount })),
    [
      { key: 'LA', productCount: 2 },
      { key: 'SH', productCount: 1 },
    ],
  );
  assert.equal(km.subFamilies[0].key, 'KI');
  assert.equal(km.subFamilies[0].productCount, 1);
});

test('applies display config while retaining raw keys and fallback entries', () => {
  const tree = buildFamilyTree(
    products,
    [
      {
        familyKey: 'SM',
        displayName: 'Sanwater Mixer',
        order: 0,
        isActive: true,
        subFamilies: [
          { key: 'LA', displayName: 'Lavabo', order: 0, isActive: true },
        ],
      },
    ],
    { isAdmin: true },
  );

  const sm = tree.find((family) => family.key === 'SM');
  assert.equal(sm.displayName, 'Sanwater Mixer');
  assert.equal(sm.subFamilies.find((sub) => sub.key === 'LA').displayName, 'Lavabo');
  assert.equal(sm.subFamilies.find((sub) => sub.key === 'SH').displayName, 'SH');
  assert.ok(tree.some((family) => family.key === 'KM' && family.displayName === 'KM'));
});

test('sorts configured order first and uses display names as a stable fallback', () => {
  const tree = buildFamilyTree(
    products,
    [
      { familyKey: 'SM', displayName: 'Zulu', order: 2, subFamilies: [] },
      { familyKey: 'KM', displayName: 'Alpha', order: 1, subFamilies: [] },
    ],
    { isAdmin: true },
  );

  assert.deepEqual(tree.map((family) => family.key), ['KM', 'SM']);
});

test('hides inactive configuration publicly but retains it for admins', () => {
  const configs = [
    {
      familyKey: 'SM',
      displayName: 'SM',
      isActive: true,
      subFamilies: [{ key: 'LA', displayName: 'LA', isActive: false }],
    },
    { familyKey: 'KM', displayName: 'KM', isActive: false, subFamilies: [] },
  ];

  const publicTree = buildFamilyTree(products, configs);
  const adminTree = buildFamilyTree(products, configs, { isAdmin: true });

  assert.equal(publicTree.some((family) => family.key === 'KM'), false);
  assert.equal(publicTree[0].subFamilies.some((sub) => sub.key === 'LA'), false);
  assert.equal(adminTree.some((family) => family.key === 'KM'), true);
  assert.equal(
    adminTree.find((family) => family.key === 'SM').subFamilies.some((sub) => sub.key === 'LA'),
    true,
  );
});

test('builds exact Family and normalized prefix Sub Family filters', () => {
  const familyOnly = buildCatalogFilter({ family: ' SM ' });
  assert.equal(familyOnly.family.test('SM'), true);
  assert.equal(familyOnly.family.test('XSM'), false);

  const combined = buildCatalogFilter({ family: 'SM', subFamily: 'la' });
  assert.equal(combined.productId.test('LA100'), true);
  assert.equal(combined.productId.test(' la200'), true);
  assert.equal(combined.productId.test('SHLA100'), false);

  const globalSubFamily = buildCatalogFilter({ subFamily: 'sh' });
  assert.equal(globalSubFamily.productId.test('SH100'), true);
});

test('membership follows Product family and Product ID changes without reassignment', () => {
  const changed = [{ ...products[0], family: 'KM', productId: 'SH900' }];
  const tree = buildFamilyTree(changed, [], { isAdmin: true });

  assert.equal(tree[0].key, 'KM');
  assert.equal(tree[0].subFamilies[0].key, 'SH');
});

test('Product validation requires derivable placement and rejects obsolete fields', () => {
  assert.ok(createProductSchema.validate({ family: 'SM', productId: 'LA100' }).error === undefined);
  assert.match(
    createProductSchema.validate({ family: 'SM', productId: 'L' }).error.message,
    /at least 2 characters/,
  );
  assert.ok(createProductSchema.validate({ productId: 'LA100' }).error);
  assert.ok(createProductSchema.validate({ family: 'SM', productId: 'LA100', category: 'old' }).error);
  assert.ok(updateProductSchema.validate({ productId: 'SH100' }).error === undefined);
});
