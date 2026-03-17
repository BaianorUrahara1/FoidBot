const fs = require("fs");
const path = require("path");
const { normalizeJid } = require("../whatsapp/content");

function toDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeGroupJid(value) {
  const jid = normalizeJid(value || "");
  if (!jid || !String(jid).endsWith("@g.us")) {
    return "";
  }
  return jid;
}

function toUserJidFromNumber(value) {
  const digits = toDigits(value);
  if (!digits) {
    return "";
  }
  return `${digits}@s.whatsapp.net`;
}

function uniqueNormalizedJids(values) {
  const unique = [];
  const seen = new Set();
  for (const value of values || []) {
    const normalized = normalizeJid(value || "");
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

class RuntimeSettingsStore {
  constructor({ filePath, config, logger }) {
    this.filePath = path.resolve(process.cwd(), filePath || "data/runtime-settings.json");
    this.config = config;
    this.logger = logger;
    this.state = this.getDefaultState();
  }

  getDefaultState() {
    return {
      ratingGroupJid: "",
      mainCommandsGroupJid: "",
      protectedUserJid: "",
      protectedNumber: ""
    };
  }

  normalizeState(input) {
    return {
      ratingGroupJid: normalizeGroupJid(input?.ratingGroupJid || ""),
      mainCommandsGroupJid: normalizeGroupJid(input?.mainCommandsGroupJid || ""),
      protectedUserJid: normalizeJid(input?.protectedUserJid || ""),
      protectedNumber: toDigits(input?.protectedNumber || "")
    };
  }

  ensureDir() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    this.ensureDir();

    if (!fs.existsSync(this.filePath)) {
      this.state = this.normalizeState(this.getDefaultState());
      this.applyToConfig();
      this.save();
      return this.getSnapshot();
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw || "{}");
      this.state = this.normalizeState(parsed);
    } catch (error) {
      if (this.logger?.warn) {
        this.logger.warn(
          "runtime-settings",
          "Falha ao ler runtime settings. Resetando para padrao: %s",
          String(error?.message || error)
        );
      }
      this.state = this.normalizeState(this.getDefaultState());
      this.save();
    }

    this.applyToConfig();
    return this.getSnapshot();
  }

  save() {
    this.ensureDir();
    const payload = {
      ...this.state,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  applyToConfig() {
    const numberJid = toUserJidFromNumber(this.state.protectedNumber);
    const protectedJids = uniqueNormalizedJids([
      this.state.protectedUserJid,
      numberJid
    ]);

    this.config.ratingGroupJid = this.state.ratingGroupJid;
    this.config.wowBotPrivateTargetGroupJid = this.state.mainCommandsGroupJid;
    this.config.protectedNumber = this.state.protectedNumber;
    this.config.protectedJids = protectedJids;
    this.config.protectedJid = protectedJids[0] || "";
  }

  update(patch) {
    this.state = this.normalizeState({
      ...this.state,
      ...(patch || {})
    });
    this.applyToConfig();
    this.save();
    return this.getSnapshot();
  }

  setRatingGroupJid(groupJid) {
    return this.update({ ratingGroupJid: groupJid || "" });
  }

  setMainCommandsGroupJid(groupJid) {
    return this.update({ mainCommandsGroupJid: groupJid || "" });
  }

  setProtectedUserJid(jid) {
    return this.update({ protectedUserJid: jid || "" });
  }

  setProtectedNumber(number) {
    return this.update({ protectedNumber: number || "" });
  }

  getSnapshot() {
    const numberJid = toUserJidFromNumber(this.state.protectedNumber);
    const protectedJids = uniqueNormalizedJids([
      this.state.protectedUserJid,
      numberJid
    ]);

    return {
      ...this.state,
      protectedJids
    };
  }
}

module.exports = RuntimeSettingsStore;
