const { normalizeJid } = require("../../whatsapp/content");
const { isSameJid } = require("../../whatsapp/group");

function extractArgsText(fullText, commandPrefix, commandToken) {
  const escapedPrefix = String(commandPrefix || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedCommand = String(commandToken || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escapedPrefix}${escapedCommand}\\s*`, "i");
  return String(fullText || "").replace(pattern, "").trim();
}

function extractUserToken(jid) {
  return String(jid || "")
    .trim()
    .toLowerCase()
    .split("@")[0]
    .split(":")[0];
}

function isPrimaryOwner(config, senderJid) {
  const owners = Array.isArray(config?.primaryOwnerJids) ? config.primaryOwnerJids : [];
  if (!owners.length) {
    return false;
  }
  const senderToken = extractUserToken(senderJid);
  return owners.some((owner) => isSameJid(owner, senderJid) || extractUserToken(owner) === senderToken);
}

function toDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function toUserJid(value) {
  const digits = toDigits(value);
  if (!digits) {
    return "";
  }
  return `${digits}@s.whatsapp.net`;
}

function isOffKeyword(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "off" || normalized === "none" || normalized === "limpar" || normalized === "todos" || normalized === "all";
}

function parseGroupTarget(rawArg, chatId) {
  const arg = String(rawArg || "").trim();
  if (!arg || arg.toLowerCase() === "aqui") {
    return normalizeJid(chatId || "");
  }
  return normalizeJid(arg);
}

function formatSettingsSummary(snapshot) {
  return [
    "*Configurações Atuais*",
    `- Grupo do rank: ${snapshot.ratingGroupJid || "todos os chats"}`,
    `- Grupo principal de comandos: ${snapshot.mainCommandsGroupJid || "todos os grupos/chats"}`,
    `- Usuário protegido: ${snapshot.protectedUserJid || "nenhum"}`,
    `- Número protegido: ${snapshot.protectedNumber || "nenhum"}`,
    `- Lista protegidos ativa: ${snapshot.protectedJids?.join(", ") || "vazia"}`
  ].join("\n");
}

function buildHelpText(config) {
  const cmd = `${config.commandPrefix}${config.settingsCommand}`;
  return [
    "*Configuração do Bot*",
    `${cmd} status`,
    `${cmd} rank aqui|<jid>|off`,
    `${cmd} principal aqui|<jid>|off`,
    `${cmd} protegido @user|<jid>|off`,
    `${cmd} numero <55DDDNUMERO>|off`
  ].join("\n");
}

async function executeSettings({
  sock,
  config,
  runtimeSettingsStore,
  message,
  chatId,
  senderJid,
  text,
  contextInfo
}) {
  if (!runtimeSettingsStore) {
    await sock.sendMessage(chatId, { text: "Gerenciador de configurações indisponível no momento" }, { quoted: message });
    return;
  }

  if (!isPrimaryOwner(config, senderJid)) {
    await sock.sendMessage(chatId, { text: "Apenas o dono da sessão principal pode usar este comando" }, { quoted: message });
    return;
  }

  const argsText = extractArgsText(text, config.commandPrefix, config.settingsCommand);
  const args = String(argsText || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!args.length || String(args[0]).toLowerCase() === "status") {
    const snapshot = runtimeSettingsStore.getSnapshot();
    await sock.sendMessage(chatId, { text: formatSettingsSummary(snapshot) }, { quoted: message });
    return;
  }

  const action = String(args[0] || "").toLowerCase();

  if (action === "rank") {
    const value = args[1] || "";
    if (isOffKeyword(value)) {
      const snapshot = runtimeSettingsStore.setRatingGroupJid("");
      await sock.sendMessage(chatId, { text: `Grupo do rank liberado para todos os chats\n\n${formatSettingsSummary(snapshot)}` }, { quoted: message });
      return;
    }

    const targetGroup = parseGroupTarget(value, chatId);
    if (!targetGroup || !String(targetGroup).endsWith("@g.us")) {
      await sock.sendMessage(chatId, { text: "Use um grupo válido (ex: aqui ou <jid>@g.us)" }, { quoted: message });
      return;
    }

    const snapshot = runtimeSettingsStore.setRatingGroupJid(targetGroup);
    await sock.sendMessage(chatId, { text: `Grupo do rank configurado para ${targetGroup}\n\n${formatSettingsSummary(snapshot)}` }, { quoted: message });
    return;
  }

  if (action === "principal") {
    const value = args[1] || "";
    if (isOffKeyword(value)) {
      const snapshot = runtimeSettingsStore.setMainCommandsGroupJid("");
      await sock.sendMessage(chatId, { text: `Comandos liberados para todos os grupos/chats\n\n${formatSettingsSummary(snapshot)}` }, { quoted: message });
      return;
    }

    const targetGroup = parseGroupTarget(value, chatId);
    if (!targetGroup || !String(targetGroup).endsWith("@g.us")) {
      await sock.sendMessage(chatId, { text: "Use um grupo válido (ex: aqui ou <jid>@g.us)" }, { quoted: message });
      return;
    }

    const snapshot = runtimeSettingsStore.setMainCommandsGroupJid(targetGroup);
    await sock.sendMessage(chatId, { text: `Grupo principal de comandos configurado para ${targetGroup}\n\n${formatSettingsSummary(snapshot)}` }, { quoted: message });
    return;
  }

  if (action === "protegido") {
    const value = args[1] || "";
    if (isOffKeyword(value)) {
      const snapshot = runtimeSettingsStore.setProtectedUserJid("");
      await sock.sendMessage(chatId, { text: `Usuário protegido removido\n\n${formatSettingsSummary(snapshot)}` }, { quoted: message });
      return;
    }

    const mentioned = Array.isArray(contextInfo?.mentionedJid) ? contextInfo.mentionedJid : [];
    const candidate = mentioned[0] || value;
    const rawCandidate = String(candidate || "").trim();
    const targetJid = rawCandidate.includes("@")
      ? normalizeJid(rawCandidate)
      : toUserJid(rawCandidate);
    if (!targetJid) {
      await sock.sendMessage(chatId, { text: "Informe um @user ou JID válido para proteger" }, { quoted: message });
      return;
    }

    const snapshot = runtimeSettingsStore.setProtectedUserJid(targetJid);
    await sock.sendMessage(chatId, { text: `Usuário protegido configurado: ${targetJid}\n\n${formatSettingsSummary(snapshot)}` }, { quoted: message });
    return;
  }

  if (action === "numero") {
    const value = args[1] || "";
    if (isOffKeyword(value)) {
      const snapshot = runtimeSettingsStore.setProtectedNumber("");
      await sock.sendMessage(chatId, { text: `Número protegido removido\n\n${formatSettingsSummary(snapshot)}` }, { quoted: message });
      return;
    }

    const digits = toDigits(value);
    if (!digits || digits.length < 10 || digits.length > 15) {
      await sock.sendMessage(chatId, { text: "Informe um número válido no formato 55DDDNUMERO" }, { quoted: message });
      return;
    }

    const snapshot = runtimeSettingsStore.setProtectedNumber(digits);
    await sock.sendMessage(chatId, { text: `Número protegido configurado: ${digits}\n\n${formatSettingsSummary(snapshot)}` }, { quoted: message });
    return;
  }

  await sock.sendMessage(chatId, { text: buildHelpText(config) }, { quoted: message });
}

module.exports = executeSettings;
