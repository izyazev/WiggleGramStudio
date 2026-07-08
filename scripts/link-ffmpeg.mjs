import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { arch, platform } from "node:os";
import { resolve } from "node:path";

const tripleByPlatform = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc.exe",
  "win32-arm64": "aarch64-pc-windows-msvc.exe",
};
const triple = tripleByPlatform[`${platform()}-${arch()}`];
if (!triple) throw new Error(`Unsupported host: ${platform()} ${arch()}`);

const source = process.env.FFMPEG_BINARY || process.argv[2] || (() => {
  try { return execFileSync(platform() === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8" }).trim().split(/\r?\n/)[0]; }
  catch { return ""; }
})();
if (!source || !existsSync(source)) {
  throw new Error("FFmpeg not found. Set FFMPEG_BINARY=/absolute/path/to/ffmpeg");
}
const directory = resolve("src-tauri/binaries");
const target = resolve(directory, `ffmpeg-${triple}`);
mkdirSync(directory, { recursive: true });
if (existsSync(target) || (() => { try { return lstatSync(target).isSymbolicLink(); } catch { return false; } })()) unlinkSync(target);
symlinkSync(resolve(source), target);
console.log(`Development sidecar: ${target} -> ${resolve(source)}`);
