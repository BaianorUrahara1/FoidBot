const fs = require("fs");
const path = require("path");
const { normalizeJid } = require("../whatsapp/content");

const MIN_TEXT_LENGTH = 3;
const SHORT_TEXT_LENGTH = 8;
const NORMAL_MIN_INTERVAL_MS = 9000;
const SHORT_MIN_INTERVAL_MS = 18000;
const REPEAT_WINDOW_MS = 5 * 60 * 1000;
const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_LIMIT = 30;
const DEFAULT_SAVE_DEBOUNCE_MS = 1500;

function toSafeInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

class RatingStore {
  constructor({ filePath, saveDebounceMs = DEFAULT_SAVE_DEBOUNCE_MS, ratingGroupJid = "" } = {}) {
    this.filePath = path.resolve(filePath || path.join(process.cwd(), "data", "rating-state.json"));
    this.saveDebounceMs = Math.max(150, toSafeInt(saveDebounceMs) || DEFAULT_SAVE_DEBOUNCE_MS);
    this.ratingGroupJid = normalizeJid(ratingGroupJid || "");
    this.loaded = false;
    this.pendingSaveTimer = null;
    this.state = {
      version: 1,
      users: {},
      migrations: {}
    };

    this.onProcessExit = () => {
      this.flush();
    };
    process.once("beforeExit", this.onProcessExit);
    process.once("exit", this.onProcessExit);
  }

  ensureLoaded() {
    if (this.loaded) {
      return;
    }

    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        if (parsed && typeof parsed === "object" && parsed.users && typeof parsed.users === "object") {
          this.state = {
            version: Number(parsed.version || 1),
            users: parsed.users,
            migrations: parsed.migrations && typeof parsed.migrations === "object"
              ? parsed.migrations
              : {}
          };
        }
      } catch {
        // keep default state and rewrite clean file below
      }
    }

    this.migrateScopeToRatingGroup();
    this.loaded = true;
    this.scheduleSave({ immediate: true });
  }

  writeNow() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  scheduleSave({ immediate = false } = {}) {
    if (this.pendingSaveTimer) {
      clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = null;
    }

    if (immediate) {
      this.writeNow();
      return;
    }

    this.pendingSaveTimer = setTimeout(() => {
      this.pendingSaveTimer = null;
      this.writeNow();
    }, this.saveDebounceMs);
  }

  flush() {
    if (this.pendingSaveTimer) {
      clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = null;
    }

    if (!this.loaded) {
      return;
    }

    this.writeNow();
  }

  normalizeTrackedJid(jid) {
    const normalized = normalizeJid(jid);
    if (!normalized) {
      return "";
    }
    if (normalized.endsWith("@g.us") || normalized.endsWith("@broadcast")) {
      return "";
    }
    return normalized;
  }

  normalizeTrackedChatId(chatId) {
    const normalized = normalizeJid(chatId);
    if (!normalized) {
      return "";
    }
    if (normalized.endsWith("@broadcast")) {
      return "";
    }
    return normalized;
  }

  migrateScopeToRatingGroup() {
    if (!this.ratingGroupJid) {
      return;
    }

    if (!this.state.migrations || typeof this.state.migrations !== "object") {
      this.state.migrations = {};
    }
    const migrationKey = "rating_group_scope_v1";
    const alreadyScopedTo = String(this.state.migrations[migrationKey] || "");
    if (alreadyScopedTo === this.ratingGroupJid) {
      // continue to prune migration below
    } else {
      for (const entry of Object.values(this.state.users || {})) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const total = toSafeInt(entry.messages);
        entry.messagesByChat = {
          [this.ratingGroupJid]: total
        };
      }

      this.state.migrations[migrationKey] = this.ratingGroupJid;
      this.state.migrations[`${migrationKey}_at`] = Date.now();
    }

    const pruneMigrationKey = "rating_group_prune_v2";
    const alreadyPrunedTo = String(this.state.migrations[pruneMigrationKey] || "");
    if (alreadyPrunedTo === this.ratingGroupJid) {
      return;
    }

    const scopedUsers = {};
    for (const [jid, entryRaw] of Object.entries(this.state.users || {})) {
      const entry = entryRaw && typeof entryRaw === "object" ? entryRaw : {};
      const map = entry.messagesByChat && typeof entry.messagesByChat === "object"
        ? entry.messagesByChat
        : {};
      const scopedFromMap = toSafeInt(map[this.ratingGroupJid]);
      const scopedCount = scopedFromMap > 0 ? scopedFromMap : toSafeInt(entry.messages);
      if (scopedCount <= 0) {
        continue;
      }

      scopedUsers[jid] = {
        ...entry,
        messages: scopedCount,
        messagesByChat: {
          [this.ratingGroupJid]: scopedCount
        },
        // antiSpam antigo pode vir de outros grupos; reinicia para evitar heranca
        antiSpam: {},
        updatedAt: toSafeInt(entry.updatedAt) || Date.now()
      };
    }

    this.state.users = scopedUsers;
    this.state.migrations[pruneMigrationKey] = this.ratingGroupJid;
    this.state.migrations[`${pruneMigrationKey}_at`] = Date.now();
  }

  getScopedMessages(entry, chatId) {
    const normalizedChatId = this.normalizeTrackedChatId(chatId);
    if (!normalizedChatId) {
      return toSafeInt(entry?.messages);
    }
    const messagesByChat = entry?.messagesByChat || {};
    return toSafeInt(messagesByChat[normalizedChatId]);
  }

  ensureUser(jid) {
    const trackedJid = this.normalizeTrackedJid(jid);
    if (!trackedJid) {
      return { trackedJid: "", entry: null };
    }

    if (!this.state.users[trackedJid]) {
      this.state.users[trackedJid] = {
        messages: 0,
        updatedAt: Date.now()
      };
    }

    const entry = this.state.users[trackedJid];
    entry.messages = toSafeInt(entry.messages);
    entry.updatedAt = toSafeInt(entry.updatedAt) || Date.now();
    if (!entry.messagesByChat || typeof entry.messagesByChat !== "object") {
      entry.messagesByChat = {};
    }
    for (const chatKey of Object.keys(entry.messagesByChat)) {
      entry.messagesByChat[chatKey] = toSafeInt(entry.messagesByChat[chatKey]);
    }
    if (!entry.antiSpam || typeof entry.antiSpam !== "object") {
      entry.antiSpam = {};
    }
    const antiSpam = entry.antiSpam;
    antiSpam.lastCountedAt = toSafeInt(antiSpam.lastCountedAt);
    antiSpam.lastFingerprint = String(antiSpam.lastFingerprint || "");
    antiSpam.lastFingerprintAt = toSafeInt(antiSpam.lastFingerprintAt);
    antiSpam.recentCounted = Array.isArray(antiSpam.recentCounted)
      ? antiSpam.recentCounted.map(toSafeInt).filter((value) => value > 0)
      : [];
    return { trackedJid, entry };
  }

  registerMessageActivity(jid, { text = "", isCommand = false, timestampMs = Date.now(), sourceChatId = "" } = {}) {
    this.ensureLoaded();
    const { trackedJid, entry } = this.ensureUser(jid);
    if (!trackedJid || !entry) {
      return { counted: false, reason: "INVALID_JID" };
    }

    const normalized = normalizeText(text);
    if (!normalized || normalized.length < MIN_TEXT_LENGTH) {
      return { counted: false, reason: "TEXT_TOO_SHORT" };
    }

    if (isCommand) {
      return { counted: false, reason: "COMMAND_MESSAGE" };
    }

    const now = Math.max(Date.now(), toSafeInt(timestampMs));
    const antiSpam = entry.antiSpam;

    antiSpam.recentCounted = antiSpam.recentCounted.filter((ts) => now - ts <= BURST_WINDOW_MS);
    if (antiSpam.recentCounted.length >= BURST_LIMIT) {
      return { counted: false, reason: "BURST_LIMIT" };
    }

    const minInterval = normalized.length < SHORT_TEXT_LENGTH
      ? SHORT_MIN_INTERVAL_MS
      : NORMAL_MIN_INTERVAL_MS;
    if (antiSpam.lastCountedAt > 0 && now - antiSpam.lastCountedAt < minInterval) {
      return { counted: false, reason: "COOLDOWN" };
    }

    if (
      antiSpam.lastFingerprint &&
      antiSpam.lastFingerprint === normalized &&
      antiSpam.lastFingerprintAt > 0 &&
      now - antiSpam.lastFingerprintAt <= REPEAT_WINDOW_MS
    ) {
      return { counted: false, reason: "REPEATED_TEXT" };
    }

    entry.messages = toSafeInt(entry.messages) + 1;
    const normalizedSourceChatId = this.normalizeTrackedChatId(sourceChatId);
    if (normalizedSourceChatId) {
      entry.messagesByChat[normalizedSourceChatId] = toSafeInt(entry.messagesByChat[normalizedSourceChatId]) + 1;
    }
    entry.updatedAt = now;
    antiSpam.lastCountedAt = now;
    antiSpam.lastFingerprint = normalized;
    antiSpam.lastFingerprintAt = now;
    antiSpam.recentCounted.push(now);
    if (antiSpam.recentCounted.length > BURST_LIMIT * 4) {
      antiSpam.recentCounted = antiSpam.recentCounted.slice(-BURST_LIMIT * 4);
    }

    this.scheduleSave();
    return {
      counted: true,
      reason: "COUNTED",
      jid: trackedJid,
      messages: entry.messages,
      messagesInSourceChat: normalizedSourceChatId ? toSafeInt(entry.messagesByChat[normalizedSourceChatId]) : entry.messages
    };
  }

  incrementMessage(jid, amount = 1) {
    this.ensureLoaded();
    const { trackedJid, entry } = this.ensureUser(jid);
    if (!trackedJid || !entry) {
      return null;
    }

    entry.messages = toSafeInt(entry.messages) + Math.max(1, toSafeInt(amount));
    entry.updatedAt = Date.now();
    this.scheduleSave();
    return {
      jid: trackedJid,
      messages: entry.messages
    };
  }

  getUserStats(jid, { chatId = "" } = {}) {
    this.ensureLoaded();
    const { trackedJid, entry } = this.ensureUser(jid);
    if (!trackedJid || !entry) {
      return {
        jid: "",
        messages: 0
      };
    }
    return {
      jid: trackedJid,
      messages: this.getScopedMessages(entry, chatId),
      updatedAt: toSafeInt(entry.updatedAt)
    };
  }

  listTopUsers(limit = 5, { chatId = "" } = {}) {
    this.ensureLoaded();
    const rows = Object.entries(this.state.users)
      .map(([jid, entry]) => ({
        jid,
        messages: this.getScopedMessages(entry || {}, chatId),
        updatedAt: toSafeInt(entry?.updatedAt)
      }))
      .filter((entry) => entry.jid && entry.messages > 0)
      .sort((a, b) => {
        if (b.messages !== a.messages) {
          return b.messages - a.messages;
        }
        return a.updatedAt - b.updatedAt;
      });

    return rows.slice(0, Math.max(1, Number(limit) || 5));
  }
}

module.exports = RatingStore;
