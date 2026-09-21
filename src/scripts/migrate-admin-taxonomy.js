/**
 * Manual, idempotent migration from legacy Product.family strings and the
 * first two productId characters to persisted Family/SubFamily references.
 * FamilyConfig is read only as presentation metadata; runtime code never uses it.
 *
 *   npm run migrate:admin-taxonomy -- --dry-run
 *   npm run migrate:admin-taxonomy
 */
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const Family = require('../models/family.model');
const SubFamily = require('../models/subFamily.model');
const slugify = require('../utils/slugify');

const dryRun = process.argv.includes('--dry-run');

async function uniqueFamilySlug(base) {
  let candidate = slugify(base) || 'family';
  let counter = 2;
  while (await Family.exists({ slug: candidate })) candidate = `${slugify(base)}-${counter++}`;
  return candidate;
}

async function migrate() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI environment variable is required.');
  await mongoose.connect(process.env.MONGO_URI);

  const productsCollection = mongoose.connection.collection('productschemas');
  const legacyConfigs = await mongoose.connection.collection('familyconfigs').find({}).toArray();
  const configByKey = new Map(legacyConfigs.map((entry) => [String(entry.familyKey || '').trim(), entry]));
  const products = await productsCollection.find({}).toArray();
  const report = {
    productsScanned: products.length,
    familiesCreated: 0,
    subFamiliesCreated: 0,
    productsAssigned: 0,
    legacyProductFieldsRemoved: 0,
    productsSkipped: 0,
    errors: 0,
  };
  const familyCache = new Map();
  const subFamilyCache = new Map();

  for (const product of products) {
    try {
      if (product.family instanceof mongoose.Types.ObjectId && product.subFamily instanceof mongoose.Types.ObjectId) {
        if (['category', 'subcategory', 'collection', 'collectionRef'].some((key) => key in product)) {
          report.legacyProductFieldsRemoved += 1;
          if (!dryRun) {
            await productsCollection.updateOne(
              { _id: product._id },
              { $unset: { category: '', subcategory: '', collection: '', collectionRef: '' } },
            );
          }
        }
        report.productsSkipped += 1;
        continue;
      }
      const legacyFamily = typeof product.family === 'string' ? product.family.trim() : '';
      const legacySubFamily = String(product.productId || '').trim().slice(0, 2).toUpperCase();
      if (!legacyFamily || legacySubFamily.length !== 2) {
        report.productsSkipped += 1;
        continue;
      }

      const config = configByKey.get(legacyFamily);
      const familyName = config?.displayName || legacyFamily;
      const expectedFamilySlug = slugify(familyName);
      let family = familyCache.get(legacyFamily);
      if (!family) {
        family = await Family.findOne({ $or: [{ legacyKey: legacyFamily }, { slug: expectedFamilySlug }] });
        if (!family) {
          report.familiesCreated += 1;
          const data = {
            name: familyName,
            slug: dryRun ? expectedFamilySlug : await uniqueFamilySlug(familyName),
            description: config?.description || '', image: config?.image || null,
            order: config?.order || 0, isActive: config?.isActive ?? true,
            seo: config?.seo || {}, legacyKey: legacyFamily,
          };
          family = dryRun ? { _id: new mongoose.Types.ObjectId(), ...data } : await Family.create(data);
        } else if (!dryRun && !family.legacyKey) {
          family.legacyKey = legacyFamily;
          await family.save();
        }
        familyCache.set(legacyFamily, family);
      }

      const cacheKey = `${family._id}:${legacySubFamily}`;
      let subFamily = subFamilyCache.get(cacheKey);
      if (!subFamily) {
        const subConfig = (config?.subFamilies || []).find((entry) => entry.key === legacySubFamily);
        const subFamilyName = subConfig?.displayName || legacySubFamily;
        subFamily = await SubFamily.findOne({
          family: family._id,
          $or: [{ legacyKey: legacySubFamily }, { slug: slugify(subFamilyName) }],
        });
        if (!subFamily) {
          report.subFamiliesCreated += 1;
          const data = {
            name: subFamilyName,
            slug: slugify(subFamilyName),
            family: family._id,
            description: subConfig?.description || '', image: subConfig?.image || null,
            order: subConfig?.order || 0, isActive: subConfig?.isActive ?? true,
            legacyKey: legacySubFamily,
          };
          subFamily = dryRun ? { _id: new mongoose.Types.ObjectId(), ...data } : await SubFamily.create(data);
        } else if (!dryRun && !subFamily.legacyKey) {
          subFamily.legacyKey = legacySubFamily;
          await subFamily.save();
        }
        subFamilyCache.set(cacheKey, subFamily);
      }

      if (!dryRun) {
        await productsCollection.updateOne(
          { _id: product._id },
          {
            $set: { family: family._id, subFamily: subFamily._id },
            $unset: { category: '', subcategory: '', collection: '', collectionRef: '' },
          },
        );
      }
      report.productsAssigned += 1;
      if (['category', 'subcategory', 'collection', 'collectionRef'].some((key) => key in product)) {
        report.legacyProductFieldsRemoved += 1;
      }
    } catch (error) {
      report.errors += 1;
      console.error(`Product ${product._id} failed: ${error.message}`);
    }
  }

  console.log(dryRun ? 'DRY RUN — no database writes performed' : 'Migration complete');
  console.log(`Products scanned: ${report.productsScanned}`);
  console.log(`Families created: ${report.familiesCreated}`);
  console.log(`Sub Families created: ${report.subFamiliesCreated}`);
  console.log(`Products assigned: ${report.productsAssigned}`);
  console.log(`Products cleaned of legacy classification fields: ${report.legacyProductFieldsRemoved}`);
  console.log(`Products skipped: ${report.productsSkipped}`);
  console.log(`Errors: ${report.errors}`);
  console.log('Legacy familyconfigs were copied where available and left untouched as a rollback artifact.');
  await mongoose.disconnect();
}

migrate().catch(async (error) => {
  console.error('Taxonomy migration failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
