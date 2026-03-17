const fs = require("fs");
const path = require("path");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");
const logger = require("../core/logger");
const MessageStore = require("../whatsapp/messageStore");
const executeWow = require("../commands/media/wow");
const { isSameJid } = require("../whatsapp/group");
const {
  normalizeJid,
  extractTextFromContent,
  extractContextInfo,
  extractMessageSenderJid
} = require("../whatsapp/content");

function hasRawCommand(text, rawCommands) {
  const tokens = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) {
    return false;
  }
  const head = String(tokens[0] || "").toLowerCase();
  const allowed = Array.isArray(rawCommands) ? rawCommands : [rawCommands];
  return allowed.some((command) => head === String(command || "").toLowerCase());
}

function toSessionFolderName(ownerJid) {
  return Buffer.from(String(ownerJid || ""), "utf8").toString("hex");
}

function extractUserToken(jid) {
  return String(jid || "")
    .trim()
    .toLowerCase()
    .split("@")[0]
    .split(":")[0];
}

function isSameUserLoose(jidA, jidB) {
  if (!jidA || !jidB) {
    return false;
  }
  if (isSameJid(jidA, jidB)) {
    return true;
  }
  const tokenA = extractUserToken(jidA);
  const tokenB = extractUserToken(jidB);
  return Boolean(tokenA && tokenA === tokenB);
}

class WowSessionManager {
  constructor({ config }) {
    this.config = config;
    this.sessions = new Map();
    this.socketLogger = pino({ level: "silent" });
    this.sessionRoot = path.resolve(process.cwd(), config.wowSessionsDir || "baileys_wow_sessions");
    this.defaultQrTimeoutMs = Math.max(15000, Number(config.wowConnectQrTimeoutMs || 60000));
    fs.mkdirSync(this.sessionRoot, { recursive: true });
  }

  findSessionEntryByUser(jid) {
    const normalized = normalizeJid(jid);
    if (!normalized) {
      return null;
    }

    for (const [key, session] of this.sessions.entries()) {
      if (!session) {
        continue;
      }
      if (isSameUserLoose(key, normalized) || isSameUserLoose(session.ownerJid, normalized)) {
        return { key, session };
      }
      const linked = Array.isArray(session.linkedJids) ? session.linkedJids : [];
      if (linked.some((candidate) => isSameUserLoose(candidate, normalized))) {
        return { key, session };
      }
    }
    return null;
  }

  clearSessionTimeout(session) {
    if (session?.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
      session.timeoutTimer = null;
    }
  }

  dropSession(ownerKey, session) {
    this.clearSessionTimeout(session);
    try {
      if (typeof session?.sock?.end === "function") {
        session.sock.end(new Error("WOW_SESSION_CLOSED"));
      }
    } catch {
      // ignore socket close errors
    }
    if (ownerKey) {
      this.sessions.delete(ownerKey);
    } else if (session?.ownerJid) {
      this.sessions.delete(session.ownerJid);
    }
    if (session) {
      session.state = "closed";
      session.disableReconnect = true;
    }
  }

  getSession(ownerJid) {
    const entry = this.findSessionEntryByUser(ownerJid);
    return entry?.session || null;
  }

  hasActiveSessionForJid(jid) {
    const normalizedTarget = normalizeJid(jid);
    if (!normalizedTarget) {
      return false;
    }

    for (const session of this.sessions.values()) {
      if (!session || session.state !== "open") {
        continue;
      }

      if (isSameUserLoose(session.ownerJid, normalizedTarget)) {
        return true;
      }

      const linked = Array.isArray(session.linkedJids) ? session.linkedJids : [];
      if (linked.some((candidate) => isSameUserLoose(candidate, normalizedTarget))) {
        return true;
      }
    }

    return false;
  }

  refreshSessionLinkedJids(session) {
    if (!session) {
      return;
    }
    const candidates = [
      session.ownerJid,
      normalizeJid(session?.sock?.user?.id),
      normalizeJid(session?.sock?.user?.lid)
    ].filter(Boolean);

    const unique = [];
    for (const candidate of candidates) {
      if (!unique.some((saved) => isSameUserLoose(saved, candidate))) {
        unique.push(candidate);
      }
    }
    session.linkedJids = unique;
  }

  resolveSenderJidForWow(session, message) {
    const chatId = normalizeJid(message?.key?.remoteJid);
    const fromGroup = String(chatId || "").endsWith("@g.us");
    const fromMessage = extractMessageSenderJid(message);
    if (fromGroup && fromMessage) {
      return fromMessage;
    }

    const linked = Array.isArray(session?.linkedJids) ? session.linkedJids : [];
    return linked[0] || session?.ownerJid || fromMessage || "";
  }

  getSessionAuthPath(ownerJid) {
    const folder = toSessionFolderName(ownerJid);
    return path.join(this.sessionRoot, folder);
  }

  async connect({
    ownerJid,
    preserveAuth = false,
    onQr,
    onOpen,
    onReauthRequired,
    onError,
    onTimeout
  } = {}) {
    const normalizedOwner = normalizeJid(ownerJid);
    if (!normalizedOwner) {
      return { status: "invalid" };
    }

    const existingEntry = this.findSessionEntryByUser(normalizedOwner);
    if (existingEntry?.session) {
      const existing = existingEntry.session;
      if (existing.state === "open") {
        return { status: "already_open", session: existing };
      }
      if (existing.state === "starting" || existing.state === "qr") {
        return { status: "starting", session: existing };
      }

      this.dropSession(existingEntry.key, existing);
    }

    const authPath = this.getSessionAuthPath(normalizedOwner);
    if (!preserveAuth) {
      try {
        fs.rmSync(authPath, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    }
    fs.mkdirSync(authPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const saveCredsSafe = async () => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          fs.mkdirSync(authPath, { recursive: true });
          await saveCreds();
          return;
        } catch (error) {
          const code = String(error?.code || "");
          if (code === "ENOENT") {
            try {
              fs.mkdirSync(authPath, { recursive: true });
            } catch {
              // ignore mkdir race errors
            }
            if (attempt < 3) {
              await new Promise((resolve) => setTimeout(resolve, 60));
              continue;
            }
          }
          logger.warn(
            "wow-sess",
            "Falha ao salvar credenciais da sessão %s: %s",
            normalizedOwner,
            String(error?.message || error)
          );
          return;
        }
      }
    };

    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      auth: state,
      version,
      logger: this.socketLogger,
      browser: ["FoidBot WOW", "Chrome", "1.0.0"],
      printQRInTerminal: false
    });

    const store = new MessageStore({
      maxViewOnceCachePerChat: this.config.viewOnceCachePerChat,
      maxViewOnceTotalBytes: this.config.viewOnceCacheTotalBytes
    });
    store.bind(sock.ev);

    const session = {
      ownerJid: normalizedOwner,
      state: "starting",
      authPath,
      sock,
      store,
      linkedJids: [normalizedOwner],
      qrSent: false,
      disableReconnect: false,
      timeoutTimer: null
    };
    this.sessions.set(normalizedOwner, session);
    logger.info("wow-sess", "Inicializando sessão WOW (qr) para %s", normalizedOwner);

    const clearTimeoutTimer = () => {
      this.clearSessionTimeout(session);
    };

    const qrTimeoutMs = Math.max(15000, Number(this.config.wowConnectQrTimeoutMs || this.defaultQrTimeoutMs));
    session.timeoutTimer = setTimeout(async () => {
      if (session.state === "open") {
        return;
      }

      session.disableReconnect = true;
      session.state = "expired";
      this.dropSession(normalizedOwner, session);
      logger.warn("wow-sess", "Sessão WOW expirada por timeout de autenticação (qr, %sms): %s", qrTimeoutMs, normalizedOwner);

      if (typeof onTimeout === "function") {
        try {
          await onTimeout({ mode: "qr" });
        } catch {
          // ignore callback failures
        }
      }
    }, qrTimeoutMs);

    sock.ev.on("creds.update", () => {
      saveCredsSafe().catch((error) => {
        logger.warn(
          "wow-sess",
          "Erro inesperado no saveCreds da sessão %s: %s",
          normalizedOwner,
          String(error?.message || error)
        );
      });
    });

    sock.ev.on("connection.update", async ({ connection, qr, lastDisconnect }) => {
      if (qr) {
        session.state = "qr";
        if (!session.qrSent && typeof onQr === "function") {
          session.qrSent = true;
          try {
            await onQr(qr);
          } catch {
            // ignore callback failures
          }
        }
      }

      if (connection === "open") {
        clearTimeoutTimer();
        this.refreshSessionLinkedJids(session);
        session.state = "open";
        logger.success(
          "wow-sess",
          "Sessão WOW conectada: %s (ids: %s)",
          normalizedOwner,
          (session.linkedJids || []).join(", ")
        );
        if (typeof onOpen === "function") {
          try {
            await onOpen();
          } catch {
            // ignore callback failures
          }
        }
      }

      if (connection === "close") {
        clearTimeoutTimer();
        const statusCode = Number(lastDisconnect?.error?.output?.statusCode || 0);
        const disconnectMsg = String(lastDisconnect?.error?.message || lastDisconnect?.error || "");
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        session.state = "closed";
        this.sessions.delete(normalizedOwner);

        if (session.disableReconnect) {
          return;
        }

        if (loggedOut) {
          try {
            fs.rmSync(authPath, { recursive: true, force: true });
            fs.mkdirSync(authPath, { recursive: true });
          } catch {
            // ignore auth cleanup failures
          }

          logger.warn("wow-sess", "Sessão WOW deslogada: %s (code=%s msg=%s)", normalizedOwner, statusCode, disconnectMsg);
          if (typeof onReauthRequired === "function") {
            try {
              await onReauthRequired();
            } catch {
              // ignore callback failures
            }
          }
          return;
        }

        logger.warn("wow-sess", "Sessão WOW fechada para %s (code=%s msg=%s)", normalizedOwner, statusCode, disconnectMsg);
        if (typeof onError === "function") {
          try {
            await onError("closed");
          } catch {
            // ignore callback failures
          }
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") {
        return;
      }

      for (const message of messages || []) {
        if (!message?.message || !message?.key?.fromMe) {
          continue;
        }

        const text = extractTextFromContent(message.message).trim();
        if (!text || !hasRawCommand(text, this.config.wowAliases || [this.config.wowKeyword])) {
          continue;
        }

        try {
          const chatId = normalizeJid(message.key.remoteJid);
          const senderJid = this.resolveSenderJidForWow(session, message);
          const contextInfo = extractContextInfo(message.message);
          await executeWow({
            sock,
            store,
            config: this.config,
            message,
            contextInfo,
            chatId,
            senderJid
          });
        } catch (error) {
          logger.error("wow-sess", "Erro ao executar wow na sessão %s: %s", normalizedOwner, String(error?.message || error));
        }
      }
    });

    return { status: "created", session };
  }
}

module.exports = WowSessionManager;
