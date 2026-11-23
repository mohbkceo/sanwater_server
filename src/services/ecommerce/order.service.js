const mongoose = require("mongoose");
const Order = require("../../models/ecommerceOrder.model");
const Customer = require("../../models/customer.model");
const User = require("../../models/user.model");
const { Counter } = require("../../models/commerceSupport.model");
const transaction = require("./transaction");
const pricing = require("./pricing.service");
const inventory = require("./inventory.service");
const {
  assert,
  hash,
  normalizePhone,
  targets,
  can,
  round,
  blocked,
} = require("./domain");
function scope(user) {
  assert(can(user, "ecommerce.view"), "Order access denied", 403);
  return can(user, "ecommerce.viewAll")
    ? {}
    : { $or: [{ assignment: user.uid }, { createdBy: user.uid }] };
}
function event(order, kind, user, data) {
  order.events.push({
    kind,
    actor: user?.uid,
    at: new Date(),
    revision: order.revision,
    data,
  });
}
async function allocateNumber() {
  const year = new Date().getUTCFullYear();
  const counter = await Counter.findOneAndUpdate(
    { _id: `orders-${year}` },
    { $inc: { value: 1 } },
    { upsert: true, new: true },
  );
  return `SW-${year}-${String(counter.value).padStart(7, "0")}`;
}
async function create(input, key, user, context = {}) {
  assert(
    typeof key === "string" && /^[a-zA-Z0-9:_-]{16,200}$/.test(key),
    "Valid idempotency key required",
    400,
  );
  const source =
    context.source || (user ? "manual" : input.source || "landing");
  assert(
    user || ["landing", "storefront"].includes(source),
    "Invalid public source",
    403,
  );
  assert(
    user || !input.internalNote,
    "Internal notes require staff permission",
    403,
  );
  assert(
    user || !input.requiresProduction,
    "Manufacturing overrides require staff permission",
    403,
  );
  const idempotencyKey = `${user ? `staff:${user.uid}` : "public"}:${key}`;
  const customer = {
    name: input.customer.name.trim(),
    phone: normalizePhone(input.customer.phone),
    email: input.customer.email || null,
  };
  const requestHash = hash({
    ...input,
    customer,
    source,
    sourceRecord: context.sourceRecord,
  });
  const replay = async () => {
    const old = await Order.findOne({ idempotencyKey }).lean();
    if (old)
      assert(
        old.requestHash === requestHash,
        "Idempotency key was already used for a different request",
        409,
        'IDEMPOTENCY_CONFLICT',
      );
    return old;
  };
  const existing = await replay();
  if (existing) return existing;
  // Allocated outside transactions: rollback leaves a gap, never a reused number.
  const orderNumber = await allocateNumber();
  try {
    return await transaction(async (session) => {
      let conversionRecord;
      if (context.sourceRecord && ["lead", "quotation"].includes(source)) {
        const Model = require(`../../models/${source}.model`);
        conversionRecord = await Model.findById(
          context.sourceRecord.split(":")[1],
        )
          .session(session)
          .lean();
        assert(
          conversionRecord &&
            (source !== "quotation" || conversionRecord.status === "approved"),
          "Approved conversion source is no longer available",
          409,
        );
        assert(
          !conversionRecord.convertedOrderId,
          "Source already converted",
          409,
          "SOURCE_CONVERTED",
        );
        const sourceItems =
          source === "lead"
            ? [
                {
                  productId: conversionRecord.productId,
                  quantity: conversionRecord.quantity,
                },
              ]
            : conversionRecord.items.map((i) => ({
                productId: i.product,
                quantity: i.quantity,
              }));
        assert(
          require("./domain").sourceItemsMatch(sourceItems, input.items),
          "Conversion source products changed",
          409,
        );
        assert(
          normalizePhone(
            source === "lead"
              ? conversionRecord.phone
              : conversionRecord.requester.phone,
          ) === customer.phone,
          "Conversion source customer changed",
          409,
        );
      }
      const calculated = await pricing.calculate(input, user, session);
      assert(
        calculated.quoteFingerprint === input.expectedQuote,
        "Prices or tariffs changed. Review a new quote.",
        409,
        "STALE_CHECKOUT_QUOTE",
      );
      const person = await Customer.findOneAndUpdate(
        { phone: customer.phone },
        { $setOnInsert: { ...customer, delivery: calculated.delivery } },
        { upsert: true, new: true, session, runValidators: true },
      );
      const order = new Order({
        orderNumber,
        idempotencyKey,
        requestHash,
        source,
        customer,
        customerId: person._id,
        items: calculated.items,
        delivery: calculated.delivery,
        financials: calculated.financials,
        campaign: input.campaign,
        externalReference: context.externalReference,
        sourceRecord: context.sourceRecord,
        originalData: context.originalData,
        legacyCreatedAt: context.legacyCreatedAt,
        createdBy: user?.uid,
        assignment: user?.uid,
        fulfillment: {
          stage: "PENDING",
          requiresProduction:
            Boolean(input.requiresProduction) ||
            calculated.items.some((i) => i.requiresProduction),
        },
        internalNotes: input.internalNote
          ? [{ content: input.internalNote, actor: user.uid, at: new Date() }]
          : [],
      });
      event(order, "CREATED", user, {
        source,
        items: calculated.items,
        delivery: calculated.delivery,
        financials: calculated.financials,
        overrides: calculated.items
          .filter((i) => i.overrideReason)
          .map((i) => ({
            sku: i.sku,
            unitPrice: i.unitPrice,
            reason: i.overrideReason,
          })),
      });
      if (conversionRecord) {
        const Model = require(`../../models/${source}.model`);
        const result = await Model.updateOne(
          {
            _id: conversionRecord._id,
            convertedOrderId: null,
            ...(source === "quotation" ? { status: "approved" } : {}),
          },
          { $set: { convertedOrderId: order._id } },
          { session },
        );
        assert(result.modifiedCount === 1, "Conversion source changed", 409);
      }
      await order.save({ session });
      return order.toObject();
    });
  } catch (error) {
    if (error.code === 11000 || error.key === "SOURCE_CONVERTED") {
      const old = await replay();
      if (old) return old;
    }
    throw error;
  }
}
const actionPermissions = {
  confirmation: "confirm",
  note: "edit",
  assign: "assign",
  important: "assign",
  issue: "issue",
  resolve: "resolve",
  shipment: "ship",
  payment: "payment",
  restock: "inventory",
  productionStart: "fulfill",
  productionFinish: "fulfill",
  edit: "edit",
};
async function act(id, input, user) {
  return transaction(async (session) => {
    const order = await Order.findOne({ _id: id, ...scope(user) }).session(
      session,
    );
    assert(order, "Order not found in your scope", 404);
    const operationHash = hash(input);
    const prior = order.operations.find((x) =>
      x.startsWith(`${input.requestId}:`),
    );
    if (prior) {
      assert(
        prior === `${input.requestId}:${operationHash}`,
        "Request ID reused with different data",
        409,
      );
      return present(order.toObject(), user);
    }
    assert(
      order.revision === input.revision,
      "Order changed. Reload before retrying.",
      409,
      "STALE_REVISION",
    );
    const permission = actionPermissions[input.action];
    if (permission)
      assert(can(user, `ecommerce.${permission}`), "Order action denied", 403);
    const terminal = ["RETURNED", "CANCELLED", "DELIVERED"].includes(
      order.commercialStatus,
    );
    const before = order.commercialStatus;
    const beforeSnapshot = input.action === "edit" ? order.toObject() : null;
    const previousOrder = beforeSnapshot
      ? {
          customer: beforeSnapshot.customer,
          items: beforeSnapshot.items,
          delivery: beforeSnapshot.delivery,
          financials: beforeSnapshot.financials,
        }
      : undefined;
    if (input.action === "transition") {
      assert(
        targets(order, user).includes(input.target),
        "Transition unavailable for your role or current order state",
        409,
      );
      assert(
        !["CANCELLED", "RETURNING"].includes(input.target) ||
          input.reason?.trim(),
        "Reason required",
      );
      if (input.target === "CONFIRMED") {
        await inventory.reserve(order, user, session);
        order.inventoryState = "RESERVED";
        order.confirmation.confirmedAt = new Date();
        order.confirmation.followUpAt = null;
        order.fulfillment.stage = "CONFIRMED";
      }
      if (input.target === "CANCELLED" && order.inventoryState === "RESERVED") {
        await inventory.move(order, "RELEASE", user, session, input.reason);
        order.inventoryState = "RELEASED";
      }
      if (input.target === "PREPARING") order.fulfillment.stage = "PREPARING";
      if (input.target === "READY_TO_SHIP")
        order.fulfillment.stage = "READY_TO_SHIP";
      if (input.target === "SHIPPED") {
        assert(
          order.shipment?.agency && order.shipment?.trackingNumber,
          "Record agency and tracking reference before shipping",
        );
        await inventory.consume(order, session);
        order.inventoryState = "CONSUMED";
      }
      if (input.target === "RETURNED")
        order.fulfillment.stage = "RETURNED_AWAITING_INSPECTION";
      order.commercialStatus = input.target;
    } else if (
      input.action === "productionStart" ||
      input.action === "productionFinish"
    ) {
      assert(
        order.commercialStatus === "PREPARING" &&
          order.fulfillment.requiresProduction &&
          !blocked(order),
        "Production action unavailable",
        409,
      );
      assert(
        order.fulfillment.stage ===
          (input.action === "productionStart" ? "PREPARING" : "IN_PRODUCTION"),
        "Invalid production stage",
        409,
      );
      order.fulfillment.stage =
        input.action === "productionStart" ? "IN_PRODUCTION" : "PREPARED";
    } else if (input.action === "confirmation") {
      assert(order.commercialStatus === "NEW", "Confirmation is closed", 409);
      assert(
        ["NO_ANSWER", "POSTPONED"].includes(input.outcome),
        "Confirmation outcome required",
      );
      assert(
        input.outcome !== "POSTPONED" || input.followUpAt,
        "Follow-up date required",
      );
      order.confirmation.attempts.push({
        outcome: input.outcome,
        actor: user.uid,
        at: new Date(),
        note: input.note,
        followUpAt: input.followUpAt,
      });
      order.confirmation.followUpAt = input.followUpAt || null;
    } else if (input.action === "note") {
      assert(input.note?.trim(), "Note required");
      order.internalNotes.push({
        content: input.note,
        actor: user.uid,
        at: new Date(),
      });
    } else if (input.action === "assign") {
      assert(
        input.assignment === null ||
          (input.assignment &&
            (await User.exists({
              _id: input.assignment,
              role: { $in: ["admin", "super_admin"] },
            }).session(session))),
        "Valid employee required",
      );
      order.assignment = input.assignment;
    } else if (input.action === "important") {
      assert(typeof input.important === "boolean", "Important flag required");
      order.important = input.important;
    } else if (input.action === "issue") {
      assert(
        !terminal && input.type && input.severity,
        "Issue type and severity required on an active order",
      );
      order.issues.push({
        type: input.type,
        severity: input.severity,
        blocking: input.blocking || input.severity === "CRITICAL",
        description: input.note,
        responsibleTeam: input.responsibleTeam,
        reporter: user.uid,
        createdAt: new Date(),
      });
    } else if (input.action === "resolve") {
      const issue = order.issues.id(input.issueId);
      assert(issue?.status === "OPEN", "Open issue not found", 409);
      issue.status = "RESOLVED";
      issue.resolvedBy = user.uid;
      issue.resolvedAt = new Date();
    } else if (input.action === "shipment") {
      assert(
        !terminal &&
          [
            "READY_TO_SHIP",
            "SHIPPED",
            "OUT_FOR_DELIVERY",
            "FAILED_DELIVERY",
            "RETURNING",
          ].includes(order.commercialStatus),
        "Shipment update unavailable",
        409,
      );
      assert(
        input.agency && input.trackingNumber,
        "Agency and tracking number required",
      );
      order.shipment = require("./delivery.service")
        .providerFor("manual")
        .snapshot(input);
    } else if (input.action === "payment") {
      assert(
        input.amount > 0 &&
          ["paid", "collected", "refunded"].includes(input.paymentKind),
        "Payment amount and kind required",
      );
      assert(
        !["CANCELLED", "RETURNED"].includes(order.commercialStatus) ||
          input.paymentKind === "refunded",
        "Only refunds are allowed on cancelled or returned orders",
        409,
      );
      const received = round(order.payment.paid + order.payment.collected);
      if (input.paymentKind === "refunded")
        assert(
          order.payment.refunded + input.amount <= received,
          "Refund exceeds received funds",
        );
      else {
        assert(
          received - order.payment.refunded + input.amount <=
            order.financials.total,
          "Payment exceeds balance",
        );
        assert(
          process.env.ECOMMERCE_PARTIAL_PAYMENTS === "true" ||
            round(received - order.payment.refunded + input.amount) ===
              order.financials.total,
          "Partial payments are disabled",
        );
      }
      order.payment[input.paymentKind] = round(
        order.payment[input.paymentKind] + input.amount,
      );
    } else if (input.action === "restock") {
      assert(
        order.commercialStatus === "RETURNED" &&
          order.inventoryState === "CONSUMED",
        "Return is not eligible for restocking",
        409,
      );
      assert(input.reason?.trim(), "Inspection/restock reason required");
      await inventory.move(order, "RESTOCK", user, session, input.reason);
      order.inventoryState = "RESTOCKED";
    } else if (input.action === "edit") {
      assert(
        order.commercialStatus === "NEW",
        "Only unconfirmed orders may be edited",
        409,
      );
      assert(input.order, "Order details required");
      const next = input.order;
      const data = await pricing.calculate(next, user, session);
      assert(
        data.quoteFingerprint === next.expectedQuote,
        "Review updated prices",
        409,
      );
      assert(
        data.financials.total >=
          order.payment.paid + order.payment.collected - order.payment.refunded,
        "Edited total cannot be less than received funds",
        409,
      );
      const phone = normalizePhone(next.customer.phone);
      const customer = await Customer.findOneAndUpdate(
        { phone },
        {
          $setOnInsert: {
            name: next.customer.name,
            phone,
            email: next.customer.email,
          },
        },
        { upsert: true, new: true, session },
      );
      order.customerId = customer._id;
      order.customer = { ...next.customer, phone };
      order.items = data.items;
      order.delivery = data.delivery;
      order.financials = data.financials;
      order.fulfillment.requiresProduction =
        Boolean(next.requiresProduction) ||
        data.items.some((i) => i.requiresProduction);
      order.fulfillment.stage = "PENDING";
    }
    order.revision += 1;
    event(order, input.action, user, {
      ...input,
      ...(previousOrder ? { previousOrder } : {}),
      before,
      after: order.commercialStatus,
    });
    order.operations.push(`${input.requestId}:${operationHash}`);
    await order.save({ session });
    return present(order.toObject(), user);
  });
}
function present(order, user) {
  const { idempotencyKey, requestHash, operations, originalData, ...safe } =
    order;
  safe.availableActions = targets(order, user);
  safe.availableOperations = Object.entries(actionPermissions)
    .filter(([action, permission]) => {
      if (!can(user, `ecommerce.${permission}`)) return false;
      if (["confirmation", "edit"].includes(action))
        return order.commercialStatus === "NEW";
      if (action === "issue")
        return !["DELIVERED", "RETURNED", "CANCELLED"].includes(
          order.commercialStatus,
        );
      if (action === "shipment")
        return [
          "READY_TO_SHIP",
          "SHIPPED",
          "OUT_FOR_DELIVERY",
          "FAILED_DELIVERY",
          "RETURNING",
        ].includes(order.commercialStatus);
      if (action === "restock")
        return (
          order.commercialStatus === "RETURNED" &&
          order.inventoryState === "CONSUMED"
        );
      if (action === "productionStart" || action === "productionFinish")
        return (
          order.commercialStatus === "PREPARING" &&
          order.fulfillment.requiresProduction &&
          !blocked(order) &&
          order.fulfillment.stage ===
            (action === "productionStart" ? "PREPARING" : "IN_PRODUCTION")
        );
      return true;
    })
    .map(([action]) => action);
  safe.amountDue = ["CANCELLED", "RETURNED"].includes(order.commercialStatus)
    ? 0
    : order.financials.total;
  safe.outstandingBalance = round(
    Math.max(
      0,
      safe.amountDue -
        order.payment.paid -
        order.payment.collected +
        order.payment.refunded,
    ),
  );
  return safe;
}
function receipt(order) {
  return {
    orderNumber: order.orderNumber,
    commercialStatus: order.commercialStatus,
    financials: order.financials,
  };
}
function filters(query, user) {
  const clauses = [scope(user)];
  for (const key of ["commercialStatus", "source"])
    if (query[key]) clauses.push({ [key]: String(query[key]) });
  if (query.stage) clauses.push({ "fulfillment.stage": String(query.stage) });
  if (query.assignment) {
    assert(mongoose.isValidObjectId(query.assignment), "Invalid assignment");
    clauses.push({ assignment: query.assignment });
  }
  if (query.important === "true") clauses.push({ important: true });
  if (query.issues === "true")
    clauses.push({ issues: { $elemMatch: { status: "OPEN" } } });
  if (query.from || query.to) {
    const range = {};
    if (query.from) {
      assert(!isNaN(Date.parse(query.from)), "Invalid date");
      range.$gte = new Date(query.from);
    }
    if (query.to) {
      assert(!isNaN(Date.parse(query.to)), "Invalid date");
      range.$lte = new Date(
        query.to.length === 10 ? `${query.to}T23:59:59.999Z` : query.to,
      );
    }
    clauses.push({ createdAt: range });
  }
  if (query.search) {
    const term = String(query.search)
      .slice(0, 120)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const alternatives = ["orderNumber", "customer.name", "customer.phone"].map(
      (key) => ({ [key]: { $regex: term, $options: "i" } }),
    );
    try {
      alternatives.push({ "customer.phone": normalizePhone(query.search) });
    } catch {
      /* Name/reference search. */
    }
    clauses.push({ $or: alternatives });
  }
  return { $and: clauses };
}
module.exports = {
  create,
  act,
  scope,
  filters,
  present,
  receipt,
  allocateNumber,
};
