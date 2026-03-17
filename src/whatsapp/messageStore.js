const {
  normalizeJid,
  extractMessageSenderJid,
  extractViewOnceMediaFromContent
} = require("./content");
const { isSameJid } = require("./group");
const { downloadMediaBuffer } = require("./sticker");

class MessageStore {
  constructor({
    maxPerChat = 1000,
    maxDeletedPerChat = 300,
    maxViewOnceCachePerChat = 80,
    maxViewOnceTotalBytes = 160 * 1024 * 1024,
    ttlMs = 24 * 60 * 60 * 1000
  } = {}) {
    this.maxPerChat = Number(maxPerChat);
    this.maxDeletedPerChat = Number(maxDeletedPerChat);
    this.maxViewOnceCachePerChat = Number(maxViewOnceCachePerChat);
    this.maxViewOnceTotalBytes = Math.max(10 * 1024 * 1024, Number(maxViewOnceTotalBytes) || 0);
    this.ttlMs = Number(ttlMs);
    this.byChat = new Map();
    this.deletedByChat = new Map();
    this.viewOnceCacheByChat = new Map();
  }

  bind(eventEmitter) {
    eventEmitter.on("messages.upsert", ({ messages }) => {
      for (const message of messages || []) {
        this.saveMessage(message);
        this.cacheIncomingViewOnceMedia(message).catch(() => {
          // keep store flow resilient
        });
      }
    });
    eventEmitter.on("messages.update", (updates) => {
      for (const update of updates || []) {
        this.captureDeletedMessage(update);
      }
    });
  }

  saveMessage(message) {
    const chatId = normalizeJid(message?.key?.remoteJid);
    const messageId = String(message?.key?.id || "");
    if (!chatId || !messageId) {
      return;
    }

    const now = Date.now();
    const timestampSeconds = Number(message?.messageTimestamp || 0);
    const timestampMs = timestampSeconds > 0 ? timestampSeconds * 1000 : now;

    const existing = this.byChat.get(chatId) || [];
    const filtered = existing.filter((entry) => now - entry.storedAt <= this.ttlMs && entry.message?.key?.id !== messageId);
    const updated = [{ message, storedAt: now, timestampMs }, ...filtered]
      .sort((a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0))
      .slice(0, this.maxPerChat);

    this.byChat.set(chatId, updated);
  }

  async loadMessage(chatId, messageId) {
    return this.loadMessageSync(chatId, messageId);
  }

  loadMessageSync(chatId, messageId) {
    const normalizedChatId = normalizeJid(chatId);
    const normalizedMessageId = String(messageId || "");

    if (!normalizedChatId || !normalizedMessageId) {
      return null;
    }

    const messages = this.byChat.get(normalizedChatId) || [];
    return messages.find((entry) => entry.message?.key?.id === normalizedMessageId)?.message || null;
  }

  listMessages(chatId) {
    const normalizedChatId = normalizeJid(chatId);
    if (!normalizedChatId) {
      return [];
    }

    const now = Date.now();
    const messages = this.byChat.get(normalizedChatId) || [];
    const fresh = messages
      .filter((entry) => now - entry.storedAt <= this.ttlMs)
      .sort((a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0));

    return fresh.map((entry) => entry.message).filter(Boolean);
  }

  getViewOnceEntrySize(entry) {
    return Math.max(0, Number(entry?.sizeBytes || 0));
  }

  sanitizeViewOnceCache() {
    const now = Date.now();

    for (const [chatId, entries] of this.viewOnceCacheByChat.entries()) {
      const normalized = Array.isArray(entries)
        ? entries
          .filter((entry) => now - Number(entry?.storedAt || 0) <= this.ttlMs)
          .filter((entry) => Buffer.isBuffer(entry?.buffer) && entry.buffer.length > 0)
          .map((entry) => ({
            ...entry,
            sizeBytes: Number(entry?.sizeBytes || entry.buffer?.length || 0)
          }))
        : [];

      const trimmed = normalized
        .sort((a, b) => Number(b?.storedAt || 0) - Number(a?.storedAt || 0))
        .slice(0, this.maxViewOnceCachePerChat);

      if (trimmed.length) {
        this.viewOnceCacheByChat.set(chatId, trimmed);
      } else {
        this.viewOnceCacheByChat.delete(chatId);
      }
    }
  }

  getViewOnceTotalBytes() {
    let total = 0;
    for (const entries of this.viewOnceCacheByChat.values()) {
      for (const entry of entries || []) {
        total += this.getViewOnceEntrySize(entry);
      }
    }
    return total;
  }

  evictOldestViewOnceEntry() {
    let oldestChatId = "";
    let oldestIndex = -1;
    let oldestTs = Infinity;

    for (const [chatId, entries] of this.viewOnceCacheByChat.entries()) {
      for (let i = 0; i < (entries || []).length; i += 1) {
        const entry = entries[i];
        const ts = Number(entry?.storedAt || 0);
        if (ts < oldestTs) {
          oldestTs = ts;
          oldestChatId = chatId;
          oldestIndex = i;
        }
      }
    }

    if (!oldestChatId || oldestIndex < 0) {
      return false;
    }

    const list = [...(this.viewOnceCacheByChat.get(oldestChatId) || [])];
    list.splice(oldestIndex, 1);
    if (list.length) {
      this.viewOnceCacheByChat.set(oldestChatId, list);
    } else {
      this.viewOnceCacheByChat.delete(oldestChatId);
    }
    return true;
  }

  enforceViewOnceLimits() {
    this.sanitizeViewOnceCache();

    if (!this.maxViewOnceTotalBytes || this.maxViewOnceTotalBytes <= 0) {
      return;
    }

    let total = this.getViewOnceTotalBytes();
    while (total > this.maxViewOnceTotalBytes) {
      const removed = this.evictOldestViewOnceEntry();
      if (!removed) {
        break;
      }
      total = this.getViewOnceTotalBytes();
    }
  }

  getFreshViewOnceCache(chatId) {
    const normalizedChatId = normalizeJid(chatId);
    if (!normalizedChatId) {
      return [];
    }

    this.enforceViewOnceLimits();
    const cached = this.viewOnceCacheByChat.get(normalizedChatId) || [];
    return [...cached].sort((a, b) => Number(b?.storedAt || 0) - Number(a?.storedAt || 0));
  }

  getCachedViewOnceByMessageId(chatId, messageId) {
    const normalizedChatId = normalizeJid(chatId);
    const normalizedMessageId = String(messageId || "");
    if (!normalizedChatId || !normalizedMessageId) {
      return null;
    }

    const fresh = this.getFreshViewOnceCache(normalizedChatId);
    return fresh.find((entry) => String(entry?.messageId || "") === normalizedMessageId) || null;
  }

  findLatestCachedViewOnceBySender(chatId, senderJid, mediaType = ["image", "video"]) {
    const normalizedChatId = normalizeJid(chatId);
    const normalizedSenderJid = normalizeJid(senderJid);
    if (!normalizedChatId || !normalizedSenderJid) {
      return null;
    }

    const acceptedTypes = Array.isArray(mediaType)
      ? mediaType.map((type) => String(type || "").toLowerCase())
      : [String(mediaType || "").toLowerCase()];
    const fresh = this.getFreshViewOnceCache(normalizedChatId);
    return fresh.find((entry) => {
      return acceptedTypes.includes(String(entry?.mediaType || "").toLowerCase()) && isSameJid(entry?.senderJid, normalizedSenderJid);
    }) || null;
  }

  async cacheIncomingViewOnceMedia(message) {
    const chatId = normalizeJid(message?.key?.remoteJid);
    const messageId = String(message?.key?.id || "");
    if (!chatId || !messageId) {
      return;
    }

    if (this.getCachedViewOnceByMessageId(chatId, messageId)) {
      return;
    }

    const viewOnce = extractViewOnceMediaFromContent(message?.message || null);
    const mediaType = String(viewOnce?.mediaType || "");
    if (!viewOnce || (mediaType !== "image" && mediaType !== "video")) {
      return;
    }

    let buffer = null;
    try {
      buffer = await downloadMediaBuffer(viewOnce.media, mediaType);
    } catch {
      return;
    }

    if (!buffer || !buffer.length || buffer.length > 25 * 1024 * 1024) {
      return;
    }

    const now = Date.now();
    const senderJid = extractMessageSenderJid(message);
    const current = this.getFreshViewOnceCache(chatId);
    const filtered = current.filter((entry) => String(entry?.messageId || "") !== messageId);
    const updated = [
      {
        messageId,
        senderJid,
        mediaType,
        mimetype: viewOnce.media?.mimetype || (mediaType === "video" ? "video/mp4" : "image/jpeg"),
        caption: viewOnce.media?.caption || "",
        buffer,
        sizeBytes: Number(buffer.length || 0),
        storedAt: now
      },
      ...filtered
    ]
      .sort((a, b) => Number(b?.storedAt || 0) - Number(a?.storedAt || 0))
      .slice(0, this.maxViewOnceCachePerChat);

    this.viewOnceCacheByChat.set(chatId, updated);
    this.enforceViewOnceLimits();
  }

  captureDeletedMessage(update) {
    const chatId = normalizeJid(update?.key?.remoteJid);
    const originalMessageId = String(update?.key?.id || "");
    const revokeKey = update?.update?.key;
    const isDeletedEvent = update?.update?.message === null && String(revokeKey?.id || "").length > 0;

    if (!chatId || !originalMessageId || !isDeletedEvent) {
      return;
    }

    const originalMessage = this.loadMessageSync(chatId, originalMessageId);
    if (!originalMessage?.message) {
      return;
    }

    const deletedByJid = normalizeJid(
      revokeKey?.participant ||
      revokeKey?.remoteJid ||
      originalMessage?.key?.participant ||
      originalMessage?.key?.remoteJid
    );
    const now = Date.now();
    const existing = this.deletedByChat.get(chatId) || [];
    const filtered = existing.filter((entry) => {
      const withinTtl = now - Number(entry?.deletedAt || 0) <= this.ttlMs;
      const differentMessage = String(entry?.originalMessageId || "") !== originalMessageId;
      return withinTtl && differentMessage;
    });
    const updated = [
      {
        originalMessageId,
        deletedAt: now,
        deletedByJid,
        message: originalMessage
      },
      ...filtered
    ]
      .sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0))
      .slice(0, this.maxDeletedPerChat);

    this.deletedByChat.set(chatId, updated);
  }

  listDeletedMessagesByUser(chatId, userJid, limit = 1) {
    const normalizedChatId = normalizeJid(chatId);
    const normalizedUserJid = normalizeJid(userJid);
    if (!normalizedChatId || !normalizedUserJid) {
      return [];
    }

    const maxItems = Math.max(1, Math.min(50, Number(limit || 1)));
    const now = Date.now();
    const entries = this.deletedByChat.get(normalizedChatId) || [];
    const fresh = entries
      .filter((entry) => now - Number(entry?.deletedAt || 0) <= this.ttlMs)
      .sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0));

    this.deletedByChat.set(normalizedChatId, fresh);
    return fresh
      .filter((entry) => isSameJid(entry?.deletedByJid, normalizedUserJid))
      .slice(0, maxItems);
  }
}

module.exports = MessageStore;
