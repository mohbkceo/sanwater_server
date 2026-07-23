/**
 * One-time migration script: role-based -> permission-based access control.
 *
 * What it does:
 *  - super_admin users: kept as super_admin (permissions are implicit / full access).
 *  - admin users: kept as admin, granted the full permission set (they previously
 *    had broad access, so this preserves existing behavior).
 *  - manager users: converted to admin, granted equivalent view/manage permissions
 *    for the operational modules they previously had access to.
 *  - Any other/unknown role: converted to admin with view-only permissions.
 *
 * Usage:
 *   MONGO_URI=<your mongo uri> node src/scripts/migrate-roles-to-permissions.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const User = require('../models/user.model');
const { PERMISSIONS, ALL_PERMISSIONS, ROLES } = require('../config/permissions');

// Managers previously passed the 'manager' minimum-role gate on all
// authenticated routes, so they effectively had operational access to
// products, orders, and content. We grant equivalent permissions.
const MANAGER_EQUIVALENT_PERMISSIONS = [
  PERMISSIONS.ANALYTICS.VIEW,
  PERMISSIONS.PRODUCTS.VIEW,
  PERMISSIONS.PRODUCTS.MANAGE,
  PERMISSIONS.ORDERS.VIEW,
  PERMISSIONS.ORDERS.MANAGE,
  PERMISSIONS.CONTENT.VIEW,
  PERMISSIONS.CONTENT.MANAGE,
];

const VIEW_ONLY_PERMISSIONS = ALL_PERMISSIONS.filter(p => p.endsWith('.view'));

async function migrate() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('MONGO_URI environment variable is required.');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.');

  // Use the raw collection to bypass the new schema enum so we can read legacy roles.
  const collection = mongoose.connection.db.collection('users');
  const users = await collection.find({}).toArray();
  console.log(`Found ${users.length} user(s).`);

  for (const user of users) {
    const update = {};

    if (user.role === ROLES.SUPER_ADMIN) {
      // Super admin remains untouched: role preserved, full access is implicit.
      // Store the full permission list for consistency in UI displays.
      update.permissions = ALL_PERMISSIONS;
    } else if (user.role === ROLES.ADMIN) {
      // Admins previously had broad access; preserve it with the full permission set.
      update.permissions = Array.isArray(user.permissions) && user.permissions.length > 0
        ? user.permissions
        : ALL_PERMISSIONS;
    } else if (user.role === 'manager') {
      update.role = ROLES.ADMIN;
      update.permissions = Array.isArray(user.permissions) && user.permissions.length > 0
        ? user.permissions
        : MANAGER_EQUIVALENT_PERMISSIONS;
    } else {
      // Unknown legacy role: convert to admin with view-only permissions.
      update.role = ROLES.ADMIN;
      update.permissions = Array.isArray(user.permissions) && user.permissions.length > 0
        ? user.permissions
        : VIEW_ONLY_PERMISSIONS;
    }

    await collection.updateOne({ _id: user._id }, { $set: update });
    console.log(`Migrated ${user.email} (${user.role} -> ${update.role || user.role}) with ${update.permissions.length} permission(s).`);
  }

  console.log('Migration completed successfully.');
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
