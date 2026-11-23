// Read-only by default. Never invoked by startup or checkout cutover.
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();
const mongoose = require("mongoose");
const Quotation = require("../models/quotation.model");
const Order = require("../models/ecommerceOrder.model");
const migration = require("../services/ecommerce/migration.service");
async function main() {
  const apply = process.argv.includes("--apply");
  const backupArg = process.argv.indexOf("--backup");
  if (
    apply &&
    (backupArg < 0 ||
      !fs.existsSync(path.resolve(process.argv[backupArg + 1] || "")) ||
      !fs.statSync(path.resolve(process.argv[backupArg + 1])).isFile())
  )
    throw new Error(
      "--apply requires --backup <verified backup manifest file>",
    );
  if (apply && !process.argv.includes("--authorized"))
    throw new Error(
      "Production migration requires explicit authorization; pass --authorized only after approval and backup verification",
    );
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });
  if (apply && !await Order.collection.indexExists('sourceRecord_1')) throw new Error('Provision and verify the new unique order indexes before applying a migration');
  const results = [];
  for await (const record of Quotation.find().lean().cursor()) {
    let result = migration.classify(record);
    const existing = await Order.findOne({
      sourceRecord: `quotation:${record._id}`,
    })
      .select("orderNumber")
      .lean();
    if (existing)
      result = { action: "ALREADY_LINKED", orderNumber: existing.orderNumber };
    if (apply && result.action === "ELIGIBLE") {
      try {
        const order = await migration.migrate(record);
        result = { action: "MIGRATED", orderNumber: order.orderNumber };
      } catch (error) {
        result = { action: "ERROR", reason: error.message };
      }
    }
    results.push({ quotationId: String(record._id), ...result });
  }
  // Report has identifiers and decisions, no customer PII.
  process.stdout.write(
    JSON.stringify({ mode: apply ? "apply" : "dry-run", results }, null, 2),
  );
}
if (require.main === module)
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
