import { describe, expect, it } from "vitest";
import { calculateOffsets, commonBounds, cropToAspect, fitInside, isCropInside, normalizeCrop, transformCrop } from "./geometry";
import type { PhotoFrame } from "./model";

function frame(id: string, width: number, height: number, x: number, y: number): PhotoFrame {
  return {
    id,
    path: `/${id}.jpg`,
    name: `${id}.jpg`,
    width,
    height,
    previewUrl: "data:",
    previewWidth: width,
    previewHeight: height,
    fileSizeBytes: 4_300_000,
    point: { x, y },
  };
}

describe("alignment geometry", () => {
  it("fits portrait and landscape images completely inside the viewport", () => {
    const portrait = fitInside({ width: 2324, height: 3196 }, { width: 900, height: 500 }, 10);
    expect(portrait.width).toBeCloseTo(349.05, 1);
    expect(portrait.height).toBeCloseTo(480);
    const landscape = fitInside({ width: 3200, height: 2200 }, { width: 500, height: 700 }, 10);
    expect(landscape.width).toBe(480);
    expect(landscape.height).toBeCloseTo(330);
  });

  it("moves every anchor point onto the first frame anchor", () => {
    const aligned = calculateOffsets([
      frame("a", 1000, 800, 400, 300),
      frame("b", 1000, 800, 425, 280),
      frame("c", 900, 700, 370, 310),
    ]);
    expect(aligned.map(({ offset }) => offset)).toEqual([
      { x: 0, y: 0 },
      { x: -25, y: 20 },
      { x: 30, y: -10 },
    ]);
    for (const item of aligned) {
      expect(item.point!.x + item.offset.x).toBe(400);
      expect(item.point!.y + item.offset.y).toBe(300);
    }
  });

  it("finds the intersection available in every translated frame", () => {
    const bounds = commonBounds([
      frame("a", 1000, 800, 400, 300),
      frame("b", 1000, 800, 425, 280),
      frame("c", 900, 700, 370, 310),
    ]);
    expect(bounds).toEqual({ x: 30, y: 20, width: 900, height: 670 });
    expect(isCropInside({ x: 50, y: 30, width: 800, height: 600 }, bounds!)).toBe(true);
    expect(isCropInside({ x: 0, y: 0, width: 900, height: 700 }, bounds!)).toBe(false);
  });

  it("normalizes a reverse drag and clamps it to common bounds", () => {
    expect(normalizeCrop({ x: 900, y: 650 }, { x: 10, y: 5 }, { x: 30, y: 20, width: 870, height: 630 }))
      .toEqual({ x: 30, y: 20, width: 870, height: 630 });
  });

  it("moves, resizes and corner-scales an existing crop", () => {
    const bounds = { x: 0, y: 0, width: 1000, height: 800 };
    const crop = { x: 100, y: 100, width: 600, height: 500 };
    expect(transformCrop(crop, "move", { x: 200, y: 200 }, { x: 350, y: 300 }, bounds))
      .toEqual({ x: 250, y: 200, width: 600, height: 500 });
    expect(transformCrop(crop, "n", { x: 400, y: 100 }, { x: 400, y: 180 }, bounds))
      .toEqual({ x: 100, y: 180, width: 600, height: 420 });
    expect(transformCrop(crop, "se", { x: 700, y: 600 }, { x: 850, y: 720 }, bounds))
      .toEqual({ x: 100, y: 100, width: 750, height: 620 });
  });

  it("creates and resizes a locked aspect crop", () => {
    const bounds = { x: 0, y: 0, width: 1000, height: 800 };
    const portrait = cropToAspect(bounds, 3 / 4);
    expect(portrait).toEqual({ x: 200, y: 0, width: 600, height: 800 });
    const resized = transformCrop(portrait, "se", { x: 800, y: 800 }, { x: 650, y: 600 }, bounds, 8, 3 / 4);
    expect(resized.width / resized.height).toBeCloseTo(3 / 4, 2);
    expect(isCropInside(resized, bounds)).toBe(true);
  });
});
