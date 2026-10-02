require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/user.model');
const { PERMISSIONS } = require('../config/permissions');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  let changed = 0;
  const users = User.find({ role: 'admin' }).select('permissions persona').cursor();
  for await (const user of users) {
    const permissions = new Set(user.permissions || []);
    if (permissions.has(PERMISSIONS.ANALYTICS.VIEW)) {
      // The old analytics.view exposed the full shared dashboard. Preserve that
      // read scope explicitly; new export/configure/explore rights are not granted.
      for (const key of ['OVERVIEW', 'MARKETING', 'PRODUCTS', 'SALES', 'HIRING', 'CONTENT']) permissions.add(PERMISSIONS.ANALYTICS[key]);
    }
    const next = [...permissions];
    if (next.length !== (user.permissions || []).length || !user.persona) {
      user.permissions = next;
      user.persona = user.persona || 'general_admin';
      await user.save();
      changed++;
    }
  }
  console.log(`Analytics permission migration updated ${changed} admins`);
  await mongoose.disconnect();
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; mongoose.disconnect().catch(() => {}); });
module.exports = { run };
