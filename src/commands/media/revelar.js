const { getQuotedMessageData } = require("../../whatsapp/quoted");
const { downloadMediaBuffer } = require("../../whatsapp/sticker");
const {
  canUseProtectedMedia,
  protectedMediaBlockedText,
  extractViewOnceMediaByTypes
} = require("./mediaCommon");

async function executeRevelar({ sock, store, config, message, contextInfo, chatId, senderJid }) {
  const quotedData = await getQuotedMessageData(contextInfo, store, chatId);
  const quotedContent = quotedData?.content || null;
  const target = extractViewOnceMediaByTypes(quotedContent, ["image"]);

  if (!target) {
    await sock.sendMessage(
      chatId,
      { text: `Use ${config.commandPrefix}${config.revealCommand} respondendo uma imagem em view única` },
      { quoted: message }
    );
    return;
  }

  if (!canUseProtectedMedia(config, senderJid, quotedData?.senderJid)) {
    await sock.sendMessage(
      chatId,
      { text: protectedMediaBlockedText(`${config.commandPrefix}${config.revealCommand}`) },
      { quoted: message }
    );
    return;
  }

  try {
    const imageBuffer = await downloadMediaBuffer(target.media, "image");
    const caption = target.media?.caption || "Imagem revelada";

    await sock.sendMessage(
      chatId,
      { image: imageBuffer, caption },
      { quoted: message }
    );

    if (config.sendConfirmation) {
      await sock.sendMessage(chatId, { quoted: message });
    }
  } catch {
    await sock.sendMessage(
      chatId,
      { text: "Não consegui revelar essa view única, tente novamente" },
      { quoted: message }
    );
  }
}

module.exports = executeRevelar;
