const util = require("util");

function shouldSuppressSignalLog(message) {
  if (typeof message !== "string") {
    return false;
  }
  const normalized = message.toLowerCase();
  return (
    message.startsWith("Closing session:") ||
    message.startsWith("Removing old closed session:") ||
    message.includes("Decrypted message with closed session.") ||
    normalized.includes("failed to decrypt message with any known session") ||
    normalized.includes("session error:error: bad mac") ||
    normalized.includes("bad mac") ||
    normalized.includes("closing open session in favor of incoming prekey bundle")
  );
}

function argsToText(args) {
  return args
    .map((value) => {
      if (typeof value === "string") {
        return value;
      }
      return util.inspect(value, { depth: 1, breakLength: Infinity });
    })
    .join(" ");
}

function patchConsoleMethod(methodName) {
  const original = console[methodName].bind(console);
  console[methodName] = (...args) => {
    const message = argsToText(args);
    if (shouldSuppressSignalLog(message)) {
      return;
    }
    original(...args);
  };
}

patchConsoleMethod("log");
patchConsoleMethod("info");
patchConsoleMethod("warn");
patchConsoleMethod("error");

const appLogger = require("./core/logger");
const startBot = require("./bot");

startBot().catch((error) => {
  appLogger.error("boot", "Falha ao iniciar bot: %s", String(error?.message || error));
});
