/**
 * One-time, idempotent migration: backfill catalog foundation fields on
 * existing products after the Product schema was extended with
 * slug/status/category/etc.
 *
 * What it does (safe, additive, non-destructive):
 *  - Adds a `slug` to any product missing one (derived from name, falling
 *    back to productId/serialNumber), guaranteed unique.
 *  - Sets `status` from the existing `isActive` flag where `status` isn't
 *    already set (isActive:true -> 'published', isActive:false -> 'draft').
 *    `isActive` itself is left untouched — nothing that currently depends
 *    on it (e-commerce queries) changes behavior.
 *  - Does NOT create Category/Collection documents and does NOT guess a
 *    product's category from the `family` field: `family` today looks like
 *    a product-line/series code (e.g. "SM"), not a verified business
 *    category (e.g. "Robinetterie"), so assigning one would be inventing a
 *    business fact. Instead this script prints the distinct `family` values
 *    in use so a human can create the real categories via the admin UI and
 *    assign them deliberately.
 *
 * Nothing is deleted and no existing field is overwritten, so this script
 * can be safely re-run (it only fills gaps) and requires no rollback.
 *
 * Usage:
 *   MONGO_URI=<your mongo uri> node src/scripts/migrate-product-catalog.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const Product = require('../models/product.model');

function generateSlug(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

async function uniqueSlugFor(baseText, currentId) {
  let baseSlug = generateSlug(baseText) || `product-${currentId}`;
  let slug = baseSlug;
  let counter = 1;
  while (await Product.exists({ slug, _id: { $ne: currentId } })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  return slug;
}

async function migrate() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('MONGO_URI environment variable is required.');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.');

  const products = await Product.find({});
  console.log(`Found ${products.length} product(s).`);

  const familyValues = new Set();
  let slugsAssigned = 0;
  let statusesAssigned = 0;

  for (const product of products) {
    let changed = false;

    if (product.family) familyValues.add(product.family);

    if (!product.slug) {
      product.slug = await uniqueSlugFor(product.name || product.productId || product.serialNumber, product._id);
      slugsAssigned++;
      changed = true;
    }

    if (!product.status) {
      product.status = product.isActive ? 'published' : 'draft';
      statusesAssigned++;
      changed = true;
    }

    if (changed) {
      await product.save();
      console.log(`Updated ${product.serialNumber}: slug="${product.slug}" status="${product.status}"`);
    }
  }

  console.log('\n--- Migration summary ---');
  console.log(`Slugs assigned: ${slugsAssigned}`);
  console.log(`Statuses assigned: ${statusesAssigned}`);
  console.log('\nDistinct `family` values found in the catalog (review these to decide');
  console.log('the real product categories, then create them in the admin UI and assign');
  console.log('each product to one — this script deliberately does not guess):');
  console.log([...familyValues].sort().join(', ') || '(none)');
  console.log('\nMigration completed successfully.');

  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
