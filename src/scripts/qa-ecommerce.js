// Disposable local browser QA. Always creates a fresh in-memory replica set.
// Never reads MONGO_URI and never connects to an existing database.
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const { generateKeyPairSync } = require("node:crypto");
const bcrypt = require("bcryptjs");
async function main() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  Object.assign(process.env, {
    NODE_ENV: "production",
    PRIVATE_KEY: privateKey,
    PUBLIC_KEY: publicKey,
    ECOMMERCE_CHECKOUT_ENABLED: "true",
    ECOMMERCE_PARTIAL_PAYMENTS: "true",
  });
  const repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.14" },
  });
  await mongoose.connect(repl.getUri());
  const app = require("../app");
  const Product = require("../models/product.model"),
    Shipping = require("../models/shippingConfig.model"),
    User = require("../models/user.model");
  const Order = require("../models/ecommerceOrder.model"),
    Customer = require("../models/customer.model"),
    support = require("../models/commerceSupport.model");
  await Promise.all(
    [Product, Shipping, User, Order, Customer, ...Object.values(support)].map(
      (m) => m.init(),
    ),
  );
  const user = await User.create({
    fullName: "Local QA",
    email: "qa@example.test",
    password: await bcrypt.hash("qa-local-only", 10),
    role: "super_admin",
  });
  const catalog = require("../services/ecommerce/catalog.service"),
    { generateVariants } = require("../services/ecommerce/domain");
  await Shipping.create({
    _id: "noest",
    revision: 1,
    wilayas: [
      {
        code: "16",
        name: "Alger",
        homePrice: 400,
        stopDeskPrice: 250,
        homeEnabled: true,
        stopDeskEnabled: true,
        communes: [
          {
            code: "01",
            name: "Dar El Beida",
            homeEnabled: true,
            stopDeskEnabled: true,
            offices: [
              {
                code: "A",
                name: "Bureau central",
                address: "Avenue principale",
                enabled: true,
              },
            ],
          },
        ],
      },
    ],
  });
  const options = [
    { name: "Couleur", values: ["Noir", "Gris"] },
    { name: "Taille", values: ["60 cm", "90 cm"] },
  ];
  const p = await catalog.save(
    null,
    {
      revision: 0,
      name: "Étagère aluminium",
      productId: "QA-SHELF",
      description:
        "Étagère de salle de bain en aluminium. Finition durable et entretien facile.",
      gallery: [],
      basePrice: 4500,
      salesMode: "ecommerce",
      commerce: {
        published: true,
        options,
        variants: generateVariants(options, [], "QA").map((v) => ({
          ...v,
          trackStock: true,
          quantity: 20,
        })),
        offer: { enabled: true, type: "percentage", value: 10 },
      },
    },
    { uid: user._id, email: user.email },
  );
  const server = app.listen(4100, "127.0.0.1", () =>
    console.log(
      `Disposable QA API at http://localhost:4100; product ${p.serialNumber}; login qa@example.test / qa-local-only`,
    ),
  );
  async function stop() {
    server.close();
    await mongoose.disconnect();
    await repl.stop();
    process.exit(0);
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
