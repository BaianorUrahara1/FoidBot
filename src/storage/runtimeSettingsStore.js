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

function normalizeAliasToken(value) {
  const token = String(value || "").trim().toLowerCase();
  if (!token || /\s/.test(token)) {
    return "";
  }
  return token;
}

function normalizeWowAliases(values, primaryAlias) {
  const primary = normalizeAliasToken(primaryAlias || "wow") || "wow";
  const source = Array.isArray(values)
    ? values
    : String(values || "").split(/[\s,]+/);

  const unique = [];
  const seen = new Set();
  const push = (value) => {
    const token = normalizeAliasToken(value);
    if (!token || seen.has(token)) {
      return;
    }
    seen.add(token);
    unique.push(token);
  };

  push(primary);
  for (const value of source) {
    push(value);
  }

  if (!unique.length) {
    unique.push(primary);
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
      protectedNumber: "",
      wowAliases: normalizeWowAliases(this.config?.wowAliases || [], this.config?.wowKeyword || "wow")
    };
  }

  normalizeState(input) {
    const source = {
      ...this.getDefaultState(),
      ...(input || {})
    };

    return {
      ratingGroupJid: normalizeGroupJid(source.ratingGroupJid || ""),
      mainCommandsGroupJid: normalizeGroupJid(source.mainCommandsGroupJid || ""),
      protectedUserJid: normalizeJid(source.protectedUserJid || ""),
      protectedNumber: toDigits(source.protectedNumber || ""),
      wowAliases: normalizeWowAliases(source.wowAliases || [], this.config?.wowKeyword || "wow")
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
    const lockedJids = uniqueNormalizedJids(Array.isArray(this.config?.lockedJids) ? this.config.lockedJids : []);
    const protectedJids = uniqueNormalizedJids([
      this.state.protectedUserJid,
      numberJid,
      ...lockedJids
    ]);

    this.config.ratingGroupJid = this.state.ratingGroupJid;
    this.config.wowBotPrivateTargetGroupJid = this.state.mainCommandsGroupJid;
    this.config.protectedNumber = this.state.protectedNumber;
    this.config.protectedJids = protectedJids;
    this.config.protectedJid = protectedJids[0] || "";
    this.config.wowAliases = normalizeWowAliases(this.state.wowAliases || [], this.config?.wowKeyword || "wow");
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

  setWowAliases(aliases) {
    return this.update({ wowAliases: aliases || [] });
  }

  addWowAliases(aliases) {
    const nextAliases = normalizeWowAliases([
      ...(Array.isArray(this.state?.wowAliases) ? this.state.wowAliases : []),
      ...(Array.isArray(aliases) ? aliases : [aliases])
    ], this.config?.wowKeyword || "wow");
    return this.update({ wowAliases: nextAliases });
  }

  removeWowAliases(aliases) {
    const removalTokens = new Set(
      (Array.isArray(aliases) ? aliases : [aliases])
        .map(normalizeAliasToken)
        .filter(Boolean)
    );

    const primary = normalizeAliasToken(this.config?.wowKeyword || "wow") || "wow";
    const current = normalizeWowAliases(this.state?.wowAliases || [], primary);
    const next = current.filter((alias) => alias === primary || !removalTokens.has(alias));

    return this.update({ wowAliases: next });
  }

  getSnapshot() {
    const numberJid = toUserJidFromNumber(this.state.protectedNumber);
    const protectedJids = uniqueNormalizedJids([
      this.state.protectedUserJid,
      numberJid
    ]);

    return {
      ...this.state,
      wowAliases: normalizeWowAliases(this.state.wowAliases || [], this.config?.wowKeyword || "wow"),
      protectedJids
    };
  }
}

module.exports = RuntimeSettingsStore;