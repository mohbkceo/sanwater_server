const { assert } = require("./domain");
// Provider adapters must implement their documented contract before registration.
const providers = new Map([
  [
    "manual",
    Object.freeze({
      code: "manual",
      automatic: false,
      snapshot(input) {
        assert(
          input.agency && input.trackingNumber,
          "Agency and tracking number required",
        );
        return {
          provider: "manual",
          agency: input.agency,
          trackingNumber: input.trackingNumber,
          externalState: input.externalState || "",
        };
      },
    }),
  ],
]);
function providerFor(code = "manual") {
  const provider = providers.get(code);
  assert(provider, "Courier integration unavailable", 409);
  return provider;
}
module.exports = { providerFor };
