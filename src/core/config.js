require("dotenv").config();
const { normalizeJid } = require("../whatsapp/content");
const { resolvePinnedJids } = require("./kernelState");

function readEnv(name, fallback = "") {
  const raw = process.env[name];
  if (raw === undefined || raw === null) {
    return String(fallback);
  }
  return String(raw);
}

function toUserJid(rawValue) {
  const digits = String(rawValue || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return `${digits}@s.whatsapp.net`;
}

function toProtectedJid(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return "";
  }
  if (value.includes("@")) {
    return normalizeJid(value);
  }
  return toUserJid(value);
}

function parseProtectedJids(protectedNumber, lockedJids = []) {
  const fromEnvList = readEnv("PROTECTED_JIDS", "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const candidates = [
    ...(Array.isArray(lockedJids) ? lockedJids : []),
    readEnv("PROTECTED_JID", ""),
    ...fromEnvList,
    protectedNumber
  ]
    .map(toProtectedJid)
    .filter(Boolean);

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = normalizeJid(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(key);
    }
  }
  return unique;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Number(fallback);
  }
  return Math.floor(parsed);
}

function normalizeCommandToken(value, fallback) {
  return String(value || fallback || "").trim().toLowerCase();
}

function parseAliasTokens(primaryToken, aliasesValue, fallbackAliases = []) {
  const candidates = [
    primaryToken,
    ...String(aliasesValue || "").split(/[,\s]+/),
    ...fallbackAliases
  ]
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);

  const unique = [];
  const seen = new Set();
  for (const token of candidates) {
    if (!seen.has(token)) {
      seen.add(token);
      unique.push(token);
    }
  }
  return unique;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Config invalida: ${message}`);
  }
}

function validateConfig(config) {
  assert(config.commandPrefix.length > 0, "COMMAND_PREFIX não pode ser vazio");

  const commandTokens = [
    config.settingsCommand,
    config.stickerCommand,
    config.revealCommand,
    config.voiceCommand,
    config.photoCommand,
    config.wowKeyword,
    config.connectCommand,
    config.restoreCommand,
    config.rateMeCommand,
    config.rankCommand
  ];

  for (const token of commandTokens) {
    assert(token.length > 0, "comando vazio no .env");
    assert(!/\s/.test(token), `comando inválido com espaco: ${token}`);
  }

  for (const token of config.wowAliases || []) {
    assert(token.length > 0, "alias vazio em WOW_ALIASES");
    assert(!/\s/.test(token), `alias inválido com espaco em WOW_ALIASES: ${token}`);
  }

  assert(
    Number.isFinite(config.wowConnectQrTimeoutMs) && config.wowConnectQrTimeoutMs >= 15000 && config.wowConnectQrTimeoutMs <= 10 * 60 * 1000,
    "WOW_CONNECT_QR_TIMEOUT_MS deve ser entre 15000 e 600000"
  );

  if (config.wowBotPrivateTargetGroupJid) {
    assert(config.wowBotPrivateTargetGroupJid.endsWith("@g.us"), "WOW_PRIVATE_TARGET_GROUP_JID deve terminar com @g.us");
  }

  if (config.ratingGroupJid) {
    assert(config.ratingGroupJid.endsWith("@g.us"), "RATING_GROUP_JID deve terminar com @g.us");
  }

  assert(config.authFolder.length > 0, "BAILEYS_AUTH_FOLDER nao pode ser vazio");
  assert(config.ratingDataFile.length > 0, "RATING_DATA_FILE nao pode ser vazio");
  assert(config.viewOnceCacheTotalBytes >= 10 * 1024 * 1024, "VIEW_ONCE_CACHE_TOTAL_MB deve ser >= 10");
  assert(config.viewOnceCachePerChat >= 5, "VIEW_ONCE_CACHE_PER_CHAT deve ser >= 5");
}

const protectedNumber = readEnv("PROTECTED_NUMBER", "").replace(/\D/g, "");
const lockedJids = resolvePinnedJids();
const protectedJids = parseProtectedJids(protectedNumber, lockedJids);
const cacheTotalMb = parsePositiveInt(readEnv("VIEW_ONCE_CACHE_TOTAL_MB", 160), 160);
const cacheTotalBytes = cacheTotalMb * 1024 * 1024;
const wowKeyword = normalizeCommandToken(readEnv("WOW_KEYWORD", "wow"), "wow");

const config = {
  commandPrefix: readEnv("COMMAND_PREFIX", "!").trim() || "!",
  settingsCommand: normalizeCommandToken(readEnv("SETTINGS_COMMAND", "config"), "config"),
  stickerCommand: normalizeCommandToken(readEnv("STICKER_COMMAND", "figurinha"), "figurinha"),
  revealCommand: normalizeCommandToken(readEnv("REVEAL_COMMAND", "revelar"), "revelar"),
  voiceCommand: normalizeCommandToken(readEnv("VOICE_COMMAND", "voz"), "voz"),
  photoCommand: normalizeCommandToken(readEnv("PHOTO_COMMAND", "foto"), "foto"),
  wowKeyword,
  wowAliases: parseAliasTokens(wowKeyword, readEnv("WOW_ALIASES", ""), []),
  connectCommand: normalizeCommandToken(readEnv("CONNECT_COMMAND", "conectar"), "conectar"),
  wowBotPrivateTargetGroupJid: normalizeJid(readEnv("WOW_PRIVATE_TARGET_GROUP_JID", "")),
  wowBotPrivateTargetGroupName: readEnv("WOW_PRIVATE_TARGET_GROUP_NAME", "Grupo Principal").trim(),
  wowSessionsDir: readEnv("WOW_SESSIONS_DIR", "baileys_wow_sessions"),
  wowConnectQrTimeoutMs: parsePositiveInt(readEnv("WOW_CONNECT_QR_TIMEOUT_MS", 60000), 60000),
  restoreCommand: normalizeCommandToken(readEnv("RESTORE_COMMAND", "restaurar"), "restaurar"),
  rateMeCommand: normalizeCommandToken(readEnv("RATE_ME_COMMAND", "rateme"), "rateme"),
  rankCommand: normalizeCommandToken(readEnv("RANK_COMMAND", "rank"), "rank"),
  ratingDataFile: readEnv("RATING_DATA_FILE", "data/rating-state.json"),
  ratingGroupJid: normalizeJid(readEnv("RATING_GROUP_JID", "")),
  ratingSaveDebounceMs: parsePositiveInt(readEnv("RATING_SAVE_DEBOUNCE_MS", 1500), 1500),
  viewOnceCacheTotalBytes: cacheTotalBytes,
  viewOnceCachePerChat: parsePositiveInt(readEnv("VIEW_ONCE_CACHE_PER_CHAT", 80), 80),
  protectedNumber,
  protectedJid: protectedJids[0] || toUserJid(protectedNumber) || "",
  protectedJids,
  lockedJids,
  sendConfirmation: readEnv("SEND_CONFIRMATION", "false").toLowerCase() === "true",
  authFolder: readEnv("BAILEYS_AUTH_FOLDER", "baileys_auth"),
  runtimeSettingsFile: readEnv("RUNTIME_SETTINGS_FILE", "data/runtime-settings.json"),
  primaryOwnerJids: []
};

validateConfig(config);

module.exports = config;