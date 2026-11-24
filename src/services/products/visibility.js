// Public product visibility policy.
//
// A product sold through E-commerce (salesMode "ecommerce" or "both", or the
// legacy `isEcommerce: true` flag) is never part of the normal public catalog.
// Its only public destination is the dedicated landing page served by
// GET /ecommerce/products/:reference, which applies its own sale-eligibility
// rules. Admin queries never use these filters.
//
// `salesMode` and `isEcommerce` can disagree on older records, so both are
// checked. Records without a stored salesMode remain catalog products unless
// their legacy flag says otherwise.
const COMMERCE_SALES_MODES = Object.freeze(["ecommerce", "both"]);

function isCommerceEnabled(product) {
  return Boolean(
    product &&
      (COMMERCE_SALES_MODES.includes(product.salesMode) ||
        product.isEcommerce === true),
  );
}

// Matches products that are excluded from every public catalog surface.
function commerceEnabledFilter() {
  return {
    $or: [
      { salesMode: { $in: [...COMMERCE_SALES_MODES] } },
      { isEcommerce: true },
    ],
  };
}

// Matches catalog products only (missing salesMode and legacy false/null
// flags included).
function catalogOnlyFilter() {
  return {
    salesMode: { $nin: [...COMMERCE_SALES_MODES] },
    isEcommerce: { $ne: true },
  };
}

// Existing publication rule for the public catalog: active, and either no
// commerce projection or a published one.
function publicationFilter() {
  return {
    isActive: true,
    $or: [
      { commerce: { $exists: false } },
      { commerce: null },
      { "commerce.published": true },
    ],
  };
}

// Everything a public catalog query must satisfy, expressed as $and clauses
// so it composes with other filters that also use $or.
function publicCatalogClauses() {
  return [publicationFilter(), catalogOnlyFilter()];
}

function publicCatalogFilter() {
  return { $and: publicCatalogClauses() };
}

function isPubliclyListed(product) {
  return Boolean(
    product &&
      product.isActive === true &&
      (!product.commerce || product.commerce.published === true) &&
      !isCommerceEnabled(product),
  );
}

module.exports = {
  COMMERCE_SALES_MODES,
  isCommerceEnabled,
  isPubliclyListed,
  commerceEnabledFilter,
  catalogOnlyFilter,
  publicationFilter,
  publicCatalogClauses,
  publicCatalogFilter,
};
