function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasCommandToken(messageBody, commandPrefix, allowedCommands) {
  const text = (messageBody || "").trim();
  if (!text) {
    return false;
  }

  const prefix = escapeRegex(commandPrefix);
  const commandsPattern = allowedCommands.map((command) => escapeRegex(command)).join("|");
  const commandRegex = new RegExp(`(^|\\s)${prefix}(${commandsPattern})(?=\\s|$)`, "i");
  return commandRegex.test(text);
}

module.exports = {
  hasCommandToken
};
