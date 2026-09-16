const Product = require('../models/product.model');
const FamilyConfig = require('../models/familyConfig.model');

function normalizeFamilyKey(value) {
  return String(value ?? '').trim();
}

function deriveSubFamily(productId) {
  return String(productId ?? '').trim().slice(0, 2).toUpperCase();
}

function normalizeSubFamilyKey(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized.length === 2 ? normalized : '';
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the Mongo filter used by both public and admin product listings.
 * Family matching is exact after trimming. Sub Family matching is global
 * when no Family is supplied and always uses the normalized two-character
 * productId prefix.
 */
function buildCatalogFilter({ family, subFamily } = {}) {
  const filter = {};
  const familyKey = normalizeFamilyKey(family);
  const subFamilyKey = normalizeSubFamilyKey(subFamily);

  if (familyKey) {
    filter.family = new RegExp(`^\\s*${escapeRegex(familyKey)}\\s*$`);
  }

  if (subFamilyKey.length === 2) {
    filter.productId = new RegExp(`^\\s*${escapeRegex(subFamilyKey)}`, 'i');
  }

  return filter;
}

function compareCatalogEntries(left, right) {
  const orderDifference = (left.order ?? 0) - (right.order ?? 0);
  if (orderDifference !== 0) return orderDifference;

  return String(left.displayName || left.key).localeCompare(
    String(right.displayName || right.key),
    undefined,
    { sensitivity: 'base' },
  );
}

function productSummary(product) {
  return {
    _id: product._id,
    name: product.name || '',
    productId: product.productId,
    serialNumber: product.serialNumber,
    slug: product.slug || null,
    isActive: Boolean(product.isActive),
    isEcommerce: Boolean(product.isEcommerce),
    status: product.status,
  };
}

function buildFamilyTree(products = [], configs = [], { isAdmin = false } = {}) {
  const configByFamily = new Map(
    configs.map((config) => [normalizeFamilyKey(config.familyKey), config]),
  );
  const grouped = new Map();

  for (const product of products) {
    const familyKey = normalizeFamilyKey(product.family);
    const subFamilyKey = deriveSubFamily(product.productId);

    if (!familyKey || subFamilyKey.length !== 2) continue;

    if (!grouped.has(familyKey)) {
      grouped.set(familyKey, new Map());
    }

    const subFamilies = grouped.get(familyKey);
    if (!subFamilies.has(subFamilyKey)) {
      subFamilies.set(subFamilyKey, []);
    }
    subFamilies.get(subFamilyKey).push(product);
  }

  const families = [];

  for (const [familyKey, groupedSubFamilies] of grouped) {
    const config = configByFamily.get(familyKey);
    const familyIsActive = config?.isActive ?? true;

    if (!isAdmin && !familyIsActive) continue;

    const configuredSubFamilies = new Map(
      (config?.subFamilies || []).map((subFamily) => [
        normalizeSubFamilyKey(subFamily.key),
        subFamily,
      ]),
    );

    const subFamilies = [];
    let familyProductCount = 0;

    for (const [subFamilyKey, groupedProducts] of groupedSubFamilies) {
      const subConfig = configuredSubFamilies.get(subFamilyKey);
      const subFamilyIsActive = subConfig?.isActive ?? true;
      familyProductCount += groupedProducts.length;

      if (!isAdmin && !subFamilyIsActive) continue;

      const sortedProducts = [...groupedProducts].sort((left, right) => {
        const idComparison = String(left.productId || '').localeCompare(
          String(right.productId || ''),
          undefined,
          { numeric: true, sensitivity: 'base' },
        );
        if (idComparison !== 0) return idComparison;
        return String(left.name || '').localeCompare(String(right.name || ''));
      });

      const entry = {
        key: subFamilyKey,
        displayName: subConfig?.displayName || subFamilyKey,
        description: subConfig?.description || '',
        image: subConfig?.image || null,
        isActive: subFamilyIsActive,
        order: subConfig?.order ?? 0,
        productCount: sortedProducts.length,
      };

      if (isAdmin) {
        entry.products = sortedProducts.map(productSummary);
      }

      subFamilies.push(entry);
    }

    subFamilies.sort(compareCatalogEntries);

    families.push({
      key: familyKey,
      displayName: config?.displayName || familyKey,
      description: config?.description || '',
      image: config?.image || null,
      isActive: familyIsActive,
      order: config?.order ?? 0,
      seo: config?.seo || {},
      productCount: familyProductCount,
      subFamilies,
    });
  }

  return families.sort(compareCatalogEntries);
}

function publicProductQuery() {
  return {
    isActive: true,
    isEcommerce: { $in: [false, null] },
  };
}

async function discoverFamilies({ isAdmin = false, familyKey } = {}) {
  const productQuery = isAdmin ? {} : publicProductQuery();
  Object.assign(productQuery, buildCatalogFilter({ family: familyKey }));

  const products = await Product.find(productQuery)
    .select('name productId family serialNumber slug isActive isEcommerce status')
    .lean();

  const discoveredFamilyKeys = [
    ...new Set(products.map((product) => normalizeFamilyKey(product.family)).filter(Boolean)),
  ];
  const configs = discoveredFamilyKeys.length
    ? await FamilyConfig.find({ familyKey: { $in: discoveredFamilyKeys } }).lean()
    : [];

  return buildFamilyTree(products, configs, { isAdmin });
}

module.exports = {
  buildCatalogFilter,
  buildFamilyTree,
  deriveSubFamily,
  discoverFamilies,
  normalizeFamilyKey,
  normalizeSubFamilyKey,
  publicProductQuery,
};
