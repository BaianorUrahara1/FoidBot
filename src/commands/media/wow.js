const {
  extractMessageSenderJid,
  normalizeJid
} = require("../../whatsapp/content");
const { getQuotedMessageData } = require("../../whatsapp/quoted");
const { downloadMediaBuffer } = require("../../whatsapp/sticker");
const { isSameJid, getGroupMetadataSafe, getParticipant } = require("../../whatsapp/group");
const {
  canUseProtectedMedia,
  extractViewOnceMediaByTypes
} = require("./mediaCommon");
const logger = require("../../core/logger");

const recentWowExecutions = new Map();
const WOW_DEDUPE_WINDOW_MS = 15000;

function extractViewOnceSupportedMedia(content) {
  return extractViewOnceMediaByTypes(content, ["image", "video"]);
}

function findRecentViewOnceMediaFromSender(store, chatId, senderJid) {
  if (!store || typeof store.listMessages !== "function") {
    return null;
  }

  const messages = store.listMessages(chatId);
  for (const listedMessage of messages) {
    const listedSender = extractMessageSenderJid(listedMessage);
    if (!isSameJid(listedSender, senderJid)) {
      continue;
    }

    const target = extractViewOnceSupportedMedia(listedMessage?.message);
    if (target) {
      return { target, senderJid: listedSender };
    }
  }

  return null;
}

function isLidJid(jid) {
  return String(jid || "").endsWith("@lid") || String(jid || "").endsWith("@hosted.lid");
}

function pushUniqueJid(list, value) {
  const normalized = normalizeJid(value);
  if (!normalized) {
    return;
  }
  if (!list.includes(normalized)) {
    list.push(normalized);
  }
}

function buildWowExecutionKey(message) {
  const chatId = normalizeJid(message?.key?.remoteJid);
  const messageId = String(message?.key?.id || "").trim();
  if (!chatId || !messageId) {
    return "";
  }
  return `${chatId}|${messageId}`;
}

function shouldSkipDuplicateWow(message) {
  const key = buildWowExecutionKey(message);
  if (!key) {
    return false;
  }

  const now = Date.now();
  const lastTs = Number(recentWowExecutions.get(key) || 0);
  if (lastTs && now - lastTs <= WOW_DEDUPE_WINDOW_MS) {
    return true;
  }
  recentWowExecutions.set(key, now);

  for (const [savedKey, ts] of recentWowExecutions.entries()) {
    if (now - Number(ts || 0) > WOW_DEDUPE_WINDOW_MS * 2) {
      recentWowExecutions.delete(savedKey);
    }
  }
  return false;
}

async function buildPrivateRecipientCandidates(sock, senderJid, message) {
  const candidates = [];
  const chatId = normalizeJid(message?.key?.remoteJid);
  const isGroupChat = String(chatId || "").endsWith("@g.us");
  const isFromMe = Boolean(message?.key?.fromMe);
  const selfJid = normalizeJid(sock?.user?.id || "");
  const selfLid = normalizeJid(sock?.user?.lid || "");
  const authorJid = normalizeJid(
    isFromMe
      ? (selfJid || selfLid || senderJid)
      : senderJid
  );

  if (authorJid) {
    pushUniqueJid(candidates, authorJid);
  }

  if (!isGroupChat && !isFromMe) {
    pushUniqueJid(candidates, chatId);
  }
  if (!isFromMe) {
    pushUniqueJid(candidates, senderJid);
    pushUniqueJid(candidates, message?.key?.participant);
  } else {
    pushUniqueJid(candidates, selfJid);
    pushUniqueJid(candidates, selfLid);
  }

  if (isGroupChat) {
    const metadata = await getGroupMetadataSafe(sock, chatId);
    const participant = getParticipant(metadata, authorJid || senderJid);
    pushUniqueJid(candidates, participant?.id);
    pushUniqueJid(candidates, participant?.lid);
  }

  const baseJid = authorJid || normalizeJid(senderJid);
  const baseUser = String(baseJid || "").split("@")[0].split(":")[0];
  if (baseUser) {
    pushUniqueJid(candidates, `${baseUser}@s.whatsapp.net`);
  }

  if (isLidJid(baseJid)) {
    try {
      const mappedPnJid = await sock?.signalRepository?.lidMapping?.getPNForLID(baseJid);
      pushUniqueJid(candidates, mappedPnJid);
    } catch {
      // ignore lookup errors
    }
  }

  return candidates;
}

async function resolveTarget({ store, chatId, contextInfo }) {
  const quotedData = await getQuotedMessageData(contextInfo, store, chatId);

  if (quotedData?.messageId && typeof store?.getCachedViewOnceByMessageId === "function") {
    const cachedQuoted = store.getCachedViewOnceByMessageId(chatId, quotedData.messageId);
    if (cachedQuoted?.buffer) {
      return {
        cachedViewOnce: cachedQuoted,
        target: null,
        targetSenderJid: cachedQuoted.senderJid || quotedData?.senderJid || ""
      };
    }
  }

  const quotedTarget = extractViewOnceSupportedMedia(quotedData?.content || null);
  if (quotedTarget) {
    return {
      target: quotedTarget,
      targetSenderJid: quotedData?.senderJid || ""
    };
  }

  if (quotedData?.messageId && typeof store?.loadMessage === "function") {
    const fullQuotedMessage = await store.loadMessage(chatId, quotedData.messageId);
    const fullQuotedTarget = extractViewOnceSupportedMedia(fullQuotedMessage?.message || null);
    if (fullQuotedTarget) {
      return {
        target: fullQuotedTarget,
        targetSenderJid: extractMessageSenderJid(fullQuotedMessage) || quotedData?.senderJid || ""
      };
    }
  }

  const mentioned = Array.isArray(contextInfo?.mentionedJid) ? contextInfo.mentionedJid : [];
  for (const mentionedJid of mentioned) {
    const normalizedMention = normalizeJid(mentionedJid);
    if (!normalizedMention) {
      continue;
    }

    if (typeof store?.findLatestCachedViewOnceBySender === "function") {
      const cachedByMention = store.findLatestCachedViewOnceBySender(chatId, normalizedMention, ["image", "video"]);
      if (cachedByMention?.buffer) {
        return {
          cachedViewOnce: cachedByMention,
          target: null,
          targetSenderJid: cachedByMention.senderJid || normalizedMention
        };
      }
    }

    const fromRecent = findRecentViewOnceMediaFromSender(store, chatId, normalizedMention);
    if (fromRecent) {
      return {
        target: fromRecent.target,
        targetSenderJid: fromRecent.senderJid
      };
    }
  }

  return null;
}

async function executeWow({ sock, store, config, message, contextInfo, chatId, senderJid }) {
  if (shouldSkipDuplicateWow(message)) {
    logger.debug("wow", "Ignorando wow duplicado. sender=%s chat=%s msg=%s", senderJid, chatId, String(message?.key?.id || ""));
    return;
  }

  const resolved = await resolveTarget({ store, chatId, contextInfo });
  if (!resolved?.target && !resolved?.cachedViewOnce?.buffer) {
    logger.warn("wow", "Nenhuma view única encontrada para %s no chat %s", senderJid, chatId);
    return;
  }

  if (!canUseProtectedMedia(config, senderJid, resolved.targetSenderJid)) {
    logger.warn("wow", "Bloqueado por protegido: %s tentou usar wow em %s", senderJid, resolved.targetSenderJid);
    return;
  }

  try {
    const mediaBuffer = resolved?.cachedViewOnce?.buffer
      ? resolved.cachedViewOnce.buffer
      : await downloadMediaBuffer(resolved.target.media, resolved?.target?.mediaType);
    const mediaType = String(
      resolved?.cachedViewOnce?.mediaType ||
      resolved?.target?.mediaType ||
      "image"
    ).toLowerCase();
    const caption = resolved?.cachedViewOnce?.caption || resolved?.target?.media?.caption || "Imagem revelada";
    const mimetype =
      resolved?.cachedViewOnce?.mimetype ||
      resolved?.target?.media?.mimetype ||
      (mediaType === "video" ? "video/mp4" : "image/jpeg");
    const recipients = await buildPrivateRecipientCandidates(sock, senderJid, message);

    let sent = false;
    const payload = mediaType === "video"
      ? { video: mediaBuffer, caption, mimetype }
      : { image: mediaBuffer, caption, mimetype };

    for (const recipientJid of recipients) {
      try {
        await sock.sendMessage(recipientJid, payload);
        sent = true;
        logger.event("wow", "Midia view unica (%s) enviada para %s (origem: %s)", mediaType, recipientJid, senderJid);
        break;
      } catch {
        // try next recipient candidate
      }
    }

    if (!sent) {
      logger.warn("wow", "Falha ao enviar wow. sender=%s destinos=%s", senderJid, recipients.join(", "));
    }
  } catch {
    logger.warn("wow", "Erro ao processar wow para sender=%s chat=%s", senderJid, chatId);
    // comando silencioso: ignora falhas sem responder no chat
  }
}

module.exports = executeWow;
module.exports.__private = {
  resolveTarget,
  shouldSkipDuplicateWow,
  buildWowExecutionKey
};
