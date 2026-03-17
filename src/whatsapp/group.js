const { areJidsSameUser } = require("@whiskeysockets/baileys");
const { normalizeJid } = require("./content");

function isAdminRole(role) {
  return role === "admin" || role === "superadmin";
}

function toJidList(jidOrJids) {
  const list = Array.isArray(jidOrJids) ? jidOrJids : [jidOrJids];
  return list
    .map((jid) => String(jid || "").trim())
    .filter(Boolean);
}

function isSameJid(jidA, jidB) {
  const a = String(jidA || "").trim();
  const b = String(jidB || "").trim();
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  if (normalizeJid(a) === normalizeJid(b)) {
    return true;
  }
  try {
    return areJidsSameUser(a, b);
  } catch {
    return false;
  }
}

function getParticipant(metadata, jidOrJids) {
  const targetJids = toJidList(jidOrJids);
  if (!targetJids.length) {
    return null;
  }

  const participants = metadata?.participants || [];
  return participants.find((participant) => {
    const ids = [
      participant?.id,
      participant?.lid,
      normalizeJid(participant?.id || ""),
      normalizeJid(participant?.lid || "")
    ].filter(Boolean);
    return ids.some((id) => targetJids.some((target) => isSameJid(id, target)));
  }) || null;
}

async function getGroupMetadataSafe(sock, chatId) {
  try {
    return await sock.groupMetadata(chatId);
  } catch {
    return null;
  }
}

async function isGroupAdmin(sock, chatId, jid) {
  const metadata = await getGroupMetadataSafe(sock, chatId);
  if (!metadata) {
    return false;
  }
  return isAdminRole(getParticipant(metadata, jid)?.admin || null);
}

module.exports = {
  isAdminRole,
  isSameJid,
  toJidList,
  getParticipant,
  getGroupMetadataSafe,
  isGroupAdmin
};
