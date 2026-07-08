export type PlaybackMode = "ping-pong" | "loop";
export type CropAspectPreset = "free" | "4:3" | "3:4" | "16:9" | "9:16";
export type ExportFormat = "mp4" | "gif" | "pic";
export type ExportImageFormat = "png" | "jpg" | "tiff";
export type InterpolationMode = "off" | "blend" | "smooth";
export const maxGifSizeMb = 64;

export interface Point {
  x: number;
  y: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhotoFrame {
  id: string;
  path: string;
  name: string;
  width: number;
  height: number;
  previewUrl: string;
  previewWidth: number;
  previewHeight: number;
  fileSizeBytes: number;
  point?: Point;
}

export interface ExportSettings {
  durationSeconds: number;
  scale: number;
  format: ExportFormat;
  imageFormat: ExportImageFormat;
}

export interface ProjectState {
  frames: PhotoFrame[];
  selectedId?: string;
  crop?: CropRect;
  cropAspect: CropAspectPreset;
  speedMs: number;
  mode: PlaybackMode;
  interpolationMode: InterpolationMode;
  export: ExportSettings;
}

export interface LoadedImage {
  path: string;
  name: string;
  width: number;
  height: number;
  previewUrl: string;
  previewWidth: number;
  previewHeight: number;
  fileSizeBytes: number;
}

export const initialProject: ProjectState = {
  frames: [],
  cropAspect: "free",
  speedMs: 110,
  mode: "ping-pong",
  interpolationMode: "off",
  export: { durationSeconds: 10, scale: 1, format: "mp4", imageFormat: "png" },
};

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const reordered = [...items];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  return reordered;
}

export function parseDurationInput(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function isValidDuration(value: string): boolean {
  const parsed = parseDurationInput(value);
  return parsed !== undefined && parsed >= 0.2 && parsed <= 120;
}

export function indexedExportName(index: number, format: Exclude<ExportFormat, "pic"> = "mp4"): string {
  return `wigglegram_${Math.max(1, index).toString().padStart(3, "0")}.${format}`;
}

export function indexedExportFolderName(index: number): string {
  return `wigglegram_${Math.max(1, index).toString().padStart(3, "0")}`;
}

export function playbackSequenceLength(
  frameCount: number,
  mode: PlaybackMode,
  interpolationMode: InterpolationMode = "off",
): number {
  if (frameCount <= 0) return 0;
  const base = mode === "ping-pong" && frameCount > 2 ? frameCount * 2 - 2 : frameCount;
  return interpolationMode !== "off" && base > 1 ? base * 2 : base;
}

export function pictureSequenceLength(
  frameCount: number,
  interpolationMode: InterpolationMode = "off",
): number {
  if (frameCount <= 0) return 0;
  return interpolationMode === "smooth" && frameCount > 1 ? frameCount * 2 - 1 : frameCount;
}

export function compactFileName(name: string, maxLength = 15): string {
  if (name.length <= maxLength || maxLength < 8) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot) : "";
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const available = Math.max(2, maxLength - extension.length - 3);
  const prefixLength = Math.min(3, Math.max(1, available - 1));
  const suffixLength = available - prefixLength;
  return `${stem.slice(0, prefixLength)}...${stem.slice(-suffixLength)}${extension}`;
}

export function scaledOutputDimensions(crop: CropRect, scale: number): { width: number; height: number } {
  const normalized = Math.max(0.25, Math.min(1, scale));
  return {
    width: Math.max(2, Math.round(crop.width * normalized)) & ~1,
    height: Math.max(2, Math.round(crop.height * normalized)) & ~1,
  };
}

export function estimateMp4SizeMb(
  width: number,
  height: number,
  durationSeconds: number,
  speedMs: number,
  sourceBitsPerPixel = 4.4,
  interpolationMode: InterpolationMode = "off",
): number {
  const interpolationFactor = interpolationMode === "off" ? 1 : 2;
  const framesPerSecond = (1000 / Math.max(50, speedMs)) * interpolationFactor;
  const codecBitsPerPixel = Math.max(0.08, Math.min(0.55, sourceBitsPerPixel * 0.08));
  const estimatedBits = width * height * framesPerSecond * Math.max(0, durationSeconds) * codecBitsPerPixel;
  return Math.max(0.1, estimatedBits / 8_000_000 + 0.15);
}

export function gifLoopDurationSeconds(frameCount: number, mode: PlaybackMode, speedMs: number): number {
  return playbackSequenceLength(frameCount, mode) * Math.max(50, speedMs) / 1000;
}

export function estimateGifSizeMb(
  width: number,
  height: number,
  frameCount: number,
  mode: PlaybackMode,
  sourceBitsPerPixel = 4.4,
  interpolationMode: InterpolationMode = "off",
): number {
  const cycleFrames = playbackSequenceLength(frameCount, mode, interpolationMode);
  const gifBitsPerPixel = Math.max(4.0, Math.min(6.8, sourceBitsPerPixel * 1.25));
  const estimatedBits = width * height * cycleFrames * gifBitsPerPixel;
  return Math.max(0.2, estimatedBits / 8_000_000 + 0.3);
}

export function sourceImageBitsPerPixel(
  frames: Array<Pick<PhotoFrame, "width" | "height" | "fileSizeBytes">>,
): number {
  const pixels = frames.reduce((sum, frame) => sum + frame.width * frame.height, 0);
  const bits = frames.reduce((sum, frame) => sum + frame.fileSizeBytes * 8, 0);
  return pixels > 0 && bits > 0 ? bits / pixels : 4.4;
}
