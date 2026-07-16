import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, isVersionNewer } from "./update";

afterEach(() => vi.unstubAllGlobals());

describe("release version comparison", () => {
  it("accepts release tags with and without a v prefix", () => {
    expect(isVersionNewer("0.1.0", "v0.2.0")).toBe(true);
    expect(isVersionNewer("0.1.0", "0.1.0")).toBe(false);
  });

  it("compares every semantic version component", () => {
    expect(isVersionNewer("0.9.9", "1.0.0")).toBe(true);
    expect(isVersionNewer("1.10.0", "1.9.9")).toBe(false);
  });

  it("treats a stable release as newer than its prerelease", () => {
    expect(isVersionNewer("1.0.0-beta.2", "1.0.0")).toBe(true);
    expect(isVersionNewer("1.0.0", "1.0.0-rc.1")).toBe(false);
  });

  it("reads the latest tag from GitHub Releases", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v999.0.0" }),
    }));
    await expect(checkForUpdate()).resolves.toEqual({
      currentVersion: __APP_VERSION__,
      latestVersion: "999.0.0",
      updateAvailable: true,
      releaseUrl: "https://github.com/izyazev/WiggleGramStudio/releases/latest",
    });
  });
});
