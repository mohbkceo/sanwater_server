# Product catalog Families

Product catalog membership has no separate assignment records:

- `Family` is the trimmed value of `Product.family`.
- `Sub Family` is the uppercased first two characters of the trimmed `Product.productId`.
- `FamilyConfig` stores presentation only (display name, description, image, order, visibility, and SEO metadata).

## APIs

- `GET /families` returns public, active Families/Sub Families derived from publicly eligible Products.
- `GET /families/:familyKey` returns one public Family.
- `GET /families/admin` returns the complete derived hierarchy and Product rows; it requires `products.view`.
- `PUT /families/:familyKey/config` updates Family presentation; it requires `products.manage`.
- `PUT /families/:familyKey/subfamilies/:subFamilyKey/config` updates Sub Family presentation; it requires `products.manage`.
- `GET /products/admin` is the protected admin Product list; `GET /products` remains public.

Product filtering uses `family` and `subFamily`. Family is an exact, trimmed match. Sub Family is an exact normalized two-character prefix of `productId`, not a substring. Supplying `subFamily` without `family` is supported as a global prefix filter; the frontend normally requires a Family selection first.

## Explicit legacy cleanup

`npm run migrate:catalog` runs the manual migration in `src/scripts/migrate-product-families.js`. It backfills missing slug/status values and unsets only legacy Product classification fields. It is never run at startup and does not delete legacy Category or Collection documents.
