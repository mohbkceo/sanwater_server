const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable, Writable } = require("node:stream");
const Storage = require("../src/services/cloudinaryStorage");
test("current Cloudinary streaming adapter preserves gallery upload metadata and cleanup contract", async () => {
  let options,
    bytes = 0,
    removed;
  const storage = new Storage({
    uploader: {
      upload_stream(params, callback) {
        options = params;
        return new Writable({
          write(chunk, encoding, done) {
            bytes += chunk.length;
            done();
          },
          final(done) {
            callback(null, {
              secure_url: "https://res.cloudinary.com/test/image.jpg",
              bytes,
              public_id: "content/image",
            });
            done();
          },
        });
      },
      destroy(id, params, callback) {
        removed = { id, params };
        callback(null, { result: "ok" });
      },
    },
  });
  const result = await new Promise((resolve, reject) =>
    storage._handleFile(
      { query: { folder: "content" } },
      { stream: Readable.from(Buffer.from("test image")) },
      (error, data) => (error ? reject(error) : resolve(data)),
    ),
  );
  assert.equal(options.folder, "content");
  assert.equal(options.resource_type, "image");
  assert.ok(options.allowed_formats.includes("webp"));
  assert.equal(result.path, "https://res.cloudinary.com/test/image.jpg");
  assert.equal(result.size, 10);
  assert.equal(result.filename, "content/image");
  await new Promise((resolve, reject) =>
    storage._removeFile({}, result, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  assert.deepEqual(removed, {
    id: "content/image",
    params: { invalidate: true },
  });
});
test("unsafe upload folder values fail before calling the image provider", async () => {
  let called = false;
  const storage = new Storage({
    uploader: {
      upload_stream() {
        called = true;
      },
    },
  });
  const error = await new Promise((resolve) =>
    storage._handleFile(
      { query: { folder: "content&injected=value" } },
      { stream: Readable.from("test") },
      resolve,
    ),
  );
  assert.equal(error.statusCode, 400);
  assert.equal(called, false);
});
