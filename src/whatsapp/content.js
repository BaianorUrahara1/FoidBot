const { jidNormalizedUser } = require("@whiskeysockets/baileys");

function normalizeJid(jid) {
  if (!jid || typeof jid !== "string") {
    return "";
  }

  try {
    return jidNormalizedUser(jid);
  } catch {
    return jid;
  }
}

function pickContextParticipant(content) {
  if (!content) {
    return "";
  }

  const direct =
    content.extendedTextMessage?.contextInfo?.participant ||
    content.imageMessage?.contextInfo?.participant ||
    content.videoMessage?.contextInfo?.participant ||
    content.audioMessage?.contextInfo?.participant ||
    "";
  if (direct) {
    return direct;
  }

  if (content.ephemeralMessage?.message) {
    return pickContextParticipant(content.ephemeralMessage.message);
  }
  if (content.viewOnceMessage?.message) {
    return pickContextParticipant(content.viewOnceMessage.message);
  }
  if (content.viewOnceMessageV2?.message) {
    return pickContextParticipant(content.viewOnceMessageV2.message);
  }
  if (content.viewOnceMessageV2Extension?.message) {
    return pickContextParticipant(content.viewOnceMessageV2Extension.message);
  }

  return "";
}

function extractMessageSenderJid(message) {
  const participantCandidates = [
    message?.key?.participant,
    message?.key?.participantAlt,
    pickContextParticipant(message?.message)
  ];
  for (const candidate of participantCandidates) {
    const normalized = normalizeJid(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const remote = normalizeJid(message?.key?.remoteJid);
  if (isGroupJid(remote)) {
    return "";
  }
  return remote;
}

function isGroupJid(jid) {
  return String(jid || "").endsWith("@g.us");
}

function extractTextFromContent(content) {
  if (!content) {
    return "";
  }

  if (content.conversation) {
    return content.conversation;
  }
  if (content.extendedTextMessage?.text) {
    return content.extendedTextMessage.text;
  }
  if (content.imageMessage?.caption) {
    return content.imageMessage.caption;
  }
  if (content.videoMessage?.caption) {
    return content.videoMessage.caption;
  }
  if (content.ephemeralMessage?.message) {
    return extractTextFromContent(content.ephemeralMessage.message);
  }
  if (content.viewOnceMessage?.message) {
    return extractTextFromContent(content.viewOnceMessage.message);
  }
  if (content.viewOnceMessageV2?.message) {
    return extractTextFromContent(content.viewOnceMessageV2.message);
  }
  if (content.viewOnceMessageV2Extension?.message) {
    return extractTextFromContent(content.viewOnceMessageV2Extension.message);
  }

  return "";
}

function extractContextInfo(content) {
  if (!content) {
    return null;
  }

  if (content.extendedTextMessage?.contextInfo) {
    return content.extendedTextMessage.contextInfo;
  }
  if (content.imageMessage?.contextInfo) {
    return content.imageMessage.contextInfo;
  }
  if (content.videoMessage?.contextInfo) {
    return content.videoMessage.contextInfo;
  }
  if (content.ephemeralMessage?.message) {
    return extractContextInfo(content.ephemeralMessage.message);
  }
  if (content.viewOnceMessage?.message) {
    return extractContextInfo(content.viewOnceMessage.message);
  }
  if (content.viewOnceMessageV2?.message) {
    return extractContextInfo(content.viewOnceMessageV2.message);
  }
  if (content.viewOnceMessageV2Extension?.message) {
    return extractContextInfo(content.viewOnceMessageV2Extension.message);
  }

  return null;
}

function extractRegularMediaFromContent(content) {
  if (!content) {
    return null;
  }

  if (content.imageMessage) {
    return { mediaType: "image", media: content.imageMessage, isViewOnce: false };
  }
  if (content.videoMessage) {
    return { mediaType: "video", media: content.videoMessage, isViewOnce: false };
  }
  if (content.audioMessage) {
    return { mediaType: "audio", media: content.audioMessage, isViewOnce: false };
  }
  if (content.ephemeralMessage?.message) {
    return extractRegularMediaFromContent(content.ephemeralMessage.message);
  }

  return null;
}

function extractViewOnceMediaFromContent(content) {
  if (!content) {
    return null;
  }

  if (content.ephemeralMessage?.message) {
    return extractViewOnceMediaFromContent(content.ephemeralMessage.message);
  }

  const wrapper =
    content.viewOnceMessage?.message ||
    content.viewOnceMessageV2?.message ||
    content.viewOnceMessageV2Extension?.message;

  if (!wrapper) {
    return null;
  }

  if (wrapper.imageMessage) {
    return { mediaType: "image", media: wrapper.imageMessage, isViewOnce: true };
  }
  if (wrapper.videoMessage) {
    return { mediaType: "video", media: wrapper.videoMessage, isViewOnce: true };
  }
  if (wrapper.audioMessage) {
    return { mediaType: "audio", media: wrapper.audioMessage, isViewOnce: true };
  }

  return null;
}

module.exports = {
  normalizeJid,
  extractMessageSenderJid,
  isGroupJid,
  extractTextFromContent,
  extractContextInfo,
  extractRegularMediaFromContent,
  extractViewOnceMediaFromContent
};
