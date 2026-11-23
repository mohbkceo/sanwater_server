const router = require("express").Router();
const mongoose = require("mongoose");
const Joi = require("joi");
const rateLimit = require("express-rate-limit");
const { authSanWater, authorize } = require("../middlewares");
const { publicSubmissionLimiter } = require("../middlewares/rateLimit");
const Product = require("../models/product.model");
const Order = require("../models/ecommerceOrder.model");
const Customer = require("../models/customer.model");
const User = require("../models/user.model");
const { ImportBatch } = require("../models/commerceSupport.model");
const validators = require("../middlewares/validators/schemas/ecommerceValidator");
const domain = require("../services/ecommerce/domain");
const orders = require("../services/ecommerce/order.service");
const pricing = require("../services/ecommerce/pricing.service");
const catalog = require("../services/ecommerce/catalog.service");
const imports = require("../services/ecommerce/import.service");
const reports = require("../services/ecommerce/analytics.service");
const handle = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
const send = (res, data, status = 200) =>
  res.status(status).json({ success: true, data });
const permission = (name) => authorize(`ecommerce.${name}`);
const validId = (value) => {
  domain.assert(mongoose.isValidObjectId(value), "Invalid identifier", 400);
  return value;
};
const pagination = (q) => ({
  page: Math.min(1e6, Math.max(1, Math.floor(Number(q.page) || 1))),
  limit: Math.min(100, Math.max(1, Math.floor(Number(q.limit) || 20))),
});
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
const quoteLimiter = rateLimit({
  windowMs: 60000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});
router.get(
  "/products",
  quoteLimiter,
  handle(async (req, res) => {
    const { page, limit } = pagination(req.query);
    const filter = {
      isActive: true,
      "commerce.published": true,
      salesMode: { $in: ["ecommerce", "both"] },
    };
    const [products, count] = await Promise.all([
      Product.find(filter)
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);
    send(res, {
      products: products.map(catalog.publicProduct),
      count,
      page,
      limit,
    });
  }),
);
router.get(
  "/products/:reference",
  quoteLimiter,
  handle(async (req, res) => {
    const p = await Product.findOne({
      isActive: true,
      "commerce.published": true,
      salesMode: { $in: ["ecommerce", "both"] },
      $or: [
        { serialNumber: req.params.reference },
        { slug: req.params.reference },
      ],
    }).lean();
    domain.assert(p, "Product unavailable", 404);
    send(res, catalog.publicProduct(p));
  }),
);
router.post(
  "/quote",
  quoteLimiter,
  handle(async (req, res) =>
    send(
      res,
      await pricing.calculate(validators.parse(validators.quote, req.body)),
    ),
  ),
);
router.post(
  "/checkout",
  publicSubmissionLimiter,
  handle(async (req, res) => {
    domain.assert(
      process.env.ECOMMERCE_CHECKOUT_ENABLED === "true",
      "Checkout is temporarily unavailable",
      503,
      "CHECKOUT_DISABLED",
    );
    const input = validators.parse(validators.create, req.body);
    send(
      res,
      orders.receipt(await orders.create(input, req.get("Idempotency-Key"))),
      201,
    );
  }),
);
router.use(authSanWater);
router.get(
  "/settings",
  permission("view"),
  handle(async (req, res) => {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    send(res, {
      checkoutEnabled: process.env.ECOMMERCE_CHECKOUT_ENABLED === "true",
      partialPaymentsEnabled: process.env.ECOMMERCE_PARTIAL_PAYMENTS === "true",
      transactionsAvailable: Boolean(hello.setName || hello.msg === "isdbgrid"),
      deliveryProviders: ["manual"],
    });
  }),
);
router.get(
  "/staff",
  permission("view"),
  handle(async (req, res) =>
    send(
      res,
      await User.find({
        $or: [{ role: "super_admin" }, { permissions: "ecommerce.view" }],
      })
        .select("_id fullName")
        .limit(200)
        .lean(),
    ),
  ),
);
router.get(
  "/catalog",
  authorize([
    "products.view",
    "products.manage",
    "ecommerce.create",
    "ecommerce.edit",
    "ecommerce.import",
  ]),
  handle(async (req, res) => {
    const { page, limit } = pagination(req.query),
      filter = {};
    if (req.query.search)
      filter.$or = ["name", "productId", "serialNumber"].map((key) => ({
        [key]: {
          $regex: String(req.query.search)
            .slice(0, 100)
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          $options: "i",
        },
      }));
    if (req.query.sellable === "true")
      Object.assign(filter, {
        isActive: true,
        "commerce.published": true,
        salesMode: { $in: ["ecommerce", "both"] },
      });
    const [products, count] = await Promise.all([
      Product.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);
    send(res, { products, count, page, limit });
  }),
);
router.get(
  "/catalog/:id",
  authorize(["products.view", "products.manage"]),
  handle(async (req, res) => {
    const p = await Product.findById(validId(req.params.id)).lean();
    domain.assert(p, "Product not found", 404);
    send(res, p);
  }),
);
router.post(
  "/catalog/variants",
  authorize("products.manage"),
  handle(async (req, res) => {
    const schema = Joi.object({
      options: validators.options.required(),
      existing: Joi.array().max(100).items(validators.variant),
      prefix: Joi.string().max(50),
    });
    const input = validators.parse(schema, req.body);
    send(
      res,
      domain.generateVariants(input.options, input.existing, input.prefix),
    );
  }),
);
router.post(
  "/catalog/price-preview",
  authorize("products.manage"),
  handle(async (req, res) => {
    const input = validators.parse(validators.product, req.body);
    domain.validateCommerce(input.commerce, input.basePrice);
    const p = {
      isActive: true,
      salesMode: "ecommerce",
      prices: { productPrice: input.basePrice },
      commerce: {
        ...input.commerce,
        published: true,
        variants: input.commerce.variants.map((v) => ({
          ...v,
          trackStock: false,
        })),
      },
    };
    send(
      res,
      p.commerce.variants
        .filter((v) => v.enabled)
        .map((v) =>
          domain.priceItem(p, {
            variantId: v.id,
            quantity:
              input.commerce.offer?.type === "quantity"
                ? input.commerce.offer.minQuantity || 2
                : 1,
          }),
        ),
    );
  }),
);
router.post(
  "/catalog",
  authorize("products.manage"),
  handle(async (req, res) =>
    send(
      res,
      await catalog.save(
        null,
        validators.parse(validators.product, req.body),
        req.user,
      ),
      201,
    ),
  ),
);
router.put(
  "/catalog/:id",
  authorize("products.manage"),
  handle(async (req, res) =>
    send(
      res,
      await catalog.save(
        validId(req.params.id),
        validators.parse(validators.product, req.body),
        req.user,
      ),
    ),
  ),
);
router.post(
  "/admin/quote",
  authorize(["ecommerce.create", "ecommerce.edit"]),
  handle(async (req, res) =>
    send(
      res,
      await pricing.calculate(
        validators.parse(validators.quote, req.body),
        req.user,
      ),
    ),
  ),
);
router.get(
  "/orders",
  permission("view"),
  handle(async (req, res) => {
    const { page, limit } = pagination(req.query),
      filter = orders.filters(req.query, req.user);
    const [data, count] = await Promise.all([
      Order.find(filter)
        .select(
          "-events -internalNotes -originalData -operations -idempotencyKey -requestHash",
        )
        .sort({ createdAt: req.query.sort === "oldest" ? 1 : -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);
    send(res, {
      orders: data.map((o) => orders.present(o, req.user)),
      count,
      page,
      limit,
    });
  }),
);
router.post(
  "/orders",
  permission("create"),
  handle(async (req, res) =>
    send(
      res,
      orders.present(
        await orders.create(
          validators.parse(validators.create, req.body),
          req.get("Idempotency-Key"),
          req.user,
        ),
        req.user,
      ),
      201,
    ),
  ),
);
router.get(
  "/orders/:id",
  permission("view"),
  handle(async (req, res) => {
    const o = await Order.findOne({
      _id: validId(req.params.id),
      ...orders.scope(req.user),
    }).lean();
    domain.assert(o, "Order not found", 404);
    send(res, orders.present(o, req.user));
  }),
);
router.post(
  "/orders/:id/actions",
  permission("view"),
  handle(async (req, res) =>
    send(
      res,
      await orders.act(
        validId(req.params.id),
        validators.parse(validators.action, req.body),
        req.user,
      ),
    ),
  ),
);
router.post(
  "/orders/bulk/action",
  permission("view"),
  handle(async (req, res) => {
    const body = validators.parse(
      Joi.object({
        orders: Joi.array()
          .min(1)
          .max(50)
          .items(
            Joi.object({
              id: validators.id.required(),
              revision: Joi.number().integer().min(0).required(),
              requestId: Joi.string().guid({ version: "uuidv4" }).required(),
            }),
          )
          .required(),
        target: Joi.string()
          .valid("CONFIRMED", "PREPARING", "READY_TO_SHIP")
          .required(),
      }),
      req.body,
    );
    const results = [];
    for (const o of body.orders) {
      try {
        results.push({
          id: o.id,
          order: await orders.act(
            o.id,
            { ...o, id: undefined, action: "transition", target: body.target },
            req.user,
          ),
        });
      } catch (error) {
        results.push({ id: o.id, error: error.message });
      }
    }
    send(res, results);
  }),
);
router.get(
  "/customers",
  permission("customers"),
  handle(async (req, res) => {
    const { page, limit } = pagination(req.query),
      filter = {};
    if (!domain.can(req.user, "ecommerce.viewAll"))
      filter._id = {
        $in: await Order.find(orders.scope(req.user)).distinct("customerId"),
      };
    if (req.query.phone) filter.phone = domain.normalizePhone(req.query.phone);
    const [customers, count] = await Promise.all([
      Customer.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Customer.countDocuments(filter),
    ]);
    send(res, { customers, count, page, limit });
  }),
);
router.get(
  "/customers/:id",
  permission("customers"),
  handle(async (req, res) => {
    const customer = await Customer.findById(validId(req.params.id)).lean();
    domain.assert(customer, "Customer not found", 404);
    domain.assert(
      domain.can(req.user, "ecommerce.viewAll") ||
        (await Order.exists({
          customerId: customer._id,
          ...orders.scope(req.user),
        })),
      "Customer not found in your scope",
      404,
    );
    const { page, limit } = pagination(req.query),
      filter = { customerId: customer._id, ...orders.scope(req.user) };
    const [history, stats, count] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            orderCount: { $sum: 1 },
            realizedPurchases: {
              $sum: {
                $cond: [
                  { $eq: ["$commercialStatus", "DELIVERED"] },
                  {
                    $max: [
                      0,
                      {
                        $subtract: [
                          {
                            $subtract: [
                              "$financials.subtotal",
                              "$financials.discount",
                            ],
                          },
                          "$payment.refunded",
                        ],
                      },
                    ],
                  },
                  0,
                ],
              },
            },
          },
        },
      ]),
      Order.countDocuments(filter),
    ]);
    send(res, {
      customer,
      orders: history.map((o) => orders.present(o, req.user)),
      stats: stats[0] || { orderCount: 0, realizedPurchases: 0 },
      count,
      page,
      limit,
    });
  }),
);
router.patch(
  "/customers/:id",
  permission("customers"),
  handle(async (req, res) => {
    domain.assert(
      domain.can(req.user, "ecommerce.viewAll") ||
        (await Order.exists({
          customerId: validId(req.params.id),
          ...orders.scope(req.user),
        })),
      "Customer not found in your scope",
      404,
    );
    const input = validators.parse(
      Joi.object({
        revision: Joi.number().integer().min(0).required(),
        notes: Joi.string().max(3000).allow(""),
        secondaryPhone: Joi.string().max(30).allow(""),
        nextFollowUpAt: Joi.date().iso().allow(null),
      }),
      req.body,
    );
    const { revision, ...changes } = input;
    if (changes.secondaryPhone)
      changes.secondaryPhone = domain.normalizePhone(changes.secondaryPhone);
    const result = await Customer.findOneAndUpdate(
      { _id: validId(req.params.id), revision },
      {
        $set: changes,
        $inc: { revision: 1 },
        $push: {
          history: {
            actor: req.user.uid,
            at: new Date(),
            revision: revision + 1,
            data: changes,
          },
        },
      },
      { new: true },
    );
    domain.assert(result, "Customer changed. Reload before saving.", 409);
    send(res, result);
  }),
);
router.get(
  "/reports",
  permission("reports"),
  permission("view"),
  handle(async (req, res) =>
    send(res, await reports.report(req.query, req.user)),
  ),
);
router.get("/imports/template", permission("import"), (req, res) => {
  res
    .type("text/csv")
    .attachment("sanwater-orders.csv")
    .send(
      "name,phone,product,variant,quantity,wilaya,commune,deliveryType,office,address,externalReference,status\r\n",
    );
});
router.get(
  "/imports",
  permission("import"),
  handle(async (req, res) => {
    const { page, limit } = pagination(req.query),
      filter = domain.can(req.user, "ecommerce.viewAll")
        ? {}
        : { createdBy: req.user.uid };
    send(res, {
      batches: await ImportBatch.find(filter)
        .select("filename createdAt results")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      count: await ImportBatch.countDocuments(filter),
      page,
      limit,
    });
  }),
);
router.post(
  "/imports",
  permission("import"),
  require("express").raw({ type: "application/octet-stream", limit: "5mb" }),
  handle(async (req, res) => {
    let filename;
    try {
      filename = decodeURIComponent(req.get("X-File-Name") || "");
    } catch {
      domain.fail("Invalid filename", 400);
    }
    domain.assert(
      filename.length > 0 && filename.length <= 255,
      "Invalid filename",
      400,
    );
    const batch = await imports.upload(
      { buffer: req.body, originalname: filename },
      req.user,
    );
    send(res, await imports.preview(batch._id, {}, req.user));
  }),
);
router.post(
  "/imports/:id/preview",
  permission("import"),
  handle(async (req, res) => {
    const mappings = validators.parse(
      Joi.object({
        updateNew: Joi.boolean(),
        columns: Joi.object().pattern(
          Joi.string().valid(
            ...[
              "name",
              "phone",
              "product",
              "variant",
              "quantity",
              "wilaya",
              "commune",
              "deliveryType",
              "office",
              "address",
              "externalReference",
              "status",
            ],
          ),
          Joi.string().max(100),
        ),
        products: Joi.object()
          .max(1000)
          .pattern(
            /^.{1,300}$/,
            Joi.object({
              productId: validators.id.required(),
              variantId: Joi.string().max(100).required(),
            }),
          ),
        wilayas: Joi.object()
          .max(1000)
          .pattern(/^.{1,300}$/, Joi.string().max(30)),
        communes: Joi.object()
          .max(1000)
          .pattern(/^.{1,300}$/, Joi.string().max(30)),
      }),
      req.body,
    );
    send(
      res,
      await imports.preview(validId(req.params.id), mappings, req.user),
    );
  }),
);
router.post(
  "/imports/:id/commit",
  permission("import"),
  permission("create"),
  handle(async (req, res) => {
    const input = validators.parse(
      Joi.object({
        previewRevision: Joi.number().integer().min(1).required(),
        selected: Joi.array()
          .min(1)
          .max(1000)
          .items(Joi.number().integer().min(2))
          .required(),
      }),
      req.body,
    );
    send(
      res,
      await imports.commit(
        validId(req.params.id),
        input.selected,
        req.user,
        input.previewRevision,
      ),
    );
  }),
);
router.post(
  "/conversions/:kind/:id",
  permission("create"),
  permission("view"),
  handle(async (req, res) => {
    domain.assert(
      ["lead", "quotation"].includes(req.params.kind),
      "Unknown conversion source",
      400,
    );
    const kind = req.params.kind;
    domain.assert(
      domain.can(
        req.user,
        `${kind === "lead" ? "leads" : "quotations"}.manage`,
      ),
      "Source conversion permission required",
      403,
    );
    const sourceRecord = `${kind}:${validId(req.params.id)}`;
    const existing = await Order.findOne({
      sourceRecord,
      ...orders.scope(req.user),
    }).lean();
    if (existing) return send(res, orders.present(existing, req.user));
    const record = await require(`../models/${kind}.model`)
      .findById(req.params.id)
      .lean();
    domain.assert(record, "Source record not found", 404);
    domain.assert(
      kind !== "quotation" || record.status === "approved",
      "Approve quotation before conversion",
      409,
    );
    const input = validators.parse(validators.create, req.body);
    const sourceItems =
      kind === "lead"
        ? [{ product: record.productId, quantity: record.quantity }]
        : record.items;
    domain.assert(
      domain.sourceItemsMatch(sourceItems, input.items),
      "Converted products and quantities must match the source",
    );
    const sourcePhone = domain.normalizePhone(
      kind === "lead" ? record.phone : record.requester.phone,
    );
    domain.assert(
      sourcePhone === domain.normalizePhone(input.customer.phone),
      "Customer phone must match source record",
    );
    send(
      res,
      orders.present(
        await orders.create(
          input,
          `conversion:${kind}:${record._id}`,
          req.user,
          { source: kind, sourceRecord },
        ),
        req.user,
      ),
      201,
    );
  }),
);
router.get(
  "/conversion-source/:kind/:id",
  permission("create"),
  handle(async (req, res) => {
    const kind = req.params.kind;
    domain.assert(
      ["lead", "quotation"].includes(kind),
      "Unknown conversion source",
      400,
    );
    domain.assert(
      domain.can(
        req.user,
        `${kind === "lead" ? "leads" : "quotations"}.manage`,
      ),
      "Source conversion permission required",
      403,
    );
    const record = await require(`../models/${kind}.model`)
      .findById(validId(req.params.id))
      .lean();
    domain.assert(record, "Source record not found", 404);
    domain.assert(
      kind !== "quotation" || record.status === "approved",
      "Approve quotation before conversion",
      409,
    );
    const items =
      kind === "lead"
        ? [
            {
              productId: record.productId,
              name: record.productName,
              quantity: record.quantity,
            },
          ]
        : record.items.map((i) => ({
            productId: i.product,
            name: i.productName,
            quantity: i.quantity,
          }));
    const customer =
      kind === "lead"
        ? { name: record.fullName, phone: record.phone, email: record.email }
        : {
            name: record.requester.fullName,
            phone: record.requester.phone,
            email: record.requester.email,
          };
    send(res, { items, customer });
  }),
);
module.exports = router;
