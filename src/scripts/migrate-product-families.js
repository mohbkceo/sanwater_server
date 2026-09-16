/**
 * Explicit, one-time catalog migration.
 *
 * - Backfills missing slugs and publication status without overwriting values.
 * - Removes only the obsolete Product classification fields: category,
 *   subcategory, collectionRef, and collection.
 * - Leaves family, productId, serialNumber, prices, gallery, specifications,
 *   documents, and every legacy Category/Collection document untouched.
 *
 * This script is never run during server startup. Review a database backup and
 * run it manually with:
 *   MONGO_URI=<your mongo uri> npm run migrate:catalog
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const Product = require('../models/product.model');

function generateSlug(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

async function uniqueSlugFor(baseText, currentId) {
  const baseSlug = generateSlug(baseText) || `product-${currentId}`;
  let slug = baseSlug;
  let counter = 1;

  while (await Product.exists({ slug, _id: { $ne: currentId } })) {
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  return slug;
}

async function migrate() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI environment variable is required.');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const products = await Product.find({});
  let slugsAssigned = 0;
  let statusesAssigned = 0;

  for (const product of products) {
    const updates = {};

    if (!product.slug) {
      updates.slug = await uniqueSlugFor(
        product.name || product.productId || product.serialNumber,
        product._id,
      );
      slugsAssigned += 1;
    }

    if (!product.status) {
      updates.status = product.isActive ? 'published' : 'draft';
      statusesAssigned += 1;
    }

    if (Object.keys(updates).length > 0) {
      // Raw update intentionally avoids making legacy rows pass today's
      // stricter Family/Product ID validation just to receive safe backfills.
      await Product.collection.updateOne({ _id: product._id }, { $set: updates });
    }
  }

  const cleanup = await Product.collection.updateMany(
    {
      $or: [
        { category: { $exists: true } },
        { subcategory: { $exists: true } },
        { collectionRef: { $exists: true } },
        { collection: { $exists: true } },
      ],
    },
    {
      $unset: {
        category: '',
        subcategory: '',
        collectionRef: '',
        collection: '',
      },
    },
  );

  console.log(`Products scanned: ${products.length}`);
  console.log(`Slugs assigned: ${slugsAssigned}`);
  console.log(`Statuses assigned: ${statusesAssigned}`);
  console.log(`Products cleaned of legacy classification fields: ${cleanup.modifiedCount}`);
  console.log('Legacy Category and Collection documents were not changed.');

  await mongoose.disconnect();
}

migrate().catch(async (error) => {
  console.error('Catalog migration failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
