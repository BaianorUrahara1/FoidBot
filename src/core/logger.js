const util = require("util");

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m"
};

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  event: 2,
  success: 2,
  debug: 3
};

const configuredLevel = String(process.env.LOG_LEVEL || "info").toLowerCase();
const maxLevel = Object.prototype.hasOwnProperty.call(LEVELS, configuredLevel)
  ? LEVELS[configuredLevel]
  : LEVELS.info;
const useColor = process.stdout.isTTY && process.env.NO_COLOR !== "true";

function paint(color, text) {
  if (!useColor) {
    return text;
  }
  return `${color}${text}${COLORS.reset}`;
}

function toTimestamp() {
  const now = new Date();
  const date = now.toISOString().replace("T", " ");
  return date.slice(0, 19);
}

function normalizeArgs(args) {
  return util.format(...args);
}

function write(level, scope, color, args) {
  if (LEVELS[level] > maxLevel) {
    return;
  }
  const ts = paint(COLORS.dim, toTimestamp());
  const lvl = paint(color, level.toUpperCase().padEnd(7, " "));
  const scp = paint(COLORS.blue, String(scope || "APP").toUpperCase());
  const body = normalizeArgs(args);
  console.log(`${ts} ${lvl} [${scp}] ${body}`);
}

function info(scope, ...args) {
  write("info", scope, COLORS.cyan, args);
}

function success(scope, ...args) {
  write("success", scope, COLORS.green, args);
}

function warn(scope, ...args) {
  write("warn", scope, COLORS.yellow, args);
}

function error(scope, ...args) {
  write("error", scope, COLORS.red, args);
}

function debug(scope, ...args) {
  write("debug", scope, COLORS.magenta, args);
}

function event(scope, ...args) {
  write("event", scope, COLORS.blue, args);
}

function startupBanner(config) {
  info("startup", "Prefixo: %s", config.commandPrefix);
  const commands = [
    `${config.commandPrefix}${config.settingsCommand}`,
    `${config.commandPrefix}${config.stickerCommand}`,
    `${config.commandPrefix}s`,
    `${config.commandPrefix}${config.revealCommand}`,
    `${config.commandPrefix}${config.voiceCommand}`,
    `${config.commandPrefix}${config.photoCommand}`,
    `${config.wowKeyword}`,
    `${config.commandPrefix}${config.connectCommand}`,
    `${config.commandPrefix}${config.restoreCommand}`,
    `${config.commandPrefix}${config.rateMeCommand}`,
    `${config.commandPrefix}${config.rankCommand}`
  ];
  info("startup", "Comandos: %s", commands.join(", "));
}

module.exports = {
  info,
  success,
  warn,
  error,
  debug,
  event,
  startupBanner
};
