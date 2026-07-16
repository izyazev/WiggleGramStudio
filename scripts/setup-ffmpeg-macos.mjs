import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { arch, platform } from "node:os";
import { resolve } from "node:path";

const version = "6.1.1";
const release = `b${version}`;
const asset = "ffmpeg-darwin-arm64.gz";
const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${release}/${asset}`;
const compressedSha256 = "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa";
const binarySha256 = "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584";

if (platform() !== "darwin" || arch() !== "arm64") {
  throw new Error("This helper supports Apple Silicon macOS (arm64) only.");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const response = await fetch(url);
if (!response.ok) {
  throw new Error(`Failed to download FFmpeg ${version}: HTTP ${response.status}`);
}

const compressed = Buffer.from(await response.arrayBuffer());
if (sha256(compressed) !== compressedSha256) {
  throw new Error("Downloaded FFmpeg archive failed SHA-256 verification.");
}

const binary = gunzipSync(compressed);
if (sha256(binary) !== binarySha256) {
  throw new Error("Extracted FFmpeg binary failed SHA-256 verification.");
}

const directory = resolve("src-tauri/binaries");
const target = resolve(directory, "ffmpeg-aarch64-apple-darwin");
mkdirSync(directory, { recursive: true });
writeFileSync(target, binary, { mode: 0o755 });
chmodSync(target, 0o755);

console.log(`Standalone FFmpeg ${version}: ${target}`);
