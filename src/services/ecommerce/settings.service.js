const mongoose = require("mongoose");
const { CommerceSettings } = require("../../models/commerceSupport.model");
const { assert } = require("./domain");

// Admin-editable store switches. Each value comes from the saved settings
// document once an admin has set it; until then the environment variable is
// the default (ECOMMERCE_CHECKOUT_ENABLED, ECOMMERCE_PARTIAL_PAYMENTS).
const ID = "store";
const KEYS = Object.freeze({
  checkoutEnabled: "ECOMMERCE_CHECKOUT_ENABLED",
  partialPaymentsEnabled: "ECOMMERCE_PARTIAL_PAYMENTS",
});
const HISTORY_LIMIT = 100;

function resolve(doc) {
  const values = {};
  const sources = {};
  for (const [key, env] of Object.entries(KEYS)) {
    const saved = typeof doc?.[key] === "boolean";
    values[key] = saved ? doc[key] : process.env[env] === "true";
    sources[key] = saved ? "admin" : "environment";
  }
  return {
    ...values,
    sources,
    revision: doc?.revision || 0,
    updatedAt: doc?.updatedAt || null,
    updatedBy: doc?.updatedBy || null,
  };
}

async function current() {
  // Without a database connection nothing can be ordered or saved anyway;
  // answer from the defaults instead of waiting on Mongoose's buffer.
  if (mongoose.connection.readyState !== 1) return resolve(null);
  return resolve(await CommerceSettings.findById(ID).lean());
}

async function checkoutEnabled() {
  return (await current()).checkoutEnabled;
}

async function partialPaymentsEnabled() {
  return (await current()).partialPaymentsEnabled;
}

// A capability of the MongoDB deployment (replica set or mongos), not a
// setting: order writes fail closed without it, so it is only reported.
async function transactionsAvailable() {
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    return Boolean(hello.setName || hello.msg === "isdbgrid");
  } catch {
    return false;
  }
}

// Compare-and-swap on `revision`, so two admins cannot overwrite each other.
async function update(changes, revision, user) {
  const set = Object.fromEntries(
    Object.keys(KEYS)
      .filter((key) => typeof changes[key] === "boolean")
      .map((key) => [key, changes[key]]),
  );
  assert(Object.keys(set).length > 0, "No setting to change", 400);
  if (set.checkoutEnabled === true)
    assert(
      await transactionsAvailable(),
      "Checkout needs MongoDB transactions (a replica set). The database configuration was not changed.",
      409,
      "TRANSACTIONS_REQUIRED",
    );
  const before = await current();
  const filter =
    revision === 0
      ? { _id: ID, $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { _id: ID, revision };
  const entry = {
    actor: user.uid,
    at: new Date(),
    revision: revision + 1,
    changes: Object.fromEntries(
      Object.entries(set).map(([key, value]) => [key, { before: before[key], after: value }]),
    ),
  };
  let doc;
  try {
    doc = await CommerceSettings.findOneAndUpdate(
      filter,
      {
        $set: { ...set, updatedBy: user.uid },
        $inc: { revision: 1 },
        $push: { history: { $each: [entry], $slice: -HISTORY_LIMIT } },
      },
      { new: true, upsert: revision === 0, setDefaultsOnInsert: false, lean: true },
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  assert(doc, "Settings changed. Reload before saving.", 409, "STALE_REVISION");
  return { settings: resolve(doc), before, changes: entry.changes };
}

module.exports = {
  KEYS,
  current,
  checkoutEnabled,
  partialPaymentsEnabled,
  transactionsAvailable,
  update,
};
