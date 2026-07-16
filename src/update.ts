const latestReleaseApiUrl = "https://api.github.com/repos/izyazev/WiggleGramStudio/releases/latest";
const latestReleaseUrl = "https://github.com/izyazev/WiggleGramStudio/releases/latest";

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

interface GithubRelease {
  tag_name: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

function parseVersion(value: string): ParsedVersion {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i);
  if (!match) throw new Error(`Invalid version: ${value}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;
    const leftNumber = /^\d+$/.test(left[index]) ? Number(left[index]) : undefined;
    const rightNumber = /^\d+$/.test(right[index]) ? Number(right[index]) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

export function isVersionNewer(current: string, candidate: string): boolean {
  const currentVersion = parseVersion(current);
  const candidateVersion = parseVersion(candidate);
  for (let index = 0; index < currentVersion.core.length; index += 1) {
    if (candidateVersion.core[index] === currentVersion.core[index]) continue;
    return candidateVersion.core[index] > currentVersion.core[index];
  }
  return comparePrerelease(candidateVersion.prerelease, currentVersion.prerelease) > 0;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(latestReleaseApiUrl, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}`);
    const release = await response.json() as GithubRelease;
    const latestVersion = release.tag_name.trim().replace(/^v/i, "");
    return {
      currentVersion: __APP_VERSION__,
      latestVersion,
      updateAvailable: isVersionNewer(__APP_VERSION__, latestVersion),
      releaseUrl: latestReleaseUrl,
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
