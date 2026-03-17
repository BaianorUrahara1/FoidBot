const QRCode = require("qrcode");
const logger = require("../../core/logger");

function extractArgsText(fullText, commandPrefix, commandToken) {
  const escapedPrefix = String(commandPrefix || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedCommand = String(commandToken || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escapedPrefix}${escapedCommand}\\s*`, "i");
  return String(fullText || "").replace(pattern, "").trim();
}

function parseConnectRequest({ text, config }) {
  const argsText = extractArgsText(text, config.commandPrefix, config.connectCommand);
  const tokens = String(argsText || "")
    .split(/\s+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (!tokens.length) {
    return { ok: true };
  }

  if (tokens.length === 1 && tokens[0] === "qr") {
    return { ok: true };
  }

  return {
    ok: false,
    error: `Use ${config.commandPrefix}${config.connectCommand} ou ${config.commandPrefix}${config.connectCommand} qr`
  };
}

async function sendQrToUser({ sock, senderJid, chatId, message, qrText }) {
  const qrBuffer = await QRCode.toBuffer(qrText, {
    type: "png",
    width: 640,
    margin: 1,
    errorCorrectionLevel: "M"
  });
  const caption = "Escaneie este QR no WhatsApp";

  try {
    await sock.sendMessage(senderJid, { image: qrBuffer, caption });
  } catch {
    await sock.sendMessage(chatId, { image: qrBuffer, caption }, { quoted: message });
  }
}

async function sendTextNotice({ sock, senderJid, chatId, message, text }) {
  try {
    await sock.sendMessage(senderJid, { text });
  } catch {
    try {
      await sock.sendMessage(chatId, { text }, { quoted: message });
    } catch {
      // ignore notice failures
    }
  }
}

async function executeConectar({
  sock,
  wowSessionManager,
  config,
  message,
  chatId,
  senderJid,
  text
}) {
  if (!wowSessionManager) {
    await sock.sendMessage(
      chatId,
      { text: "Gerenciador de conexão indisponível no momento" },
      { quoted: message }
    );
    return;
  }

  const parsed = parseConnectRequest({ text, config });
  if (!parsed.ok) {
    await sock.sendMessage(chatId, { text: parsed.error }, { quoted: message });
    return;
  }

  const result = await wowSessionManager.connect({
    ownerJid: senderJid,
    onQr: async (qrText) => {
      try {
        await sendQrToUser({
          sock,
          senderJid,
          chatId,
          message,
          qrText
        });
      } catch (error) {
        logger.warn("conectar", "Falha ao enviar QR para %s: %s", senderJid, String(error?.message || error));
      }
    },
    onReauthRequired: async () => {
      await sendTextNotice({
        sock,
        senderJid,
        chatId,
        message,
        text: `Sua sessão foi deslogada, use ${config.commandPrefix}${config.connectCommand} novamente`
      });
    },
    onError: async (reason) => {
      if (reason !== "closed") {
        return;
      }
      await sendTextNotice({
        sock,
        senderJid,
        chatId,
        message,
        text: `Sua conexão foi encerrada, use ${config.commandPrefix}${config.connectCommand} novamente`
      });
    },
    onTimeout: async () => {
      await sendTextNotice({
        sock,
        senderJid,
        chatId,
        message,
        text: `Seu QR Code expirou, use ${config.commandPrefix}${config.connectCommand} novamente`
      });
    },
    onOpen: async () => {
      const mentionToken = String(senderJid || "").split("@")[0];
      try {
        await sock.sendMessage(
          chatId,
          {
            text: `@${mentionToken} conectado com sucesso, nessa conexão apenas o comando ${config.wowKeyword} funciona`,
            mentions: senderJid ? [senderJid] : []
          },
          { quoted: message }
        );
      } catch {
        // ignore confirmation send failures
      }
    }
  });

  if (result.status === "invalid") {
    await sock.sendMessage(chatId, { text: "Não foi possível iniciar a conexão" }, { quoted: message });
    return;
  }

  if (result.status === "already_open") {
    await sock.sendMessage(
      chatId,
      { text: `Sua conexão já está ativa, use ${config.wowKeyword}` },
      { quoted: message }
    );
    return;
  }

  if (result.status === "starting") {
    await sock.sendMessage(
      chatId,
      { text: "Sua conexão já está iniciando, aguarde o QR" },
      { quoted: message }
    );
    return;
  }

  await sock.sendMessage(
    chatId,
    { text: "Iniciando conexão, vou te enviar o QR" },
    { quoted: message }
  );
}

module.exports = executeConectar;
