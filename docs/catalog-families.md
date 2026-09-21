# Admin-managed catalog taxonomy

The catalog source of truth is a persisted hierarchy:

`Family -> SubFamily -> Product`

A Product is assigned by `subFamily` only. On every Product create or taxonomy-changing update, the server loads that SubFamily and stores both its `_id` and the SubFamily's parent `family` `_id`. Browser-supplied Family values are rejected. Product IDs are identifiers only and have no taxonomy meaning.

## Visibility

Public Family APIs return active Families and active SubFamilies only. Public Product list/detail queries require the Product, its Family, and its SubFamily to be active. Admin APIs include inactive entities. Disabling taxonomy never mutates `Product.isActive`.

## API

- `GET /families` — public active hierarchy
- `GET /families/:slug` — one public active Family
- `GET /families/admin` — protected complete hierarchy and aggregate counts
- `POST /families` — create Family (`products.manage`)
- `PUT /families/:id` — update Family (`products.manage`)
- `DELETE /families/:id` — password-confirmed delete (`products.manage`)
- `POST /families/:familyId/subfamilies` — create SubFamily
- `PUT /families/subfamilies/:id` — update SubFamily
- `DELETE /families/subfamilies/:id` — password-confirmed delete/reassignment
- `GET /products` and `GET /products/admin` — public/admin listings

Filters use slugs, for example `/products?family=sanitary-mixers&subFamily=lavabo`.

## Delete integrity and security

Every write is protected by the existing cookie authentication, CSRF middleware, and `products.manage` authorization. Delete requests also verify the authenticated user's current bcrypt password.

A Family with Products or SubFamilies cannot be deleted. An empty SubFamily can be deleted directly. A non-empty SubFamily requires `replacementSubFamilyId`; Products are reassigned to the replacement and inherit its Family in one MongoDB transaction. Standalone MongoDB deployments use a guarded update/delete flow with rollback on delete failure. Products are never cascade-deleted.

## Migration and deployment

1. Back up MongoDB.
2. Deploy this migration-compatible code while keeping public traffic on the previous release.
3. Run `npm run migrate:admin-taxonomy -- --dry-run` from `server` and review counts/errors.
4. Run `npm run migrate:admin-taxonomy`.
5. Verify every Product has ObjectId `family` and `subFamily` values and that `/families/admin` counts match.
6. Deploy/restart the final backend and frontend together.
7. After the rollback window, archive or remove the unused `familyconfigs` collection. No runtime model or route reads it.

The migration is manual and idempotent. It uses legacy `Product.family` and the first two Product ID characters once, copies matching FamilyConfig presentation fields, preserves unrelated Product data, and reports scanned/created/assigned/skipped/error counts.
