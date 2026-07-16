import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2]?.trim().replace(/^v/i, "");
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Usage: npm run version:set -- 0.2.0");
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = resolve(repositoryRoot, "package.json");
const packageLockPath = resolve(repositoryRoot, "package-lock.json");
const tauriConfigPath = resolve(repositoryRoot, "src-tauri/tauri.conf.json");
const cargoManifestPath = resolve(repositoryRoot, "src-tauri/Cargo.toml");
const cargoLockPath = resolve(repositoryRoot, "src-tauri/Cargo.lock");

function updateJson(path, update) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  update(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

updateJson(packagePath, (value) => { value.version = version; });
updateJson(packageLockPath, (value) => {
  value.version = version;
  value.packages[""].version = version;
});
updateJson(tauriConfigPath, (value) => { value.version = version; });

const cargoManifest = readFileSync(cargoManifestPath, "utf8").replace(
  /(^\[package\][\s\S]*?^version = ")[^"]+("$)/m,
  (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
);
writeFileSync(cargoManifestPath, cargoManifest);

const cargoLock = readFileSync(cargoLockPath, "utf8").replace(
  /(\[\[package\]\]\r?\nname = "wigglegram-studio"\r?\nversion = ")[^"]+("\r?\n)/,
  (_match, prefix, suffix) => `${prefix}${version}${suffix}`,
);
writeFileSync(cargoLockPath, cargoLock);

console.log(`WiggleGram Studio version set to ${version}`);
