const { getQuotedMessageData } = require("../../whatsapp/quoted");
const { downloadMediaBuffer } = require("../../whatsapp/sticker");
const {
  canUseProtectedMedia,
  protectedMediaBlockedText,
  extractViewOnceMediaByTypes
} = require("./mediaCommon");

async function executeVoz({ sock, store, config, message, contextInfo, chatId, senderJid }) {
  const quotedData = await getQuotedMessageData(contextInfo, store, chatId);
  const quotedContent = quotedData?.content || null;
  const target = extractViewOnceMediaByTypes(quotedContent, ["audio"]);

  if (!target) {
    await sock.sendMessage(
      chatId,
      { text: `Use ${config.commandPrefix}${config.voiceCommand} respondendo um áudio em view única` },
      { quoted: message }
    );
    return;
  }

  if (!canUseProtectedMedia(config, senderJid, quotedData?.senderJid)) {
    await sock.sendMessage(
      chatId,
      { text: protectedMediaBlockedText(`${config.commandPrefix}${config.voiceCommand}`) },
      { quoted: message }
    );
    return;
  }

  try {
    const audioBuffer = await downloadMediaBuffer(target.media, "audio");
    await sock.sendMessage(
      chatId,
      {
        audio: audioBuffer,
        mimetype: target.media?.mimetype || "audio/ogg",
        ptt: Boolean(target.media?.ptt)
      },
      { quoted: message }
    );

    if (config.sendConfirmation) {
      await sock.sendMessage(chatId, { quoted: message });
    }
  } catch {
    await sock.sendMessage(
      chatId,
      { text: "Não consegui revelar esse áudio view única, tente novamente" },
      { quoted: message }
    );
  }
}

module.exports = executeVoz;
