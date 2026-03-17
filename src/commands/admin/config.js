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

function parseAliasText(rawText) {
  return String(rawText || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeAliasTokens(tokens, config) {
  const prefix = String(config?.commandPrefix || "!").trim();
  const unique = [];
  const seen = new Set();

  for (const rawToken of Array.isArray(tokens) ? tokens : [tokens]) {
    let token = String(rawToken || "").trim().toLowerCase();
    if (!token) {
      continue;
    }

    if (prefix && token.startsWith(prefix)) {
      token = token.slice(prefix.length).trim();
    }

    if (!token || /\s/.test(token) || !/^[a-z0-9._-]{1,24}$/i.test(token)) {
      continue;
    }

    if (!seen.has(token)) {
      seen.add(token);
      unique.push(token);
    }
  }

  return unique;
}

function formatWowAliases(snapshot, config) {
  const fallback = String(config?.wowKeyword || "wow").trim().toLowerCase() || "wow";
  const aliases = Array.isArray(snapshot?.wowAliases) && snapshot.wowAliases.length
    ? snapshot.wowAliases
    : [fallback];
  return aliases.join(", ");
}

function formatSettingsSummary(snapshot, config) {
  return [
    "*Configurações Atuais*",
    `- Grupo do rank: ${snapshot.ratingGroupJid || "todos os chats"}`,
    `- Grupo principal de comandos: ${snapshot.mainCommandsGroupJid || "todos os grupos/chats"}`,
    `- Usuário protegido: ${snapshot.protectedUserJid || "nenhum"}`,
    `- Número protegido: ${snapshot.protectedNumber || "nenhum"}`,
    `- Aliases wow: ${formatWowAliases(snapshot, config)}`,
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
    `${cmd} numero <55DDDNUMERO>|off`,
    `${cmd} wowalias status`,
    `${cmd} wowalias add <alias1 alias2>`,
    `${cmd} wowalias remove <alias1 alias2>`,
    `${cmd} wowalias set <alias1 alias2>|off`
  ].join("\n");
}

function buildWowAliasHelp(config) {
  const cmd = `${config.commandPrefix}${config.settingsCommand}`;
  return [
    "Use uma dessas opções",
    `${cmd} wowalias status`,
    `${cmd} wowalias add <alias1 alias2>`,
    `${cmd} wowalias remove <alias1 alias2>`,
    `${cmd} wowalias set <alias1 alias2>|off`
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
    await sock.sendMessage(chatId, { text: formatSettingsSummary(snapshot, config) }, { quoted: message });
    return;
  }

  const action = String(args[0] || "").toLowerCase();

  if (action === "rank") {
    const value = args[1] || "";
    if (isOffKeyword(value)) {
      const snapshot = runtimeSettingsStore.setRatingGroupJid("");
      await sock.sendMessage(chatId, { text: `Grupo do rank liberado para todos os chats\n\n${formatSettingsSummary(snapshot, config)}` }, { quoted: message });
      return;
    }

    const targetGroup = parseGroupTarget(value, chatId);
    if (!targetGroup || !String(targetGroup).endsWith("@g.us")) {
      await sock.sendMessage(chatId, { text: "Use um grupo válido, por exemplo aqui ou <jid>@g.us" }, { quoted: message });
      return;
    }

    const snapshot = runtimeSettingsStore.setRatingGroupJid(targetGroup);
    await sock.sendMessage(chatId, { text: `Grupo do rank configurado para ${targetGroup}\n\n${formatSettingsSummary(snapshot, config)}` }, { quoted: message });
    return;
  }

  if (action === "principal") {
    const value = args[1] || "";
    if (isOffKeyword(value)) {
      const snapshot = runtimeSettingsStore.setMainCommandsGroupJid("");
      await sock.sendMessage(chatId, { text: `Comandos liberados para todos os grupos/chats\n\n${formatSettingsSummary(snapshot, config)}` }, { quoted: message });
      return;
    }

    const targetGroup = parseGroupTarget(value, chatId);
    if (!targetGroup || !String(targetGroup).endsWith("@g.us")) {
      await sock.sendMessage(chatId, { text: "Use um grupo válido, por exemplo aqui ou <jid>@g.us" }, { quoted: message });
      return;
    }

    const snapshot = runtimeSettingsStore.setMainCommandsGroupJid(targetGroup);
    await sock.sendMessage(chatId, { text: `Grupo principal de comandos configurado para ${targetGroup}\n\n${formatSettingsSummary(snapshot, config)}` }, { quoted: message });
    return;
  }

  if (action === "protegido") {
    const value = args[1] || "";
    if (isOffKeyword(value)) {
      const snapshot = runtimeSettingsStore.setProtectedUserJid("");
      await sock.sendMessage(chatId, { text: `Usuário protegido removido\n\n${formatSettingsSummary(snapshot, config)}` }, { quoted: message });
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
    await sock.sendMessage(chatId, { text: `Usuário protegido configurado: ${targetJid}\n\n${formatSettingsSummary(snapshot, config)}` }, { quoted: message });
    return;
  }

  if (action === "numero") {
    const value = args[1] || "";
    if (isOffKeyword(value)) {
      const snapshot = runtimeSettingsStore.setProtectedNumber("");
      await sock.sendMessage(chatId, { text: `Número protegido removido\n\n${formatSettingsSummary(snapshot, config)}` }, { quoted: message });
      return;
    }

    const digits = toDigits(value);
    if (!digits || digits.length < 10 || digits.length > 15) {
      await sock.sendMessage(chatId, { text: "Informe um número válido no formato 55DDDNUMERO" }, { quoted: message });
      return;
    }

    const snapshot = runtimeSettingsStore.setProtectedNumber(digits);
    await sock.sendMessage(chatId, { text: `Número protegido configurado: ${digits}\n\n${formatSettingsSummary(snapshot, config)}` }, { quoted: message });
    return;
  }

  if (action === "wowalias" || action === "wowaliases") {
    const subaction = String(args[1] || "status").toLowerCase();
    const rawAliasText = args.slice(2).join(" ");
    const aliasTokens = sanitizeAliasTokens(parseAliasText(rawAliasText), config);

    if (["status", "listar", "list", "ls"].includes(subaction)) {
      const snapshot = runtimeSettingsStore.getSnapshot();
      await sock.sendMessage(chatId, { text: `Aliases wow ativos: ${formatWowAliases(snapshot, config)}` }, { quoted: message });
      return;
    }

    if (["add", "adicionar", "append", "+"].includes(subaction)) {
      if (!aliasTokens.length) {
        await sock.sendMessage(chatId, { text: buildWowAliasHelp(config) }, { quoted: message });
        return;
      }

      const snapshot = runtimeSettingsStore.addWowAliases(aliasTokens);
      await sock.sendMessage(chatId, { text: `Aliases wow adicionados: ${aliasTokens.join(", ")}\n\n${formatSettingsSummary(snapshot, config)}` }, { quoted: message });
      return;
    }

    if (["remove", "remover", "del", "rm", "-"].includes(subaction)) {
      if (!aliasTokens.length) {
        await sock.sendMessage(chatId, { text: buildWowAliasHelp(config) }, { quoted: message });
        return;
      }

      const snapshot = runtimeSettingsStore.removeWowAliases(aliasTokens);
      await sock.sendMessage(chatId, { text: `Aliases wow removidos: ${aliasTokens.join(", ")}\n\n${formatSettingsSummary(snapshot, config)}` }, { quoted: message });
      return;
    }

    if (["set", "editar", "edit", "replace", "definir"].includes(subaction) || isOffKeyword(subaction)) {
      if (isOffKeyword(subaction) || isOffKeyword(rawAliasText)) {
        const snapshot = runtimeSettingsStore.setWowAliases([]);
        await sock.sendMessage(chatId, { text: `Aliases wow extras removidos\n\n${formatSettingsSummary(snapshot, config)}` }, { quoted: message });
        return;
      }

      if (!aliasTokens.length) {
        await sock.sendMessage(chatId, { text: buildWowAliasHelp(config) }, { quoted: message });
        return;
      }

      const snapshot = runtimeSettingsStore.setWowAliases(aliasTokens);
      await sock.sendMessage(chatId, { text: `Aliases wow atualizados para: ${formatWowAliases(snapshot, config)}\n\n${formatSettingsSummary(snapshot, config)}` }, { quoted: message });
      return;
    }

    await sock.sendMessage(chatId, { text: buildWowAliasHelp(config) }, { quoted: message });
    return;
  }

  await sock.sendMessage(chatId, { text: buildHelpText(config) }, { quoted: message });
}

module.exports = executeSettings;