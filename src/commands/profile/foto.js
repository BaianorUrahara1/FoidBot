const { normalizeJid } = require("../../whatsapp/content");
const { isProtectedJid } = require("../media/mediaCommon");

function extractArgsText(fullText, commandPrefix, commandToken) {
  const escapedPrefix = String(commandPrefix || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedCommand = String(commandToken || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escapedPrefix}${escapedCommand}\\s*`, "i");
  return String(fullText || "").replace(pattern, "").trim();
}

function extractDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhoneDigits(value) {
  const digits = extractDigits(value);
  if (!digits) {
    return "";
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

function buildPhoneVariants(rawDigits) {
  const normalized = normalizePhoneDigits(rawDigits);
  const variants = [];
  const push = (value) => {
    const next = normalizePhoneDigits(value);
    if (!next) {
      return;
    }
    if (!variants.includes(next)) {
      variants.push(next);
    }
  };

  push(normalized);
  if (/^55\d{10}$/.test(normalized)) {
    push(`${normalized.slice(0, 4)}9${normalized.slice(4)}`);
  }
  if (/^55\d{11}$/.test(normalized) && normalized.charAt(4) === "9") {
    push(`${normalized.slice(0, 4)}${normalized.slice(5)}`);
  }

  return variants;
}

function extractMentionedJid(contextInfo) {
  const mentioned = Array.isArray(contextInfo?.mentionedJid) ? contextInfo.mentionedJid : [];
  const target = normalizeJid(mentioned[0] || "");
  return target || "";
}

function extractPhoneArg(argsText) {
  const parts = String(argsText || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return parts.find((token) => !token.startsWith("@")) || "";
}

function extractUserToken(jid) {
  return String(jid || "")
    .trim()
    .split("@")[0]
    .split(":")[0];
}

async function resolveWhatsAppJidByNumber(sock, digits) {
  if (!sock || typeof sock.onWhatsApp !== "function") {
    return "";
  }

  const variants = buildPhoneVariants(digits).map((number) => `${number}@s.whatsapp.net`);
  if (!variants.length) {
    return "";
  }

  try {
    const checks = await sock.onWhatsApp(...variants);
    const match = Array.isArray(checks)
      ? checks.find((entry) => Boolean(entry?.exists && entry?.jid))
      : null;
    return normalizeJid(match?.jid || "");
  } catch {
    return "";
  }
}

async function resolveProfilePictureUrl(sock, targetJid) {
  const token = extractUserToken(targetJid);
  const attempts = [
    normalizeJid(targetJid),
    token ? normalizeJid(`${token}@s.whatsapp.net`) : "",
    token ? normalizeJid(`${token}@lid`) : ""
  ].filter(Boolean);

  const tried = new Set();
  for (const jid of attempts) {
    if (tried.has(jid)) {
      continue;
    }
    tried.add(jid);
    try {
      const url = await sock.profilePictureUrl(jid, "image");
      if (url) {
        return { url, resolvedJid: jid };
      }
    } catch {
      // tenta próximo formato de JID
    }
  }

  return { url: "", resolvedJid: normalizeJid(targetJid) };
}

async function downloadBufferFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const raw = await response.arrayBuffer();
  return Buffer.from(raw);
}

async function executeFoto({ sock, config, message, chatId, text, contextInfo }) {
  const argsText = extractArgsText(text, config.commandPrefix, config.photoCommand);
  const mentionedTargetJid = extractMentionedJid(contextInfo);

  let targetJid = mentionedTargetJid;
  let captionLabel = "";
  let useMentionCaption = false;

  if (targetJid) {
    captionLabel = `@${extractUserToken(targetJid)}`;
    useMentionCaption = true;
  } else {
    const phoneArg = extractPhoneArg(argsText);
    const phoneDigits = normalizePhoneDigits(phoneArg);

    if (!phoneDigits) {
      await sock.sendMessage(
        chatId,
        { text: `Use ${config.commandPrefix}${config.photoCommand} <número> ou ${config.commandPrefix}${config.photoCommand} @pessoa` },
        { quoted: message }
      );
      return;
    }

    if (!/^\d{12,15}$/.test(phoneDigits)) {
      await sock.sendMessage(
        chatId,
        { text: "Número inválido, use no formato +55 DDD Número" },
        { quoted: message }
      );
      return;
    }

    targetJid = await resolveWhatsAppJidByNumber(sock, phoneDigits);
    captionLabel = phoneDigits;

    if (!targetJid) {
      await sock.sendMessage(
        chatId,
        { text: "Não encontrei esse número no WhatsApp" },
        { quoted: message }
      );
      return;
    }
  }

  if (isProtectedJid(config, targetJid)) {
    await sock.sendMessage(
      chatId,
      { text: "Não é permitido consultar foto desse usuário" },
      { quoted: message }
    );
    return;
  }

  const { url: profileUrl, resolvedJid } = await resolveProfilePictureUrl(sock, targetJid);

  if (!profileUrl) {
    await sock.sendMessage(
      chatId,
      { text: "Não foi possível obter a foto, ela pode estar sem foto ou privada" },
      { quoted: message }
    );
    return;
  }

  try {
    const imageBuffer = await downloadBufferFromUrl(profileUrl);
    await sock.sendMessage(
      chatId,
      {
        image: imageBuffer,
        caption: `Foto de perfil de ${captionLabel}`,
        ...(useMentionCaption ? { mentions: [resolvedJid || targetJid] } : {})
      },
      { quoted: message }
    );
  } catch {
    await sock.sendMessage(
      chatId,
      { text: "Achei a foto, mas falhei ao baixar ou enviar agora, tente novamente" },
      { quoted: message }
    );
  }
}

module.exports = executeFoto;