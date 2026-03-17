const {
  extractRegularMediaFromContent,
  extractViewOnceMediaFromContent
} = require("../../whatsapp/content");
const { isSameJid } = require("../../whatsapp/group");

function getProtectedJidList(config) {
  return Array.isArray(config?.protectedJids)
    ? config.protectedJids
    : [config?.protectedJid].filter(Boolean);
}

function isProtectedJid(config, jid) {
  const protectedList = getProtectedJidList(config);
  return protectedList.some((protectedJid) => isSameJid(jid, protectedJid));
}

function canUseProtectedMedia(config, actorJid, targetJid) {
  if (!targetJid) {
    return true;
  }
  return !isProtectedJid(config, targetJid);
}

function protectedMediaBlockedText(commandToken) {
  return `Você não pode usar ${commandToken} em mídia enviada por essa pessoa`;
}

function extractViewOnceMediaByTypes(content, acceptedTypes = []) {
  const allowed = Array.isArray(acceptedTypes)
    ? acceptedTypes.map((type) => String(type || "").toLowerCase())
    : [String(acceptedTypes || "").toLowerCase()];

  const explicit = extractViewOnceMediaFromContent(content);
  if (explicit && allowed.includes(String(explicit.mediaType || "").toLowerCase())) {
    return explicit;
  }

  const regular = extractRegularMediaFromContent(content);
  if (
    regular?.media?.viewOnce === true &&
    allowed.includes(String(regular.mediaType || "").toLowerCase())
  ) {
    return { ...regular, isViewOnce: true };
  }

  return null;
}

module.exports = {
  isProtectedJid,
  canUseProtectedMedia,
  protectedMediaBlockedText,
  extractViewOnceMediaByTypes
};
