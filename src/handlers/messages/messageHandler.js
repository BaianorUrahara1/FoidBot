const { hasCommandToken } = require("../../utils/commands");
const {
  normalizeJid,
  extractMessageSenderJid,
  extractTextFromContent,
  extractContextInfo
} = require("../../whatsapp/content");
const logger = require("../../core/logger");
const { resolveRatingProgress } = require("../../rating/scale");
const executeFigurinha = require("../../commands/media/figurinha");
const executeRevelar = require("../../commands/media/revelar");
const executeVoz = require("../../commands/media/voz");
const executeWow = require("../../commands/media/wow");
const executeConectar = require("../../commands/session/conectar");
const executeSettings = require("../../commands/admin/config");
const executeRestaurar = require("../../commands/history/restaurar");
const executeFoto = require("../../commands/profile/foto");
const executeRateMe = require("../../commands/rating/rateme");
const executeRank = require("../../commands/rating/rank");

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

function buildCommandRegistry({ sock, store, config, ratingStore, wowSessionManager, runtimeSettingsStore }) {
  return [
    {
      key: "settings",
      match(text) {
        return hasCommandToken(text, config.commandPrefix, [config.settingsCommand]);
      },
      label: `${config.commandPrefix}${config.settingsCommand}`,
      run({ message, chatId, senderJid, text, contextInfo }) {
        return executeSettings({
          sock,
          config,
          runtimeSettingsStore,
          message,
          chatId,
          senderJid,
          text,
          contextInfo
        });
      }
    },
    {
      key: "rateme",
      match(text) {
        return hasCommandToken(text, config.commandPrefix, [config.rateMeCommand]);
      },
      label: `${config.commandPrefix}${config.rateMeCommand}`,
      run({ message, chatId, senderJid }) {
        return executeRateMe({
          sock,
          ratingStore,
          config,
          message,
          chatId,
          senderJid
        });
      }
    },
    {
      key: "rank",
      match(text) {
        return hasCommandToken(text, config.commandPrefix, [config.rankCommand]);
      },
      label: `${config.commandPrefix}${config.rankCommand}`,
      run({ message, chatId }) {
        return executeRank({
          sock,
          ratingStore,
          config,
          message,
          chatId
        });
      }
    },
    {
      key: "revelar",
      match(text) {
        return hasCommandToken(text, config.commandPrefix, [config.revealCommand]);
      },
      label: `${config.commandPrefix}${config.revealCommand}`,
      run({ message, chatId, senderJid, contextInfo }) {
        return executeRevelar({
          sock,
          store,
          config,
          message,
          contextInfo,
          chatId,
          senderJid
        });
      }
    },
    {
      key: "voz",
      match(text) {
        return hasCommandToken(text, config.commandPrefix, [config.voiceCommand]);
      },
      label: `${config.commandPrefix}${config.voiceCommand}`,
      run({ message, chatId, senderJid, contextInfo }) {
        return executeVoz({
          sock,
          store,
          config,
          message,
          contextInfo,
          chatId,
          senderJid
        });
      }
    },
    {
      key: "foto",
      match(text) {
        return hasCommandToken(text, config.commandPrefix, [config.photoCommand]);
      },
      label: `${config.commandPrefix}${config.photoCommand}`,
      run({ message, chatId, text, contextInfo }) {
        return executeFoto({
          sock,
          config,
          message,
          chatId,
          text,
          contextInfo
        });
      }
    },
    {
      key: "wow",
      match(text) {
        return hasRawCommand(text, config.wowAliases || [config.wowKeyword]);
      },
      label: config.wowKeyword,
      run({ message, chatId, senderJid, contextInfo }) {
        return executeWow({
          sock,
          store,
          config,
          message,
          contextInfo,
          chatId,
          senderJid
        });
      }
    },
    {
      key: "conectar",
      match(text) {
        return hasCommandToken(text, config.commandPrefix, [config.connectCommand]);
      },
      label: `${config.commandPrefix}${config.connectCommand}`,
      run({ message, chatId, senderJid, text }) {
        return executeConectar({
          sock,
          wowSessionManager,
          config,
          message,
          chatId,
          senderJid,
          text
        });
      }
    },
    {
      key: "restaurar",
      match(text) {
        return hasCommandToken(text, config.commandPrefix, [config.restoreCommand]);
      },
      label: `${config.commandPrefix}${config.restoreCommand}`,
      run({ message, chatId, senderJid, text, contextInfo }) {
        return executeRestaurar({
          sock,
          store,
          config,
          message,
          chatId,
          senderJid,
          text,
          contextInfo
        });
      }
    },
    {
      key: "figurinha",
      match(text) {
        return hasCommandToken(text, config.commandPrefix, [config.stickerCommand, "s"]);
      },
      label: `${config.commandPrefix}${config.stickerCommand}`,
      run({ message, chatId, senderJid, content, contextInfo }) {
        return executeFigurinha({
          sock,
          store,
          config,
          message,
          content,
          contextInfo,
          chatId,
          senderJid
        });
      }
    }
  ];
}

function createMessageHandler({ sock, store, config, ratingStore, wowSessionManager, runtimeSettingsStore }) {
  const commandRegistry = buildCommandRegistry({ sock, store, config, ratingStore, wowSessionManager, runtimeSettingsStore });

  return async function handleIncomingMessage(message) {
    if (!message?.message) {
      return;
    }

    const isFromMe = Boolean(message?.key?.fromMe);
    const rawChatId = String(message?.key?.remoteJid || "").trim();
    const chatId = normalizeJid(rawChatId);
    const replyChatId = rawChatId || chatId;
    const senderJid = extractMessageSenderJid(message);
    const content = message.message;
    const text = extractTextFromContent(content).trim();
    const contextInfo = extractContextInfo(content);
    if (!text) {
      return;
    }

    const matchedCommand = commandRegistry.find((command) => command.match(text)) || null;
    const isCommandMessage = Boolean(matchedCommand);
    const isSystemStub = Number.isInteger(message?.messageStubType);
    const isGroupChat = String(chatId || "").endsWith("@g.us");
    const mainCommandsGroupJid = normalizeJid(config.wowBotPrivateTargetGroupJid || "");
    const isOtherGroupRestricted = Boolean(
      matchedCommand &&
      isGroupChat &&
      mainCommandsGroupJid &&
      chatId !== mainCommandsGroupJid &&
      matchedCommand.key !== "wow" &&
      matchedCommand.key !== "settings"
    );

    if (isOtherGroupRestricted) {
      logger.debug("command", "Ignorando comando %s em grupo restrito para comandos (%s)", matchedCommand.label, chatId
      );
      return;
    }

    if ((isFromMe || isSystemStub) && !isCommandMessage) {
      return;
    }

    if (matchedCommand?.key === "wow" && !isFromMe) {
      const hasWowSession = typeof wowSessionManager?.hasActiveSessionForJid === "function"
        ? wowSessionManager.hasActiveSessionForJid(senderJid)
        : Boolean(
          typeof wowSessionManager?.getSession === "function" &&
          wowSessionManager.getSession(senderJid)
        );
      if (hasWowSession) {
        logger.debug("command", "Ignorando wow na sessão principal para %s (sessão !conectar ativa)", senderJid);
        return;
      }
    }

    let rankUpAnnouncement = null;

    if (ratingStore && senderJid) {
      try {
        const scopedChatId = normalizeJid(config.ratingGroupJid || "");
        const canTrackChat = !scopedChatId || chatId === scopedChatId;
        if (canTrackChat) {
          const timestampMs = Number(message?.messageTimestamp || 0) * 1000 || Date.now();
          const previousStats = ratingStore.getUserStats(senderJid, { chatId: scopedChatId || chatId });
          const previousProgress = resolveRatingProgress(previousStats.messages);
          const activity = ratingStore.registerMessageActivity(senderJid, {
            text,
            isCommand: isCommandMessage,
            timestampMs,
            sourceChatId: chatId
          });
          if (activity?.counted) {
            const currentStats = ratingStore.getUserStats(senderJid, { chatId: scopedChatId || chatId });
            const currentProgress = resolveRatingProgress(currentStats.messages);
            if (currentProgress.index > previousProgress.index) {
              rankUpAnnouncement = {
                previous: previousProgress,
                current: currentProgress
              };
            }
          }
        }
      } catch {
        // keep command flow even if persistence fails once
      }
    }

    if (rankUpAnnouncement && senderJid) {
      const mentionToken = String(senderJid).split("@")[0];
      const previousLabel = `${rankUpAnnouncement.previous.rankLabel} (${rankUpAnnouncement.previous.score.toFixed(2)})`;
      const currentLabel = `${rankUpAnnouncement.current.rankLabel} (${rankUpAnnouncement.current.score.toFixed(2)})`;
      await sock.sendMessage(replyChatId, {
        text: `O @${mentionToken} ascendeu de ${previousLabel} para ${currentLabel} aeeeeeeee, vamos dar os parabéns ao neguinho 🎉🎉🎉`,
        mentions: [senderJid]
      });
    }

    if (!matchedCommand) {
      return;
    }

    logger.event("command", "%s -> %s | %s", senderJid, chatId, matchedCommand.label);

    await matchedCommand.run({
      message,
      chatId: replyChatId,
      senderJid,
      text,
      content,
      contextInfo
    });
  };
}

module.exports = createMessageHandler;