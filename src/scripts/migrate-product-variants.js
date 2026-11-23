require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/product.model");
const { migrateVariants } = require("../services/products/migrateVariants");
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(
      "Usage: node src/scripts/migrate-product-variants.js [--dry-run | --apply]\nDefault: dry run; no database or index writes. --apply creates declared indexes and converts eligible records.\n",
    );
    return;
  }
  if (
    args.some((arg) => !["--dry-run", "--apply"].includes(arg)) ||
    (args.includes("--dry-run") && args.includes("--apply"))
  )
    throw new Error("Choose exactly one mode: --dry-run or --apply");
  const uri =
    process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!uri)
    throw new Error(
      "Set MONGO_URI or MONGODB_URI to the reviewed target database",
    );
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  try {
    if (process.argv.includes("--apply")) await Product.createIndexes();
    // No writes unless --apply was explicitly supplied.
    const summary = await migrateVariants({
      Product,
      dryRun: !process.argv.includes("--apply"),
      onRecord: (row) => process.stdout.write(`${JSON.stringify(row)}\n`),
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.failed) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
