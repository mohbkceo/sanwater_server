const mongoose = require("mongoose");
const { fail } = require("./domain");
async function transaction(fn) {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid")
    fail(
      "E-commerce writes require MongoDB transaction support. Database configuration was not changed.",
      503,
      "TRANSACTIONS_REQUIRED",
    );
  return mongoose.connection.transaction(fn, {
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" },
  });
}
module.exports = transaction;
