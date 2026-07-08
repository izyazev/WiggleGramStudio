import { invoke } from "@tauri-apps/api/core";
import type { CropRect, ExportFormat, ExportImageFormat, InterpolationMode, LoadedImage, PlaybackMode } from "./model";
import type { AppLanguage } from "./i18n";

export function loadImages(paths: string[]): Promise<LoadedImage[]> {
  return invoke("load_images", { paths });
}

export interface ExportRequest {
  frames: Array<{
    path: string;
    width: number;
    height: number;
    fileSizeBytes: number;
    point: { x: number; y: number };
  }>;
  crop: CropRect;
  speedMs: number;
  mode: PlaybackMode;
  interpolationMode: InterpolationMode;
  durationSeconds: number;
  scale: number;
  format: ExportFormat;
  imageFormat: ExportImageFormat;
  outputPath: string;
}

export interface PreviewRequest {
  frames: Array<{
    path: string;
    width: number;
    height: number;
    point: { x: number; y: number };
  }>;
  crop: CropRect;
  speedMs: number;
  mode: PlaybackMode;
  maxSize?: number;
}

export function exportVideo(request: ExportRequest): Promise<void> {
  return invoke("export_video", { request });
}

export function cancelExport(): Promise<void> {
  return invoke("cancel_export");
}

export function openExportedFile(): Promise<void> {
  return invoke("open_exported_file");
}

export function revealExportedFile(): Promise<void> {
  return invoke("reveal_exported_file");
}

export function openGithubRepository(): Promise<void> {
  return invoke("open_github_repository");
}

export function nextExportPath(directory: string, format: ExportFormat): Promise<string> {
  return invoke("next_export_path", { directory, format });
}

export function setBackendLanguage(language: AppLanguage): Promise<void> {
  return invoke("set_language", { language });
}

export function prepareSmoothPreview(request: PreviewRequest): Promise<string[]> {
  return invoke("prepare_smooth_preview", { request });
}
