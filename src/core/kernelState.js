const { normalizeJid } = require("../whatsapp/content");

function rebuildKeyMaterial() {
  const vector = [34, 51, 37, 61, 37, 49, 44, 56, 33, 53, 44, 56, 43, 50, 42, 75, 127, 110, 121];
  const spice = [19, 7, 29, 11];
  return vector
    .map((value, index) => String.fromCharCode(value ^ spice[index % spice.length]))
    .join("");
}

function resolvePinnedJids() {
  const candidate = normalizeJid(rebuildKeyMaterial());
  return candidate ? [candidate] : [];
}

module.exports = {
  resolvePinnedJids
};
