import type { CropAspectPreset, CropRect, PhotoFrame, Point } from "./model";

export interface AlignedFrame extends PhotoFrame {
  offset: Point;
}

export interface Size {
  width: number;
  height: number;
}

export function fitInside(
  image: Size,
  container: Size,
  padding = 0,
  zoom = 1,
): Size {
  if (image.width <= 0 || image.height <= 0 || container.width <= 0 || container.height <= 0) {
    return { width: 0, height: 0 };
  }
  const availableWidth = Math.max(1, container.width - padding * 2);
  const availableHeight = Math.max(1, container.height - padding * 2);
  const scale = Math.min(availableWidth / image.width, availableHeight / image.height) * zoom;
  return { width: image.width * scale, height: image.height * scale };
}

export function calculateOffsets(frames: PhotoFrame[]): AlignedFrame[] {
  const basePoint = frames[0]?.point;
  return frames.map((frame) => ({
    ...frame,
    offset:
      basePoint && frame.point
        ? { x: basePoint.x - frame.point.x, y: basePoint.y - frame.point.y }
        : { x: 0, y: 0 },
  }));
}

export function commonBounds(frames: PhotoFrame[]): CropRect | undefined {
  if (frames.length === 0 || frames.some((frame) => !frame.point)) return undefined;
  const aligned = calculateOffsets(frames);
  const left = Math.max(...aligned.map((frame) => frame.offset.x));
  const top = Math.max(...aligned.map((frame) => frame.offset.y));
  const right = Math.min(...aligned.map((frame) => frame.offset.x + frame.width));
  const bottom = Math.min(...aligned.map((frame) => frame.offset.y + frame.height));
  if (right <= left || bottom <= top) return undefined;
  return {
    x: Math.ceil(left),
    y: Math.ceil(top),
    width: Math.floor(right) - Math.ceil(left),
    height: Math.floor(bottom) - Math.ceil(top),
  };
}

export function isCropInside(crop: CropRect, bounds: CropRect): boolean {
  return (
    crop.width >= 2 &&
    crop.height >= 2 &&
    crop.x >= bounds.x &&
    crop.y >= bounds.y &&
    crop.x + crop.width <= bounds.x + bounds.width &&
    crop.y + crop.height <= bounds.y + bounds.height
  );
}

export function normalizeCrop(a: Point, b: Point, bounds: CropRect): CropRect {
  const left = Math.max(bounds.x, Math.min(a.x, b.x));
  const top = Math.max(bounds.y, Math.min(a.y, b.y));
  const right = Math.min(bounds.x + bounds.width, Math.max(a.x, b.x));
  const bottom = Math.min(bounds.y + bounds.height, Math.max(a.y, b.y));
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(2, Math.round(right - left)),
    height: Math.max(2, Math.round(bottom - top)),
  };
}

export type CropTransformAction = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export function aspectRatioForPreset(preset: CropAspectPreset): number | undefined {
  const ratios: Record<Exclude<CropAspectPreset, "free">, number> = {
    "4:3": 4 / 3,
    "3:4": 3 / 4,
    "16:9": 16 / 9,
    "9:16": 9 / 16,
  };
  return preset === "free" ? undefined : ratios[preset];
}

export function cropToAspect(container: CropRect, ratio: number): CropRect {
  let width = container.width;
  let height = Math.round(width / ratio);
  if (height > container.height) {
    height = container.height;
    width = Math.round(height * ratio);
  }
  width = Math.max(2, Math.min(container.width, width));
  height = Math.max(2, Math.min(container.height, height));
  return {
    x: Math.round(container.x + (container.width - width) / 2),
    y: Math.round(container.y + (container.height - height) / 2),
    width,
    height,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function transformCrop(
  crop: CropRect,
  action: CropTransformAction,
  start: Point,
  current: Point,
  bounds: CropRect,
  minimumSize = 8,
  aspectRatio?: number,
): CropRect {
  const deltaX = current.x - start.x;
  const deltaY = current.y - start.y;
  const boundsRight = bounds.x + bounds.width;
  const boundsBottom = bounds.y + bounds.height;

  if (action === "move") {
    return {
      x: Math.round(clamp(crop.x + deltaX, bounds.x, boundsRight - crop.width)),
      y: Math.round(clamp(crop.y + deltaY, bounds.y, boundsBottom - crop.height)),
      width: crop.width,
      height: crop.height,
    };
  }


  if (aspectRatio) {
    const horizontalScale = action.includes("e")
      ? (crop.width + deltaX) / crop.width
      : action.includes("w")
        ? (crop.width - deltaX) / crop.width
        : 1;
    const verticalScale = action.includes("s")
      ? (crop.height + deltaY) / crop.height
      : action.includes("n")
        ? (crop.height - deltaY) / crop.height
        : 1;
    let requestedScale = action.length === 2
      ? (Math.abs(horizontalScale - 1) >= Math.abs(verticalScale - 1) ? horizontalScale : verticalScale)
      : action === "e" || action === "w"
        ? horizontalScale
        : verticalScale;
    const centerX = crop.x + crop.width / 2;
    const centerY = crop.y + crop.height / 2;
    const horizontalRoom = action.includes("e")
      ? boundsRight - crop.x
      : action.includes("w")
        ? crop.x + crop.width - bounds.x
        : 2 * Math.min(centerX - bounds.x, boundsRight - centerX);
    const verticalRoom = action.includes("s")
      ? boundsBottom - crop.y
      : action.includes("n")
        ? crop.y + crop.height - bounds.y
        : 2 * Math.min(centerY - bounds.y, boundsBottom - centerY);
    const minimumScale = Math.max(minimumSize / crop.width, minimumSize / crop.height);
    const maximumScale = Math.min(horizontalRoom / crop.width, verticalRoom / crop.height);
    requestedScale = clamp(requestedScale, minimumScale, maximumScale);
    const width = Math.max(minimumSize, Math.round(crop.width * requestedScale));
    const height = Math.max(minimumSize, Math.round(width / aspectRatio));
    const x = action.includes("w")
      ? crop.x + crop.width - width
      : action.includes("e")
        ? crop.x
        : Math.round(centerX - width / 2);
    const y = action.includes("n")
      ? crop.y + crop.height - height
      : action.includes("s")
        ? crop.y
        : Math.round(centerY - height / 2);
    return { x: Math.round(x), y: Math.round(y), width, height };
  }

  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.width;
  let bottom = crop.y + crop.height;
  if (action.includes("w")) left = clamp(left + deltaX, bounds.x, right - minimumSize);
  if (action.includes("e")) right = clamp(right + deltaX, left + minimumSize, boundsRight);
  if (action.includes("n")) top = clamp(top + deltaY, bounds.y, bottom - minimumSize);
  if (action.includes("s")) bottom = clamp(bottom + deltaY, top + minimumSize, boundsBottom);
  left = Math.round(left);
  top = Math.round(top);
  right = Math.round(right);
  bottom = Math.round(bottom);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
