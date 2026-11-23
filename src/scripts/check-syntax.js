const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? files(path.join(dir, e.name))
        : e.name.endsWith(".js")
          ? [path.join(dir, e.name)]
          : [],
    );
}
let failed = false;
for (const file of [
  ...files(path.join(__dirname, "..")),
  ...files(path.join(__dirname, "../../test")),
]) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status) {
    process.stderr.write(result.stderr);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
else
  console.log(
    "Backend source and test syntax checks passed. Express has no compile step.",
  );
