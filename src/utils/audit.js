const SECRET_KEYS = new Set([
  'password', 'oldpassword', 'newpassword', 'confirmpassword', 'token',
  'accesstoken', 'refreshtoken', 'authorization', 'cookie', 'authkey', 'secret',
]);

const LABELS = {
  isActive: 'Active', isEcommerce: 'Ecommerce', subFamily: 'Sub Family',
  family: 'Family', productId: 'Product ID', fullName: 'Name',
  assignedAdmin: 'Assigned Admin', assignedTo: 'Assigned To',
  productPrice: 'Price', seo: 'SEO',
};

function plain(value) {
  if (value == null) return value;
  if (value.toObject) return value.toObject({ depopulate: true, getters: false, virtuals: false });
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  return value;
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SECRET_KEYS.has(key.toLowerCase().replace(/[-_]/g, '')))
    .map(([key, item]) => [key, redact(item)]));
}

function same(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    if (value._id) return String(value._id);
    return Object.fromEntries(Object.keys(value).sort().filter((key) => !['_id', '__v', 'createdAt', 'updatedAt'].includes(key)).map((key) => [key, normalize(value[key])]));
  }
  return value;
}

function labelFor(field) {
  const parts = field.split('.');
  const leaf = parts.pop();
  const label = LABELS[leaf] || leaf.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  if (parts.length === 1 && parts[0] === 'prices') return label;
  if (parts.length === 1 && parts[0] === 'seo') return `SEO ${label}`;
  return parts.length ? `${parts.map((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())).join(' ')} ${label}` : label;
}

function diff(before, after, prefix = '') {
  const left = plain(before) || {};
  const right = plain(after) || {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changes = [];
  for (const field of keys) {
    if (['_id', '__v', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'statusHistory', 'assignmentHistory'].includes(field) || SECRET_KEYS.has(field.toLowerCase().replace(/[-_]/g, ''))) continue;
    const path = prefix ? `${prefix}.${field}` : field;
    const a = left[field]; const b = right[field];
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b) && !(a instanceof Date) && !(b instanceof Date)) {
      changes.push(...diff(a, b, path));
    } else if (!same(a, b)) {
      changes.push({ field: path, label: labelFor(path), before: redact(a), after: redact(b) });
    }
  }
  return changes;
}

function entityFor(target, value = {}) {
  const item = plain(value) || {};
  const entity = {};
  const candidates = ['name', 'title', 'email', 'fullName', 'serialNumber', 'productId', 'slug', 'family', 'subFamily'];
  for (const key of candidates) if (item[key] !== undefined) entity[key] = item[key];
  entity.id = item._id || item.id;
  if (target === 'SubFamily' && item.family?.name) entity.familyName = item.family.name;
  return redact(entity);
}

function buildUpdateDetails(target, before, after, summary) {
  const changes = diff(before, after);
  const entity = entityFor(target, after);
  return { summary: summary || `${target} updated${entity.name || entity.title ? `: ${entity.name || entity.title}` : ''}`, entity, changedFields: changes.map((change) => change.field), changes };
}

function buildEntityDetails(target, value, summary, extra = {}) {
  const entity = entityFor(target, value);
  return { summary: summary || `${target} ${entity.name || entity.title || entity.email || entity.id || ''} ${extra.deleted ? 'deleted' : 'created'}`.trim(), entity, changedFields: [], changes: [], ...redact(extra) };
}

module.exports = { diff, redact, plain, entityFor, buildUpdateDetails, buildEntityDetails, labelFor };
