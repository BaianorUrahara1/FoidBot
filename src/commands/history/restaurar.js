const { normalizeJid, extractTextFromContent } = require("../../whatsapp/content");

const MAX_RESTORE_AMOUNT = 20;

function parseRestoreTargetAndAmount({ text, contextInfo, config, senderJid }) {
  const commandToken = `${config.commandPrefix}${config.restoreCommand}`.toLowerCase();
  const tokens = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const commandIndex = tokens.findIndex((token) => token.toLowerCase() === commandToken);
  const mentionedJids = Array.isArray(contextInfo?.mentionedJid)
    ? contextInfo.mentionedJid.map((jid) => normalizeJid(jid)).filter(Boolean)
    : [];
  const targetJid = normalizeJid(mentionedJids[0] || senderJid);

  if (commandIndex < 0) {
    return { targetJid, amount: 1, capped: false, invalid: false };
  }

  const rawArgs = tokens.slice(commandIndex + 1);
  if (!rawArgs.length) {
    return { targetJid, amount: 1, capped: false, invalid: false };
  }

  const nonMentionArgs = rawArgs.filter((token) => !token.startsWith("@"));
  if (!nonMentionArgs.length) {
    return { targetJid, amount: 1, capped: false, invalid: false };
  }

  const rawAmount = nonMentionArgs[0];
  if (!/^\d+$/.test(rawAmount)) {
    return { targetJid, amount: 0, capped: false, invalid: true };
  }

  const requested = Number(rawAmount);
  const bounded = Math.max(1, Math.min(MAX_RESTORE_AMOUNT, requested));
  return {
    targetJid,
    amount: bounded,
    capped: bounded !== requested,
    invalid: false
  };
}

function unwrapMessageContent(content) {
  if (!content) {
    return null;
  }
  if (content.ephemeralMessage?.message) {
    return unwrapMessageContent(content.ephemeralMessage.message);
  }
  if (content.viewOnceMessage?.message) {
    return unwrapMessageContent(content.viewOnceMessage.message);
  }
  if (content.viewOnceMessageV2?.message) {
    return unwrapMessageContent(content.viewOnceMessageV2.message);
  }
  if (content.viewOnceMessageV2Extension?.message) {
    return unwrapMessageContent(content.viewOnceMessageV2Extension.message);
  }
  return content;
}

function summarizeMessage(message) {
  const content = unwrapMessageContent(message?.message);
  if (!content) {
    return "[mensagem sem conteúdo]";
  }

  const text = extractTextFromContent(content).trim();
  if (text) {
    return text;
  }

  if (content.imageMessage) {
    return "[imagem]";
  }
  if (content.videoMessage) {
    return "[vídeo]";
  }
  if (content.audioMessage) {
    return "[áudio]";
  }
  if (content.stickerMessage) {
    return "[figurinha]";
  }
  if (content.documentMessage) {
    return "[documento]";
  }
  if (content.contactMessage || content.contactsArrayMessage) {
    return "[contato]";
  }
  if (content.locationMessage || content.liveLocationMessage) {
    return "[localização]";
  }
  return "[conteúdo não textual]";
}

async function sendRestoredItem({ sock, chatId, requestMessage, entry, index, total }) {
  try {
    await sock.sendMessage(
      chatId,
      { forward: entry.message },
      { quoted: requestMessage }
    );
    return;
  } catch {
    const description = summarizeMessage(entry.message);
    const deletedAt = Number(entry?.deletedAt || Date.now());
    const deletedAtLabel = new Date(deletedAt).toLocaleString("pt-BR", { hour12: false });
    await sock.sendMessage(
      chatId,
      { text: `[${index}/${total}] ${description}\nApagada em: ${deletedAtLabel}` },
      { quoted: requestMessage }
    );
  }
}

async function executeRestaurar({ sock, store, config, message, chatId, senderJid, text, contextInfo }) {
  if (!store || typeof store.listDeletedMessagesByUser !== "function") {
    await sock.sendMessage(
      chatId,
      { text: "Restauração indisponível no momento" },
      { quoted: message }
    );
    return;
  }

  const parsed = parseRestoreTargetAndAmount({ text, contextInfo, config, senderJid });
  if (parsed.invalid) {
    await sock.sendMessage(
      chatId,
      { text: `Use ${config.commandPrefix}${config.restoreCommand} [@user] <quantidade>` },
      { quoted: message }
    );
    return;
  }

  const targetJid = normalizeJid(parsed.targetJid || senderJid);
  const entries = store.listDeletedMessagesByUser(chatId, targetJid, parsed.amount);
  if (!entries.length) {
    const targetToken = String(targetJid || "").split("@")[0];
    await sock.sendMessage(
      chatId,
      {
        text: targetToken
          ? `Não encontrei mensagens apagadas de @${targetToken} para restaurar agora`
          : "Não encontrei mensagens apagadas para restaurar agora",
        mentions: targetToken ? [targetJid] : []
      },
      { quoted: message }
    );
    return;
  }

  const mentionToken = String(targetJid || "").split("@")[0];
  const capNotice = parsed.capped ? ` (limite máximo: ${MAX_RESTORE_AMOUNT})` : "";
  await sock.sendMessage(
    chatId,
    {
      text: `@${mentionToken}, restaurando ${entries.length} mensagem(ns) apagada(s)${capNotice}`,
      mentions: targetJid ? [targetJid] : []
    },
    { quoted: message }
  );

  const ordered = [...entries].reverse();
  for (let i = 0; i < ordered.length; i += 1) {
    await sendRestoredItem({
      sock,
      chatId,
      requestMessage: message,
      entry: ordered[i],
      index: i + 1,
      total: ordered.length
    });
  }
}

module.exports = executeRestaurar;
