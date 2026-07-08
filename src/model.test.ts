import { describe, expect, it } from "vitest";
import { compactFileName, estimateGifSizeMb, estimateMp4SizeMb, gifLoopDurationSeconds, indexedExportFolderName, indexedExportName, initialProject, isValidDuration, moveItem, parseDurationInput, pictureSequenceLength, playbackSequenceLength, scaledOutputDimensions, sourceImageBitsPerPixel } from "./model";

describe("frame reordering", () => {
  it("moves the selected frame and preserves the frame objects", () => {
    const frames = [
      { id: "one", point: { x: 1, y: 1 } },
      { id: "two", point: { x: 2, y: 2 } },
      { id: "three", point: { x: 3, y: 3 } },
      { id: "four", point: { x: 4, y: 4 } },
    ];
    const reordered = moveItem(frames, 3, 0);
    expect(reordered.map(({ id }) => id)).toEqual(["four", "one", "two", "three"]);
    expect(reordered[0]).toBe(frames[3]);
    expect(reordered[0].point).toEqual({ x: 4, y: 4 });
  });
});

describe("export inputs", () => {
  it("allows an empty duration draft but validates only the supported range", () => {
    expect(parseDurationInput("")).toBeUndefined();
    expect(isValidDuration("")).toBe(false);
    expect(isValidDuration("0.1")).toBe(false);
    expect(isValidDuration("0,2")).toBe(true);
    expect(isValidDuration("120")).toBe(true);
    expect(isValidDuration("121")).toBe(false);
  });

  it("creates zero-padded sequential export names", () => {
    expect(indexedExportName(1)).toBe("wigglegram_001.mp4");
    expect(indexedExportName(12)).toBe("wigglegram_012.mp4");
    expect(indexedExportName(123)).toBe("wigglegram_123.mp4");
    expect(indexedExportName(4, "gif")).toBe("wigglegram_004.gif");
    expect(indexedExportFolderName(7)).toBe("wigglegram_007");
  });

  it("uses ten seconds as the initial duration", () => {
    expect(initialProject.export.durationSeconds).toBe(10);
  });

  it("uses 110 ms as the initial frame speed", () => {
    expect(initialProject.speedMs).toBe(110);
  });

  it("keeps interpolation off by default", () => {
    expect(initialProject.interpolationMode).toBe("off");
  });

  it("uses png as the initial image export format", () => {
    expect(initialProject.export.imageFormat).toBe("png");
  });

  it("calculates even output dimensions and a responsive size estimate", () => {
    expect(scaledOutputDimensions({ x: 0, y: 0, width: 2324, height: 3196 }, 0.75))
      .toEqual({ width: 1742, height: 2396 });
    const full = estimateMp4SizeMb(2324, 3196, 10, 110);
    const half = estimateMp4SizeMb(1162, 1598, 10, 110);
    const smoothed = estimateMp4SizeMb(2324, 3196, 10, 110, 4.4, "smooth");
    expect(full).toBeGreaterThan(half);
    expect(smoothed).toBeGreaterThan(full);
    expect(half).toBeGreaterThan(0);
  });

  it("uses a single cycle for GIF exports and estimates their size separately", () => {
    expect(playbackSequenceLength(4, "ping-pong")).toBe(6);
    expect(playbackSequenceLength(3, "ping-pong")).toBe(4);
    expect(playbackSequenceLength(2, "ping-pong")).toBe(2);
    expect(playbackSequenceLength(4, "loop")).toBe(4);
    expect(gifLoopDurationSeconds(4, "ping-pong", 110)).toBeCloseTo(0.66, 5);
    const files = [4_490_497, 4_310_773, 4_250_681, 4_211_182];
    const frames = files.map((fileSizeBytes) => ({ width: 2397, height: 3231, fileSizeBytes }));
    const complexity = sourceImageBitsPerPixel(frames);
    const estimated = estimateGifSizeMb(2397, 3231, 4, "ping-pong", complexity);
    const smoothed = estimateGifSizeMb(2397, 3231, 4, "ping-pong", complexity, "smooth");
    expect(estimated).toBeGreaterThan(30);
    expect(estimated).toBeLessThan(35);
    expect(smoothed).toBeGreaterThan(estimated);
  });

  it("counts smooth picture exports as forward frames plus in-betweens", () => {
    expect(pictureSequenceLength(4, "off")).toBe(4);
    expect(pictureSequenceLength(4, "smooth")).toBe(7);
    expect(pictureSequenceLength(2, "smooth")).toBe(3);
  });

  it("calibrates the estimate from the real Nishika source JPEG complexity", () => {
    const files = [4_490_497, 4_211_182, 4_310_773, 4_250_681];
    const frames = files.map((fileSizeBytes) => ({ width: 2397, height: 3231, fileSizeBytes }));
    const complexity = sourceImageBitsPerPixel(frames);
    const estimated = estimateMp4SizeMb(2218, 2958, 10, 50, complexity);
    expect(estimated).toBeGreaterThan(55);
    expect(estimated).toBeLessThan(62);
  });
});

describe("file names", () => {
  it("keeps short names and compacts long camera names without losing the extension", () => {
    expect(compactFileName("IMG_01.JPG")).toBe("IMG_01.JPG");
    expect(compactFileName("R1-02913-018A.JPG")).toBe("R1-...-018A.JPG");
  });
});
