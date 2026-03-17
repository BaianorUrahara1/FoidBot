const { extractRegularMediaFromContent } = require("../../whatsapp/content");
const { getQuotedMessageData } = require("../../whatsapp/quoted");
const {
  downloadMediaBuffer,
  imageBufferToSticker,
  videoBufferToAnimatedSticker
} = require("../../whatsapp/sticker");
const {
  canUseProtectedMedia,
  protectedMediaBlockedText,
  extractViewOnceMediaByTypes
} = require("./mediaCommon");

async function executeFigurinha({ sock, store, config, message, content, contextInfo, chatId, senderJid }) {
  let target = extractRegularMediaFromContent(content);
  let targetSenderJid = target ? senderJid : "";

  const quotedData = await getQuotedMessageData(contextInfo, store, chatId);
  const quotedContent = quotedData?.content || null;
  if (!target && quotedContent) {
    target = extractRegularMediaFromContent(quotedContent);
    if (target) {
      targetSenderJid = quotedData?.senderJid || "";
    }
  }

  const quotedViewOnce = extractViewOnceMediaByTypes(quotedContent, ["image", "video", "audio"]);
  if (!target && quotedViewOnce) {
    if (!canUseProtectedMedia(config, senderJid, quotedData?.senderJid)) {
      await sock.sendMessage(
        chatId,
        { text: protectedMediaBlockedText(`${config.commandPrefix}${config.stickerCommand}`) },
        { quoted: message }
      );
      return;
    }

    const commandName = quotedViewOnce.mediaType === "audio" ? config.voiceCommand : config.revealCommand;
    const mediaLabel = quotedViewOnce.mediaType === "audio" ? "áudio" : "imagem";
    await sock.sendMessage(
      chatId,
      { text: `Para ${mediaLabel} view única, use ${config.commandPrefix}${commandName}` },
      { quoted: message }
    );
    return;
  }

  if (!target) {
    await sock.sendMessage(
      chatId,
      {
        text: `Envie uma imagem/vídeo/gif com ${config.commandPrefix}${config.stickerCommand} ou responda uma mídia com ${config.commandPrefix}${config.stickerCommand}`
      },
      { quoted: message }
    );
    return;
  }

  if (!canUseProtectedMedia(config, senderJid, targetSenderJid)) {
    await sock.sendMessage(
      chatId,
      { text: protectedMediaBlockedText(`${config.commandPrefix}${config.stickerCommand}`) },
      { quoted: message }
    );
    return;
  }

  if (target.mediaType !== "image" && target.mediaType !== "video") {
    await sock.sendMessage(
      chatId,
      { text: "Formato não suportado, use imagem, vídeo ou gif" },
      { quoted: message }
    );
    return;
  }

  try {
    let stickerBuffer = null;
    if (target.mediaType === "image") {
      const imageBuffer = await downloadMediaBuffer(target.media, "image");
      stickerBuffer = await imageBufferToSticker(imageBuffer);
    } else {
      const videoBuffer = await downloadMediaBuffer(target.media, "video");
      stickerBuffer = await videoBufferToAnimatedSticker(videoBuffer, {
        maxDurationSeconds: 8,
        fps: 12
      });
    }

    await sock.sendMessage(chatId, { sticker: stickerBuffer }, { quoted: message });

    if (config.sendConfirmation) {
      await sock.sendMessage(chatId, { quoted: message });
    }
  } catch (error) {
    if (String(error?.code || "") === "FFMPEG_NOT_FOUND") {
      await sock.sendMessage(
        chatId,
        { text: "Não consigo converter vídeo/gif: ffmpeg não está instalado no servidor do bot" },
        { quoted: message }
      );
      return;
    }

    await sock.sendMessage(
      chatId,
      { text: "Não consegui processar a mídia para criar figurinha" },
      { quoted: message }
    );
  }
}

module.exports = executeFigurinha;
