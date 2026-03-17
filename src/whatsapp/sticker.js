const { downloadContentFromMessage } = require("@whiskeysockets/baileys");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const sharp = require("sharp");
let ffmpegStaticPath = "";

try {
  ffmpegStaticPath = String(require("ffmpeg-static") || "").trim();
} catch {
  ffmpegStaticPath = "";
}

async function downloadMediaBuffer(media, mediaType) {
  const stream = await downloadContentFromMessage(media, mediaType);
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function imageBufferToSticker(buffer) {
  return sharp(buffer)
    .resize(512, 512, {
      fit: "contain",
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0
      }
    })
    .webp({ quality: 80 })
    .toBuffer();
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

function resolveFfmpegPath() {
  const envValue = String(process.env.FFMPEG_PATH || "").trim();
  if (envValue && envValue.toLowerCase() !== "ffmpeg") {
    return envValue;
  }
  if (ffmpegStaticPath) {
    return ffmpegStaticPath;
  }
  return envValue || "ffmpeg";
}

async function videoBufferToAnimatedSticker(buffer, options = {}) {
  const ffmpegPath = resolveFfmpegPath();
  const maxDurationSeconds = Math.max(1, Number(options.maxDurationSeconds || 8));
  const fps = Math.max(8, Math.min(18, Number(options.fps || 12)));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "foidbot-sticker-"));
  const inputPath = path.join(tempDir, "input.mp4");
  const outputPath = path.join(tempDir, "output.webp");

  try {
    fs.writeFileSync(inputPath, buffer);

    const args = [
      "-y",
      "-i",
      inputPath,
      "-t",
      String(maxDurationSeconds),
      "-vf",
      `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:-1:-1:color=0x00000000`,
      "-loop",
      "0",
      "-an",
      "-vsync",
      "0",
      "-vcodec",
      "libwebp",
      "-preset",
      "default",
      "-lossless",
      "0",
      "-q:v",
      "55",
      "-compression_level",
      "6",
      outputPath
    ];

    await runProcess(ffmpegPath, args);
    return fs.readFileSync(outputPath);
  } catch (error) {
    const message = String(error?.message || error || "");
    if (message.toLowerCase().includes("enoent")) {
      const notFound = new Error("FFMPEG_NOT_FOUND");
      notFound.code = "FFMPEG_NOT_FOUND";
      throw notFound;
    }
    throw error;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

module.exports = {
  downloadMediaBuffer,
  imageBufferToSticker,
  videoBufferToAnimatedSticker
};
