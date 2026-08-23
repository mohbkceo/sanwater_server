/**
 * One-time migration script: rename the `orders.*` permission strings to
 * `quotations.*` on existing users.
 *
 * Context: the Orders feature (order.model.js/orderController.js) was never
 * actually wired to a route and had 0 documents in production, so it's been
 * replaced outright by the Quotation system (see models/quotation.model.js).
 * `PERMISSIONS.ORDERS` in config/permissions.js was renamed to
 * `PERMISSIONS.QUOTATIONS` to match — this script updates any user who
 * already had the old permission strings stored so they don't silently lose
 * access to the equivalent (now renamed) feature.
 *
 * Idempotent: safe to run more than once.
 *
 * Usage:
 *   node src/scripts/migrate-orders-to-quotations-permission.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const RENAME_MAP = {
  'orders.view': 'quotations.view',
  'orders.manage': 'quotations.manage',
};

async function migrate() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('MONGO_URI environment variable is required.');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.');

  const collection = mongoose.connection.db.collection('users');
  const affected = await collection.find({ permissions: { $in: Object.keys(RENAME_MAP) } }).toArray();
  console.log(`Found ${affected.length} user(s) with legacy orders.* permissions.`);

  for (const user of affected) {
    const renamed = user.permissions.map(p => RENAME_MAP[p] || p);
    // De-dupe in case a user somehow already had both the old and new string.
    const deduped = [...new Set(renamed)];
    await collection.updateOne({ _id: user._id }, { $set: { permissions: deduped } });
    console.log(`Migrated ${user.email}: orders.* -> quotations.*`);
  }

  console.log('Migration completed successfully.');
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
