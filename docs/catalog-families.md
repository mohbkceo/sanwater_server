# Admin-managed catalog taxonomy

The catalog source of truth is a persisted, manually managed hierarchy:

`Family -> SubFamily -> explicit Product assignment`

Products are created unassigned with `family: null` and `subFamily: null`. Creating or editing a Product never creates taxonomy entities and never derives classification from `productId`. An admin first creates a Family, creates a Sub Family inside it, and then assigns existing Products from the Sub Family manager.

## Visibility

Public Family APIs return active Families and active Sub Families only. Public Product list/detail queries require the Product, its Family, and its Sub Family to be active. Admin APIs include inactive and unassigned entities. Changing taxonomy visibility never mutates Product assignment or `Product.isActive`.

## API

- `GET /families` — public active hierarchy
- `GET /families/:slug` — one public active Family
- `GET /families/admin` — protected complete hierarchy and aggregate counts
- `POST /families` — create Family (`products.manage`)
- `PUT /families/:id` — update Family (`products.manage`)
- `DELETE /families/:id` — password-confirmed delete (`products.manage`)
- `POST /families/:familyId/subfamilies` — create Sub Family
- `PUT /families/subfamilies/:id` — update Sub Family
- `DELETE /families/subfamilies/:id` — password-confirmed delete/reassignment
- `POST /families/subfamilies/:id/products` — bulk assign or move Products
- `DELETE /families/subfamilies/:id/products` — bulk remove assignments without deleting Products
- `GET /products/admin?assignment=unassigned|assigned|all&search=...&page=1&limit=50` — paginated admin selector

Product filters resolve persisted IDs or slugs, for example `/products?family=mixers&subFamily=lavabo`. No Product ID prefix participates in filtering or assignment.

## Delete integrity and security

Every write is protected by the existing cookie authentication, CSRF middleware, and `products.manage` authorization. Delete requests also verify the authenticated user's current bcrypt password.

A Family with Products or Sub Families cannot be deleted. An empty Sub Family can be deleted directly. A non-empty Sub Family requires `replacementSubFamilyId`; Products are reassigned to the replacement and inherit its Family in one MongoDB transaction. Standalone MongoDB deployments use a guarded update/delete flow with rollback on delete failure. Products are never cascade-deleted.

## Assignment integrity

Bulk assignment validates the Sub Family and every Product ID, then updates both references in one update: `Product.subFamily` becomes the selected Sub Family and `Product.family` becomes its parent Family. Assigning an already-classified Product automatically moves it. Bulk removal only affects Products assigned to the selected Sub Family and sets both references to `null`.
