const { resolveRatingProgress } = require("../../rating/scale");

function mentionTokenFromJid(jid) {
  return String(jid || "").split("@")[0];
}

async function executeRank({ sock, ratingStore, config, message, chatId }) {
  if (!ratingStore) {
    await sock.sendMessage(chatId, { text: "Ranking indisponível no momento" }, { quoted: message });
    return;
  }

  const top = ratingStore.listTopUsers(5, { chatId: config.ratingGroupJid });
  if (!top.length) {
    await sock.sendMessage(chatId, { text: "Tabela dos Ratings:\nNenhum usuário no ranking ainda" }, { quoted: message });
    return;
  }

  const mentions = top.map((entry) => entry.jid);
  const lines = ["Tabela dos Ratings:"];
  top.forEach((entry, index) => {
    const progress = resolveRatingProgress(entry.messages);
    const token = mentionTokenFromJid(entry.jid);
    lines.push(
      `${index + 1}. @${token} ${progress.rankLabel} (${progress.score.toFixed(2)}) - ${entry.messages} msgs`
    );
  });

  await sock.sendMessage(
    chatId,
    {
      text: lines.join("\n"),
      mentions
    },
    { quoted: message }
  );
}

module.exports = executeRank;
