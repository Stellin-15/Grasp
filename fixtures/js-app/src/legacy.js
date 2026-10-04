const path = require("node:path");
const { add } = require("./utils/math.js");

function resolveAsset(name) {
  return path.join(__dirname, "assets", name);
}

exports.total = function (items) {
  return items.reduce((acc, x) => add(acc, x), 0);
};

module.exports.resolveAsset = resolveAsset;

if (require.main === module) {
  console.log(resolveAsset(process.argv[2]));
}
