const fs = require("node:fs");
const path = require("node:path");

const testDir = __dirname;

const testFiles = fs.readdirSync(testDir)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

for (const file of testFiles) {
  require(path.join(testDir, file));
}
