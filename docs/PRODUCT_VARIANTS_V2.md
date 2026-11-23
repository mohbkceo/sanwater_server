# Product variants V2: contract and rollout

Implemented locally on 23 November 2026. No existing database was migrated and no deployment was performed. Automated database tests use disposable MongoDB replica sets.

## Authoritative representation

`variantSchemaVersion: 2` selects `variantOptions` and `variantsV2` as the authoritative catalog configuration. Each option and value has an immutable ID separate from its editable name/label. Each variant has an immutable ID, selected option/value IDs, SKU, nullable DZD price override, inventory tracking flag, integer stock, availability flag, nullable gallery image reference and ordering position.

Combination keys sort option IDs before serialization. Reordering or renaming options or values preserves the combination's identity and operational data. An existing variant ID cannot be reassigned to another combination, and an unchanged combination cannot receive a replacement ID. The builder explicitly reviews removed combinations before applying them.

Limits are **4 options, 20 values per option and 100 combinations**. Complete Cartesian coverage is required. Duplicate IDs, option names, values, combinations, SKUs, orphan selections, invalid prices, negative/fractional stock and images outside the product gallery are rejected on the server. There is no silent truncation. Gallery uploads are limited to 30 images in the editor and product validator.

### SKU policy

SKUs are globally unique, **case-sensitive identifiers**, preserving the existing MongoDB index policy. `SKU-A` and `sku-a` are distinct identifiers. A SKU contains 1–100 ASCII letters, digits, dots, dashes or underscores and begins with a letter or digit. New generated SKUs are uppercase. Conversion preserves existing SKU spelling; option renaming never rewrites it.

The existing unique multikey index on `commerce.variants.sku` enforces uniqueness across products, including concurrent writes. The authoritative V2 configuration is projected to that indexed path in the same product write. Service/model validation rejects duplicate SKUs within one product because MongoDB multikey uniqueness alone does not enforce that case. A database SKU conflict returns HTTP 409 with `DUPLICATE_SKU` and a variant field error. Product references (`productId`) retain their existing separate semantics.

### Prices and inventory

Prices retain their existing **DZD major-unit Number** representation. New input accepts at most two decimal places. No currency-unit migration was introduced. Effective variant price is `priceOverride ?? prices.productPrice`; an explicit zero remains zero. The administration performs no discount or transaction arithmetic of its own.

A variant is available when `isAvailable` is true and either inventory is not tracked or `stockQuantity > 0`. Untracked zero stock does not make a product unavailable. No backorders or fabricated historical stock are introduced. Variant images use a gallery reference and fall back to `gallery[0]`.

Simple products remain free of fake options in the editor. A new E-commerce simple product receives an internal untracked purchase row for compatibility with the already-existing commerce consumer. It is not shown as a fake “Default” option. Existing simple commerce rows retain their real identity/settings when explicitly converted.

Product page views and inquiries never mutate inventory. The repository already contained an operational order lifecycle; its existing transactional inventory movement now updates the commerce projection and V2 stock together. Reserved inventory prevents variant configuration replacement. This work does not introduce checkout, payments, orders, or customers.

## Compatibility and publication

- The existing product routes, serial numbers, IDs, references, stable slugs, gallery, taxonomy, prices, specifications, documents, related products and SEO storage remain available.
- A validated conversion stores the original `productVariants` in `legacyVariantSnapshot`. `productVariants` then becomes a deterministic label projection for older readers. It is never a second editable source of truth.
- The existing `commerce.options` and `commerce.variants` shapes remain available for public and order consumers. Inventory writes keep the two representations synchronized.
- Legacy product reads do not trigger migration. Legacy products without variants remain valid. Legacy group conversion uses deterministic IDs, deduplicates labels and ignores empty entries without inventing inventory. Inconsistent pre-existing commerce combinations require manual review rather than invented replacement stock.
- Structured variant writes require the full V2 configuration. Legacy-only variant updates to converted products return `VARIANTS_V2_REQUIRED`. The legacy commerce editor endpoint also refuses independent edits of converted products; the maintained Products editor is the write path.
- Converted-product updates require `catalogRevision` from the read response. The write compares revision, `updatedAt` and the existing commerce revision, then increments the catalog revision atomically. Stale saves return HTTP 409 and the editor retains the user's input.
- Legacy partial price updates now preserve existing `prices.shippingPrice`. Shipping quotes continue using the geographical tariff service.
- `status`, `isActive`, `isEcommerce`, `salesMode` and commerce publication retain their separate meanings. In particular, `isEcommerce: false` historically means catalog inclusion, not a universal “cannot be sold” flag. Existing public filtering was preserved. Draft/hide/archive editor actions explicitly set the corresponding state and visibility values.
- Publishing active V2 products requires a name, reference, valid base price, family/subfamily, gallery image and valid variants. Descriptions are recommendations, not publishing blockers. Hiding an incomplete product remains possible.
- Duplicate creates a new ID, reference, serial number, slug and variant IDs/SKUs; resets quantities; saves a hidden draft; clears canonical SEO identity; and copies no order, analytics, or sales records. Gallery assets are shared by reference.

Product API responses include additive `catalogSummary` and backend-generated `metadata`. Metadata uses real product content and configured `PUBLIC_SITE_ORIGIN`/`FRONTEND_URL` and `PUBLIC_SITE_NAME`. Existing stored canonical URLs and SEO fields are preserved. The editor sends no manual SEO values.

## API additions

All mutations retain `products.manage`, authentication and CSRF enforcement.

| Endpoint | Behavior |
| --- | --- |
| `GET /products/admin` | Existing pagination/search plus status, active, variants and reliable tracked-stock filters; updated/name/base-price/status sorting |
| `GET /products/admin/health` | Real total and required-content completeness counts; product read/manage permission |
| `POST /products/admin/:serialNumber/duplicate` | Fresh hidden draft with reset stock |
| `POST /products/admin/bulk` | Up to 50 unique `{serialNumber, catalogRevision}` entries; four concurrent writes; per-record results |
| Existing product create/update | Structured variants, field errors, revision protection and backward-compatible serialization |

Stock list filtering includes products only when **all** represented variants track inventory. Products with unknown or partly untracked stock are not labeled out of stock. Price sorting explicitly uses base price; displayed rows can show an effective variant range.

## Safe migration procedure

1. Back up the database and retain the previous application release. Review existing SKU uniqueness and the target database configuration. Test the workflow on a staging copy first.
2. Deploy the compatible backend and frontend together. Confirm the new editor can read legacy products before converting any records. Configure site origin/name as already used by the application.
3. From the `server` repository, set `MONGO_URI` to the explicitly reviewed target database and run:

   ```powershell
   node src/scripts/migrate-product-variants.js --dry-run
   ```

   Omitting the mode also performs a dry run. Dry runs disable automatic collection/index creation and never call a write operation. Review every `would-convert`, skipped and failed result. Reserved inventory and malformed operational commerce data require resolution before conversion. No valid V2 record is overwritten.

4. After reviewing the dry run and backup, apply explicitly:

   ```powershell
   node src/scripts/migrate-product-variants.js --apply
   ```

   Apply creates the declared indexes without dropping existing indexes. Index creation can fail if historical data violates uniqueness; resolve that data rather than dropping the constraint. Individual conversions compare the prior `updatedAt` and schema version. Failures are reported by serial number and cause a nonzero exit status; successful records remain converted. Conflicting or unknown CLI modes are rejected.

5. Re-run the dry run and inspect representative public serial/slug links, prices, images, classifications and availability. Re-running apply skips valid V2 records, allowing recovery after a partial failure. Legacy snapshots remain available for a reviewed, record-specific recovery; there is no automatic destructive rollback or legacy-field deletion.

The integration suite exercised dry run, apply and repeat runs **only on disposable test databases**. The migration CLI was not run against the existing application database.

## Verification

`npm test`: 134 backend tests passed, including 15 variant/contract tests and 11 real catalog integration tests. `npm run check` passed. Tests cover stable IDs, Cartesian limits, invalid references, zero prices, stock semantics, legacy conversion, projection parity, image references, public URLs, metadata, permission checks, partial bulk failure, duplication, concurrent updates and a real MongoDB concurrent SKU collision.

See the frontend implementation report for editor/UI/browser checks and remaining environment-dependent verification.
