import { calculateOffsets } from "./geometry";
import type { CropRect, InterpolationMode, PhotoFrame } from "./model";
import type { UiStrings } from "./i18n";
import { playbackSteps } from "./playback";
import type { PlaybackMode } from "./model";

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const blendCache = new Map<string, Promise<string>>();

function loadImage(source: string, strings: UiStrings["previewErrors"]): Promise<HTMLImageElement> {
  const cached = imageCache.get(source);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(strings.prepareImage));
    image.src = source;
  });
  imageCache.set(source, promise);
  return promise;
}

export async function preparePreviewFrames(
  frames: PhotoFrame[],
  crop: CropRect,
  strings: UiStrings["previewErrors"],
  maxSize = 960,
): Promise<string[]> {
  const scale = Math.min(1, maxSize / Math.max(crop.width, crop.height));
  const width = Math.max(2, Math.round(crop.width * scale));
  const height = Math.max(2, Math.round(crop.height * scale));
  const aligned = calculateOffsets(frames);

  return Promise.all(
    aligned.map(async (frame) => {
      const image = await loadImage(frame.previewUrl, strings);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error(strings.canvasUnavailable);
      context.fillStyle = "#11110f";
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        (frame.offset.x - crop.x) * scale,
        (frame.offset.y - crop.y) * scale,
        frame.width * scale,
        frame.height * scale,
      );
      return canvas.toDataURL("image/jpeg", 0.88);
    }),
  );
}

export interface PreviewSequenceFrame {
  src: string;
  sourceIndex: number;
  intermediate: boolean;
}

async function blendFrames(
  current: string,
  next: string,
  blend: number,
  strings: UiStrings["previewErrors"],
): Promise<string> {
  const key = `${current}|${next}|${blend}`;
  const cached = blendCache.get(key);
  if (cached) return cached;
  const promise = Promise.all([loadImage(current, strings), loadImage(next, strings)]).then(([currentImage, nextImage]) => {
    const canvas = document.createElement("canvas");
    canvas.width = currentImage.naturalWidth || currentImage.width;
    canvas.height = currentImage.naturalHeight || currentImage.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error(strings.canvasUnavailable);
    context.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
    context.globalAlpha = blend;
    context.drawImage(nextImage, 0, 0, canvas.width, canvas.height);
    context.globalAlpha = 1;
    return canvas.toDataURL("image/jpeg", 0.88);
  });
  blendCache.set(key, promise);
  return promise;
}

export async function buildPreviewSequence(
  frames: string[],
  mode: PlaybackMode,
  interpolationMode: InterpolationMode,
  strings: UiStrings["previewErrors"],
): Promise<PreviewSequenceFrame[]> {
  const steps = playbackSteps(frames.length, mode, interpolationMode);
  return Promise.all(
    steps.map(async (step) => ({
      src: step.blend > 0 && step.frameIndex !== step.nextFrameIndex
        ? await blendFrames(frames[step.frameIndex], frames[step.nextFrameIndex], step.blend, strings)
        : frames[step.frameIndex],
      sourceIndex: step.frameIndex,
      intermediate: step.blend > 0,
    })),
  );
}
