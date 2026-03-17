const { normalizeJid } = require("./content");

async function getQuotedMessageData(contextInfo, store, chatId) {
  if (!contextInfo) {
    return null;
  }

  if (contextInfo.quotedMessage) {
    return {
      content: contextInfo.quotedMessage,
      senderJid: normalizeJid(contextInfo.participant || ""),
      messageId: String(contextInfo.stanzaId || "")
    };
  }

  if (contextInfo.stanzaId && typeof store?.loadMessage === "function") {
    const quotedFromStore = await store.loadMessage(chatId, contextInfo.stanzaId);
    if (!quotedFromStore) {
      return null;
    }
    return {
      content: quotedFromStore.message || null,
      senderJid: normalizeJid(quotedFromStore?.key?.participant || quotedFromStore?.key?.remoteJid),
      messageId: String(quotedFromStore?.key?.id || contextInfo.stanzaId || "")
    };
  }

  return null;
}

async function getQuotedMessageContent(contextInfo, store, chatId) {
  const quotedData = await getQuotedMessageData(contextInfo, store, chatId);
  return quotedData?.content || null;
}

module.exports = {
  getQuotedMessageContent,
  getQuotedMessageData
};
