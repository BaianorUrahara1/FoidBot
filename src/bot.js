const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const config = require("./core/config");
const appLogger = require("./core/logger");
const MessageStore = require("./whatsapp/messageStore");
const RatingStore = require("./storage/ratingStore");
const RuntimeSettingsStore = require("./storage/runtimeSettingsStore");
const createMessageHandler = require("./handlers/messages/messageHandler");
const WowSessionManager = require("./sessions/wowSessionManager");
const { normalizeJid, extractMessageSenderJid } = require("./whatsapp/content");
const { isSameJid } = require("./whatsapp/group");

let reconnectTimer = null;
let startupLogged = false;
const wowSessionManager = new WowSessionManager({ config });
const runtimeSettingsStore = new RuntimeSettingsStore({
  filePath: config.runtimeSettingsFile,
  config,
  logger: appLogger
});
runtimeSettingsStore.load();
const SEND_TIMEOUT_MS = 15000;

function hasOwn(input, key) {
  return Boolean(input && Object.prototype.hasOwnProperty.call(input, key));
}

function removeQuotedOption(options) {
  if (!hasOwn(options, "quoted")) {
    return options;
  }
  const { quoted: _ignoredQuoted, ...rest } = options;
  return Object.keys(rest).length ? rest : undefined;
}

async function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function startBot() {
  if (!startupLogged) {
    appLogger.startupBanner(config);
    startupLogged = true;
  }

  appLogger.event("boot", "Inicializando sessão WhatsApp...");
  const { state, saveCreds } = await useMultiFileAuthState(config.authFolder);
  const { version } = await fetchLatestBaileysVersion();
  const socketLogger = pino({ level: "silent" });
  const store = new MessageStore({
    maxViewOnceCachePerChat: config.viewOnceCachePerChat,
    maxViewOnceTotalBytes: config.viewOnceCacheTotalBytes
  });
  const ratingStore = new RatingStore({
    filePath: config.ratingDataFile,
    saveDebounceMs: config.ratingSaveDebounceMs,
    ratingGroupJid: config.ratingGroupJid
  });
  ratingStore.ensureLoaded();
  appLogger.debug("boot", "Baileys version: %s", version.join("."));

  const sock = makeWASocket({
    auth: state,
    version,
    logger: socketLogger,
    browser: ["FoidBot", "Chrome", "1.0.0"],
    printQRInTerminal: false
  });

  const baseSendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    const rawTarget = String(jid || "").trim();
    const normalizedTarget = normalizeJid(rawTarget);
    const targets = [];
    if (rawTarget) {
      targets.push(rawTarget);
    }
    if (normalizedTarget && !targets.includes(normalizedTarget)) {
      targets.push(normalizedTarget);
    }
    if (!targets.length) {
      throw new Error("JID de destino vazio");
    }

    const isGroupTarget = targets.some((target) => String(target || "").endsWith("@g.us"));
    const safeOptions = isGroupTarget ? removeQuotedOption(options) : options;
    const optionVariants = [safeOptions];
    const noQuotedOptions = removeQuotedOption(safeOptions);
    if (safeOptions !== noQuotedOptions) {
      optionVariants.push(noQuotedOptions);
    }

    let lastError = null;
    for (const target of targets) {
      for (const optionVariant of optionVariants) {
        try {
          return await withTimeout(
            baseSendMessage(target, content, optionVariant),
            SEND_TIMEOUT_MS,
            `Timeout no envio para ${target}`
          );
        } catch (error) {
          lastError = error;
        }
      }
    }

    appLogger.error(
      "send",
      "Falha ao enviar mensagem para %s: %s",
      normalizedTarget || rawTarget,
      String(lastError?.message || lastError)
    );
    if (lastError) {
      throw lastError;
    }
    throw new Error(`Falha desconhecida ao enviar mensagem para ${normalizedTarget || rawTarget}`);
  };

  store.bind(sock.ev);
  appLogger.debug("boot", "Store de mensagens vinculado ao socket");
  const handleMessage = createMessageHandler({
    sock,
    store,
    config,
    ratingStore,
    wowSessionManager,
    runtimeSettingsStore
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("group-participants.update", async (update) => {
    const action = String(update?.action || "").toLowerCase();
    if (action !== "remove") {
      return;
    }

    const groupId = normalizeJid(update?.id);
    if (!groupId) {
      return;
    }

    const botJid = normalizeJid(sock?.user?.id);
    const botLid = normalizeJid(sock?.user?.lid || "");

    const protectedParticipants = [
      ...(Array.isArray(config.protectedJids) ? config.protectedJids : [config.protectedJid]),
      botJid,
      botLid
    ]
      .map((jid) => normalizeJid(jid))
      .filter(Boolean);

    const removedParticipants = (update?.participants || [])
      .map((jid) => normalizeJid(jid))
      .filter(Boolean);

    const shouldRestore = removedParticipants.filter((jid) =>
      protectedParticipants.some((protectedJid) => isSameJid(jid, protectedJid))
    );
    if (shouldRestore.length === 0) {
      return;
    }

    for (const jid of shouldRestore) {
      try {
        await sock.groupParticipantsUpdate(groupId, [jid], "add");
        appLogger.warn("guard", "Restaurado participante protegido %s no grupo %s", jid, groupId);
      } catch (error) {
        appLogger.error(
          "guard",
          "Falha ao restaurar participante protegido (%s) no grupo %s: %s",
          jid,
          groupId,
          String(error?.message || error)
        );
      }
    }

    try {
      await sock.sendMessage(
        groupId,
        { text: "Proteção ativa: tentativa de remover participante protegido detectada" }
      );
    } catch {
      // ignore send errors
    }
  });

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      appLogger.info("auth", "Escaneie o QR Code abaixo no WhatsApp:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      config.primaryOwnerJids = [
        normalizeJid(sock?.user?.id || ""),
        normalizeJid(sock?.user?.lid || "")
      ].filter(Boolean);

      appLogger.success("conn", "Bot conectado e pronto.");
      const commands = [
        `${config.commandPrefix}${config.settingsCommand}`,
        `${config.commandPrefix}${config.stickerCommand}`,
        `${config.commandPrefix}s`,
        `${config.commandPrefix}${config.revealCommand}`,
        `${config.commandPrefix}${config.voiceCommand}`,
        `${config.commandPrefix}${config.photoCommand}`,
        `${config.wowKeyword}`,
        `${config.commandPrefix}${config.connectCommand}`,
        `${config.commandPrefix}${config.restoreCommand}`,
        `${config.commandPrefix}${config.rateMeCommand}`,
        `${config.commandPrefix}${config.rankCommand}`
      ];
      appLogger.info("conn", "Comandos ativos: %s", commands.join(", "));
    }

    if (connection === "close") {
      const statusCode = Number(lastDisconnect?.error?.output?.statusCode || 0);
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        appLogger.warn("conn", "Sessão encerrada, remova a pasta %s para autenticar de novo", config.authFolder);
        return;
      }

      if (!reconnectTimer) {
        appLogger.warn("conn", "Conexão fechada, reconectando em 5s...");
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          startBot().catch((error) => {
            appLogger.error("conn", "Falha ao reconectar: %s", String(error?.message || error));
          });
        }, 5000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") {
      return;
    }

    for (const message of messages) {
      try {
        await handleMessage(message);
      } catch (error) {
        const chatId = normalizeJid(message?.key?.remoteJid);
        if (chatId) {
          try {
            await sock.sendMessage(chatId, { text: "Erro interno ao processar o comando" }, { quoted: message });
          } catch {
            const senderJid = normalizeJid(extractMessageSenderJid(message));
            if (senderJid) {
              try {
                await sock.sendMessage(
                  senderJid,
                  { text: "Não consegui responder no grupo, verifique se o bot pode enviar mensagens nele" }
                );
              } catch {
                // ignore fallback notify failures
              }
            }
          }
        }
        appLogger.error("msg", "Erro ao processar mensagem: %s", String(error?.message || error));
      }
    }
  });
}

module.exports = startBot;

