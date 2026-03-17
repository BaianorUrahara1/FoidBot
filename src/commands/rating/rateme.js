const { resolveRatingProgress } = require("../../rating/scale");

async function executeRateMe({ sock, ratingStore, config, message, chatId, senderJid }) {
  if (!ratingStore) {
    await sock.sendMessage(chatId, { text: "Ranking indisponível no momento" }, { quoted: message });
    return;
  }

  const stats = ratingStore.getUserStats(senderJid, { chatId: config.ratingGroupJid });
  const progress = resolveRatingProgress(stats.messages);
  const header = `Seu rank atual: ${progress.rankLabel} (${progress.score.toFixed(2)})`;
  const progressLine = progress.isMax
    ? "Mensagens enviadas: máximo atingido"
    : `Mensagens enviadas: ${stats.messages}/${progress.nextThreshold}`;
  const nextLine = progress.isMax
    ? "Você já está no rank máximo"
    : `Faltam ${progress.messagesToNext} mensagens para upar`;

  await sock.sendMessage(
    chatId,
    {
      text: `${header}\n${progressLine}\n${nextLine}`
    },
    { quoted: message }
  );
}

module.exports = executeRateMe;
