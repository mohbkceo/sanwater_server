const { Worker } = require("node:worker_threads");
const path = require("node:path");
const { createHash } = require("node:crypto");
const Product = require("../../models/product.model");
const Order = require("../../models/ecommerceOrder.model");
const Shipping = require("../../models/shippingConfig.model");
const { ImportBatch } = require("../../models/commerceSupport.model");
const pricing = require("./pricing.service");
const orders = require("./order.service");
const {
  parse,
  create: createSchema,
} = require("../../middlewares/validators/schemas/ecommerceValidator");
const { assert, hash, normalizePhone, can } = require("./domain");
function parseFile(file) {
  assert(
    file &&
      Buffer.isBuffer(file.buffer) &&
      file.buffer.length <= 5 * 1024 * 1024,
    "Choose a file up to 5 MB",
    400,
  );
  const ext = path.extname(file.originalname).toLowerCase();
  assert(
    [".csv", ".xls", ".xlsx"].includes(ext),
    "Only CSV, XLS and XLSX are supported",
    400,
  );
  const b = file.buffer;
  assert(b.length >= 8, "File is empty or invalid", 400);
  if (ext === ".xlsx") {
    assert(b.readUInt32LE(0) === 0x04034b50, "Invalid XLSX file", 400);
  } else if (ext === ".xls")
    assert(
      b.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")),
      "Invalid XLS file",
      400,
    );
  else
    assert(
      !b.includes(0) && !/[\x01-\x08\x0b\x0e-\x1f]/.test(b.toString("utf8")),
      "CSV must be plain text",
      400,
    );
  return new Promise((resolve, reject) => {
    const invalid = (message) =>
      Object.assign(new Error(message), {
        statusCode: 400,
        key: "IMPORT_INVALID",
      });
    let settled = false;
    const worker = new Worker(path.join(__dirname, "importParser.js"), {
      workerData: { buffer: b, format: ext },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    const timer = setTimeout(() => {
      settled = true;
      worker.terminate();
      reject(invalid("Import parsing timed out"));
    }, 5000);
    worker.once("message", (result) => {
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      result.error ? reject(invalid(result.error)) : resolve(result);
    });
    worker.once("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(invalid(error.message));
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (!settled)
        reject(invalid(`Import parser exited before returning rows (${code})`));
    });
  });
}
async function batchFor(id, user) {
  const batch = await ImportBatch.findOne({
    _id: id,
    ...(can(user, "ecommerce.viewAll") ? {} : { createdBy: user.uid }),
  });
  assert(batch, "Import batch not found", 404);
  return batch;
}
async function upload(file, user) {
  const data = await parseFile(file);
  assert(Buffer.byteLength(JSON.stringify(data), 'utf8') <= 8 * 1024 * 1024, 'Parsed import exceeds 8 MB; split the file', 413);
  const fingerprint = createHash("sha256")
    .update(String(user.uid))
    .update(file.buffer)
    .digest("hex");
  return ImportBatch.findOneAndUpdate(
    { fingerprint },
    {
      $setOnInsert: {
        ...data,
        filename: path.basename(file.originalname),
        createdBy: user.uid,
      },
    },
    { upsert: true, new: true },
  );
}
const fields = [
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
];
async function preview(id, mappings, user) {
  const batch = await batchFor(id, user);
  const products = await Product.find({
    isActive: true,
    "commerce.published": true,
    salesMode: { $in: ["ecommerce", "both"] },
  })
    .select("name productId commerce")
    .lean();
  const config = await Shipping.findById("noest").lean();
  const seen = new Set(),
    rows = [];
  for (const row of batch.rows) {
    try {
      const raw = row.raw;
      const value = (field) =>
        String(raw[mappings.columns?.[field] || field] ?? "").trim();
      const mappedProduct = mappings.products?.[value("product")];
      const product = products.find(
        (p) =>
          String(p._id) === mappedProduct?.productId ||
          (!mappedProduct &&
            (p.productId === value("product") ||
              p.commerce.variants.some((v) => v.sku === value("product")))),
      );
      assert(product, "UNKNOWN_PRODUCT");
      let variantId = mappedProduct?.variantId || value("variant");
      if (!variantId)
        variantId = product.commerce.variants.find(
          (v) => v.sku === value("product"),
        )?.id;
      // Only a genuinely single-variant product can be selected without an option.
      if (!variantId && product.commerce.variants.length === 1)
        variantId = product.commerce.variants[0].id;
      assert(
        variantId &&
          product.commerce.variants.some(
            (v) =>
              v.id === variantId || (v.sku === variantId && (variantId = v.id)),
          ),
        "MISSING_VARIANT",
      );
      const wilayaCode = mappings.wilayas?.[value("wilaya")] || value("wilaya");
      const communeCode =
        mappings.communes?.[`${value("wilaya")}/${value("commune")}`] ||
        value("commune");
      const deliveryType = value("deliveryType") || "home";
      const input = {
        customer: {
          name: value("name"),
          phone: normalizePhone(value("phone")),
        },
        items: [
          {
            productId: String(product._id),
            variantId,
            quantity: Number(value("quantity") || 1),
          },
        ],
        delivery: {
          wilayaCode,
          communeCode,
          deliveryType,
          ...(deliveryType === "home"
            ? { address: value("address") }
            : { officeCode: value("office") }),
        },
      };
      assert(
        !value("status") || value("status") === "NEW",
        "HISTORICAL_STATUS_REQUIRES_MANUAL_REVIEW",
      );
      const externalReference =
        value("externalReference") || `row-${hash(input)}`;
      assert(externalReference.length <= 160, "External reference too long");
      assert(!seen.has(externalReference), "DUPLICATE_IN_FILE");
      seen.add(externalReference);
      const existing = await Order.findOne({
        source: "import",
        externalReference,
      })
        .select("_id revision commercialStatus")
        .lean();
      if (existing) {
        assert(
          mappings.updateNew &&
            existing.commercialStatus === "NEW" &&
            can(user, "ecommerce.edit"),
          "DUPLICATE_EXISTING",
        );
        assert(
          await Order.exists({ _id: existing._id, ...orders.scope(user) }),
          "DUPLICATE_EXISTING",
        );
      }
      const calculated = await pricing.calculate(
        parse(
          require("../../middlewares/validators/schemas/ecommerceValidator")
            .quote,
          { items: input.items, delivery: input.delivery },
        ),
        user,
      );
      input.expectedQuote = calculated.quoteFingerprint;
      parse(createSchema, input);
      rows.push({
        rowNumber: row.rowNumber,
        raw,
        eligible: true,
        input,
        externalReference,
        total: calculated.financials.total,
        action: existing ? "UPDATE_NEW" : "CREATE",
        ...(existing
          ? {
              updateOrderId: String(existing._id),
              existingRevision: existing.revision,
            }
          : {}),
      });
    } catch (error) {
      rows.push({
        rowNumber: row.rowNumber,
        raw: row.raw,
        eligible: false,
        error: error.message,
      });
    }
  }
  batch.rows = rows;
  batch.previewRevision += 1;
  await batch.save();
  return {
    _id: batch._id,
    previewRevision: batch.previewRevision,
    columns: batch.columns,
    fields,
    rows,
    products,
    wilayas: config?.wilayas || [],
    results: batch.results,
  };
}
async function commit(id, selected, user, previewRevision) {
  const batch = await batchFor(id, user),
    results = [];
  assert(
    batch.previewRevision === previewRevision,
    "Import preview changed. Review it again.",
    409,
    "STALE_REVISION",
  );
  for (const rowNumber of [...new Set(selected)]) {
    const row = batch.rows.find((r) => r.rowNumber === rowNumber);
    try {
      assert(
        row?.eligible && row.input,
        "Row is not eligible; preview mappings first",
      );
      const operationHash = hash([
        String(batch._id),
        rowNumber,
        previewRevision,
      ]);
      const requestId = `${operationHash.slice(0, 8)}-${operationHash.slice(8, 12)}-4${operationHash.slice(13, 16)}-8${operationHash.slice(17, 20)}-${operationHash.slice(20, 32)}`;
      const order = row.updateOrderId
        ? await orders.act(
            row.updateOrderId,
            {
              action: "edit",
              order: row.input,
              revision: row.existingRevision,
              requestId,
              importBatchId: String(batch._id),
              rowNumber,
              originalImportRow: row.raw,
            },
            user,
          )
        : await orders.create(
            row.input,
            `import:${batch._id}:${rowNumber}`,
            user,
            {
              source: "import",
              externalReference: row.externalReference,
              originalData: row.raw,
            },
          );
      results.push({
        rowNumber,
        status: row.updateOrderId ? "UPDATED" : "IMPORTED",
        orderNumber: order.orderNumber,
        orderId: order._id,
      });
    } catch (error) {
      results.push({ rowNumber, status: "ERROR", error: error.message });
    }
  }
  await ImportBatch.updateOne(
    { _id: id },
    { $push: { results: { $each: results } } },
  );
  return results;
}
module.exports = { parseFile, upload, preview, commit, batchFor };
