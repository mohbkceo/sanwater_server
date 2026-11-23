// This pure contract is also shipped as client/src/lib/productVariants.js.
const MAX_VARIANTS = 100;
const MAX_OPTIONS = 4;
function invalid(message, field = "variantsV2") {
  const error = new Error(message);
  Object.assign(error, {
    statusCode: 422,
    key: "INVALID_VARIANTS",
    fields: { [field]: message },
  });
  throw error;
}
const normalized = (value) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase("en");
const unique = (values) => new Set(values).size === values.length;
const combinationKey = (selections) =>
  JSON.stringify(
    selections
      .map((s) => [s.optionId, s.valueId])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
const moneyValid = (value) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  Number.isSafeInteger(Math.round(value * 100)) &&
  Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
const effectivePrice = (variant, basePrice) =>
  variant?.priceOverride ?? basePrice;
const available = (variant) =>
  variant.isAvailable !== false &&
  (!variant.trackInventory || variant.stockQuantity > 0);
const imageFor = (variant, gallery = []) =>
  variant?.imageUrl || gallery[0] || null;
function validateOptions(options) {
  if (!Array.isArray(options) || options.length > MAX_OPTIONS)
    invalid("Maximum four options", "variantOptions");
  if (
    !unique(options.map((o) => o.id)) ||
    !unique(options.map((o) => normalized(o.name)))
  )
    invalid("Duplicate option", "variantOptions");
  let count = options.length ? 1 : 0;
  for (const option of options) {
    if (
      !/^[\w-]{1,100}$/.test(option.id || "") ||
      !String(option.name || "").trim() ||
      option.name.length > 100 ||
      !["color", "size", "material", "finish", "custom"].includes(option.type)
    )
      invalid("Invalid option", "variantOptions");
    if (
      !Array.isArray(option.values) ||
      !option.values.length ||
      option.values.length > 20
    )
      invalid("Each option needs 1–20 values", "variantOptions");
    if (
      !unique(option.values.map((v) => v.id)) ||
      !unique(option.values.map((v) => normalized(v.label)))
    )
      invalid("Duplicate option value", "variantOptions");
    for (const value of option.values) {
      if (
        !/^[\w-]{1,100}$/.test(value.id || "") ||
        !String(value.label || "").trim() ||
        value.label.length > 100
      )
        invalid("Invalid option value", "variantOptions");
      if (value.swatchHex && !/^#[0-9a-f]{6}$/i.test(value.swatchHex))
        invalid("Invalid color hex", "variantOptions");
    }
    count *= option.values.length;
    if (count > MAX_VARIANTS)
      invalid(`Maximum ${MAX_VARIANTS} combinations`, "variantOptions");
  }
  return count;
}
function generateCombinations(
  options,
  existing = [],
  makeId = () => globalThis.crypto.randomUUID(),
) {
  validateOptions(options);
  if (!options.length) return { variants: [], removed: existing };
  let combinations = [[]];
  for (const option of options)
    combinations = combinations.flatMap((row) =>
      option.values.map((value) => [
        ...row,
        { optionId: option.id, valueId: value.id },
      ]),
    );
  const old = new Map(existing.map((v) => [combinationKey(v.selections), v]));
  const variants = combinations.map((selections, sortOrder) => {
    const previous = old.get(combinationKey(selections));
    const id = previous?.id || makeId();
    return {
      id,
      sku: `SW-${id.toUpperCase()}`,
      priceOverride: null,
      trackInventory: false,
      stockQuantity: 0,
      isAvailable: true,
      imageUrl: null,
      ...previous,
      selections,
      sortOrder,
    };
  });
  const keys = new Set(variants.map((v) => combinationKey(v.selections)));
  return {
    variants,
    removed: existing.filter((v) => !keys.has(combinationKey(v.selections))),
  };
}
function validateVariants(options, variants, gallery = []) {
  const count = validateOptions(options);
  if (
    !Array.isArray(variants) ||
    variants.length > MAX_VARIANTS ||
    (options.length ? variants.length !== count : variants.length > 1)
  )
    invalid("Variants must cover all option combinations");
  if (!unique(variants.map((v) => v.id))) invalid("Duplicate variant identity");
  if (!unique(variants.map((v) => v.sku))) invalid("Duplicate SKU");
  if (!unique(variants.map((v) => combinationKey(v.selections))))
    invalid("Duplicate combination");
  for (const variant of variants) {
    if (!/^[\w-]{1,100}$/.test(variant.id || ""))
      invalid("Invalid variant identity");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(variant.sku || ""))
      invalid("SKU must use letters, numbers, dot, dash or underscore");
    if (variant.priceOverride !== null && !moneyValid(variant.priceOverride))
      invalid("Price must be nonnegative DZD with at most two decimals");
    if (
      !Number.isSafeInteger(variant.stockQuantity) ||
      variant.stockQuantity < 0
    )
      invalid("Stock must be a nonnegative integer");
    if (
      typeof variant.trackInventory !== "boolean" ||
      typeof variant.isAvailable !== "boolean"
    )
      invalid("Availability and inventory tracking must be explicit");
    if (
      variant.selections.length !== options.length ||
      !unique(variant.selections.map((s) => s.optionId))
    )
      invalid("Select each option exactly once");
    for (const selection of variant.selections) {
      if (
        !options
          .find((o) => o.id === selection.optionId)
          ?.values.some((v) => v.id === selection.valueId)
      )
        invalid("Orphan option/value reference");
    }
    if (variant.imageUrl && !gallery.includes(variant.imageUrl))
      invalid("Variant image must reference the product gallery");
  }
  return true;
}
// Stable across dry runs and retries. Labels are used only at initial conversion.
function stableId(seed) {
  let hash = 2166136261;
  for (const char of String(seed))
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `legacy-${(hash >>> 0).toString(16)}`;
}
function convertLegacy(product) {
  if (product.variantSchemaVersion === 2)
    return {
      variantOptions: product.variantOptions || [],
      variantsV2: product.variantsV2 || [],
    };
  const source = String(product._id || product.serialNumber || "legacy");
  const commerce = product.commerce;
  const groups = commerce?.variants?.length
    ? (commerce.options || []).map((o) => ({
        variantType: o.name,
        variants: o.values.map((variantData) => ({ variantData })),
      }))
    : product.productVariants || [];
  const options = [];
  for (const [index, group] of groups.entries()) {
    if (!group || typeof group !== "object") continue;
    const name = String(group.variantType || "Option").trim();
    const existing = options.find(
      (o) => normalized(o.name) === normalized(name),
    );
    const option = existing || {
      id: stableId(`${source}:option:${index}`),
      name,
      type: ["color", "size", "material", "finish"].includes(normalized(name))
        ? normalized(name)
        : "custom",
      values: [],
    };
    for (const raw of group.variants || []) {
      const label =
        typeof raw?.variantData === "string" ? raw.variantData.trim() : "";
      if (
        label &&
        !option.values.some((v) => normalized(v.label) === normalized(label))
      )
        option.values.push({
          id: stableId(`${option.id}:${normalized(label)}`),
          label,
        });
    }
    if (option.values.length && !existing) options.push(option);
  }
  const converted = generateCombinations(
    options,
    [],
    () => "temporary",
  ).variants.map((v) => {
    const old = commerce?.variants?.find((row) =>
      options.every(
        (o) =>
          row.options?.[o.name] ===
          o.values.find((x) =>
            v.selections.some((s) => s.optionId === o.id && s.valueId === x.id),
          )?.label,
      ),
    );
    if (commerce?.variants?.length && !old)
      invalid("Incomplete commerce combinations require manual review");
    const id = old?.id || stableId(`${source}:${combinationKey(v.selections)}`);
    return {
      ...v,
      id,
      sku:
        old?.sku ||
        `SW-${source
          .replace(/[^\w-]/g, "")
          .slice(-24)
          .toUpperCase()}-${id.toUpperCase()}`,
      priceOverride: old?.price ?? null,
      trackInventory: old?.trackStock ?? false,
      stockQuantity: old?.quantity ?? 0,
      isAvailable: old?.enabled ?? true,
      imageUrl: old?.image || null,
    };
  });
  if (!options.length && commerce?.variants?.length === 1) {
    const v = commerce.variants[0];
    converted.push({
      id: v.id,
      sku: v.sku,
      selections: [],
      priceOverride: v.price ?? null,
      trackInventory: v.trackStock,
      stockQuantity: v.quantity,
      isAvailable: v.enabled,
      imageUrl: v.image || null,
      sortOrder: 0,
    });
  }
  if (
    commerce?.variants?.length &&
    converted.length !== commerce.variants.length
  )
    invalid("Malformed commerce variants require manual review");
  validateVariants(options, converted, product.gallery || []);
  return { variantOptions: options, variantsV2: converted };
}
function legacyProjection(options) {
  return options.map((o) => ({
    variantType: o.name,
    variants: o.values.map((v) => ({ variantData: v.label })),
  }));
}
function commerceProjection(product) {
  const options = product.variantOptions || [];
  return {
    ...(product.commerce || {}),
    options: options.map((o) => ({
      name: o.name,
      values: o.values.map((v) => v.label),
    })),
    variants: (product.variantsV2 || []).map((v) => ({
      id: v.id,
      sku: v.sku,
      options: Object.fromEntries(
        v.selections.map((s) => {
          const o = options.find((x) => x.id === s.optionId);
          return [o.name, o.values.find((x) => x.id === s.valueId).label];
        }),
      ),
      price: v.priceOverride,
      image: v.imageUrl || "",
      enabled: v.isAvailable,
      trackStock: v.trackInventory,
      quantity: v.stockQuantity,
    })),
  };
}
function readiness(product) {
  const required = {
    name: Boolean(product.name?.trim()),
    productId: Boolean(product.productId?.trim()),
    price: moneyValid(product.prices?.productPrice),
    classification: Boolean(product.family && product.subFamily),
    image: Boolean(product.gallery?.length),
    variants: true,
  };
  try {
    if (product.variantSchemaVersion === 2)
      validateVariants(
        product.variantOptions || [],
        product.variantsV2 || [],
        product.gallery || [],
      );
  } catch {
    required.variants = false;
  }
  return {
    required,
    ready: Object.values(required).every(Boolean),
    recommended: {
      description: Boolean(product.shortDescription || product.description),
    },
  };
}
function summary(product) {
  const rows =
    product.variantSchemaVersion === 2
      ? product.variantsV2 || []
      : (product.commerce?.variants || []).map((v) => ({
          priceOverride: v.price,
          trackInventory: v.trackStock,
          stockQuantity: v.quantity,
          isAvailable: v.enabled,
        }));
  const prices = rows.length
    ? rows
        .map((v) => effectivePrice(v, product.prices?.productPrice))
        .filter(moneyValid)
    : [product.prices?.productPrice].filter(moneyValid);
  const stock =
    rows.length && rows.every((v) => v.trackInventory)
      ? rows.some(available)
        ? "inStock"
        : "outOfStock"
      : "untracked";
  const state =
    product.status === "archived"
      ? "archived"
      : product.status === "draft"
        ? "draft"
        : !product.isActive
          ? "hidden"
          : stock === "outOfStock"
            ? "outOfStock"
            : "published";
  return {
    state,
    stock,
    variantCount: rows.length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    readiness: readiness(product),
  };
}
module.exports = {
  MAX_VARIANTS,
  MAX_OPTIONS,
  combinationKey,
  moneyValid,
  effectivePrice,
  available,
  imageFor,
  validateOptions,
  generateCombinations,
  validateVariants,
  convertLegacy,
  legacyProjection,
  commerceProjection,
  readiness,
  summary,
};
