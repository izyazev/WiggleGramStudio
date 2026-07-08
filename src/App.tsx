import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open, save } from "@tauri-apps/plugin-dialog";
import { cancelExport, exportVideo, loadImages, nextExportPath, openExportedFile, openGithubRepository, prepareSmoothPreview, revealExportedFile, setBackendLanguage } from "./backend";
import { aspectRatioForPreset, commonBounds, cropToAspect, isCropInside } from "./geometry";
import type { PhotoFrame, Point, ProjectState } from "./model";
import { estimateGifSizeMb, estimateMp4SizeMb, gifLoopDurationSeconds, indexedExportName, initialProject, isValidDuration, maxGifSizeMb, moveItem, parseDurationInput, pictureSequenceLength, scaledOutputDimensions, sourceImageBitsPerPixel } from "./model";
import { buildPreviewSequence, preparePreviewFrames } from "./preview";
import { detectSystemLanguage, getUiStrings, isCancelledMessage } from "./i18n";
import type { AppLanguage } from "./i18n";
import { ImportStrip } from "./components/ImportStrip";
import { PointEditor } from "./components/PointEditor";
import { PreviewPanel } from "./components/PreviewPanel";
import { CropEditor } from "./components/CropEditor";
import { Controls } from "./components/Controls";
import logoUrl from "./assets/wigglegram-logo.png";

interface Notice {
  kind: "error" | "success" | "warning";
  text: string;
  exportActions?: boolean;
  openLabel?: string;
  revealLabel?: string;
}

interface ExportProgress {
  percent: number;
  message: string;
}

const imageExtensions = ["jpg", "jpeg", "png", "webp", "tif", "tiff"];
const runningInTauri = "__TAURI_INTERNALS__" in window;
const durationPreferenceKey = "wigglegram.preferred-duration";
const speedPreferenceKey = "wigglegram.preferred-speed";
const exportDirectoryKey = "wigglegram.export-directory";
const languagePreferenceKey = "wigglegram.language";
const designWidth = 1360;
const designHeight = 900;

function preferredDuration(): number {
  const stored = Number(localStorage.getItem(durationPreferenceKey));
  return Number.isFinite(stored) && stored >= 0.2 && stored <= 120 ? stored : 10;
}

function preferredExportDirectory(): string {
  return localStorage.getItem(exportDirectoryKey) ?? "";
}

function preferredLanguage(): AppLanguage {
  const stored = localStorage.getItem(languagePreferenceKey);
  return stored === "ru" || stored === "en" ? stored : detectSystemLanguage();
}

function preferredSpeed(): number {
  const stored = Number(localStorage.getItem(speedPreferenceKey));
  return Number.isFinite(stored) && stored >= 50 && stored <= 1000 ? stored : 110;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [language, setLanguage] = useState<AppLanguage>(() => preferredLanguage());
  const [project, setProject] = useState<ProjectState>(() => ({
    ...initialProject,
    speedMs: preferredSpeed(),
    export: { ...initialProject.export, durationSeconds: preferredDuration() },
  }));
  const [preparedFrames, setPreparedFrames] = useState<string[]>([]);
  const [previewFrames, setPreviewFrames] = useState<Array<{ src: string; sourceIndex: number; intermediate: boolean }>>([]);
  const [notice, setNotice] = useState<Notice>();
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress>(() => ({ percent: 0, message: getUiStrings(preferredLanguage()).app.preparingFrames }));
  const [durationText, setDurationText] = useState(() => String(preferredDuration()));
  const [exportDirectory, setExportDirectory] = useState(preferredExportDirectory);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const strings = useMemo(() => getUiStrings(language), [language]);

  useLayoutEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const selectedIndex = Math.max(0, project.frames.findIndex((frame) => frame.id === project.selectedId));
  const selectedFrame = project.frames[selectedIndex];
  const bounds = useMemo(() => commonBounds(project.frames), [project.frames]);
  const allPoints = project.frames.length >= 2 && project.frames.every((frame) => frame.point);
  const validCrop = Boolean(project.crop && bounds && isCropInside(project.crop, bounds));
  const validDuration = isValidDuration(durationText);
  const parsedDuration = parseDurationInput(durationText);
  const exportingGif = project.export.format === "gif";
  const exportingPictures = project.export.format === "pic";
  const durationError = !durationText.trim()
    ? strings.app.durationRequired
    : parsedDuration === undefined
      ? strings.app.durationNumber
      : parsedDuration < 0.2
        ? strings.app.durationMin
        : parsedDuration > 120
          ? strings.app.durationMax
          : undefined;
  const sourceBits = useMemo(() => sourceImageBitsPerPixel(project.frames), [project.frames]);
  const interfaceScale = Math.min(1, viewport.width / designWidth, viewport.height / designHeight);
  const shellStyle = {
    width: designWidth,
    height: designHeight,
    left: (viewport.width - designWidth * interfaceScale) / 2,
    top: (viewport.height - designHeight * interfaceScale) / 2,
    transform: `scale(${interfaceScale})`,
  };
  const outputDimensions = project.crop ? scaledOutputDimensions(project.crop, project.export.scale) : undefined;
  const estimatedSizeMb = outputDimensions
    ? exportingGif
      ? estimateGifSizeMb(
        outputDimensions.width,
        outputDimensions.height,
        project.frames.length,
        project.mode,
        sourceBits,
        project.interpolationMode,
      )
      : parsedDuration
        ? estimateMp4SizeMb(
          outputDimensions.width,
          outputDimensions.height,
          parsedDuration,
          project.speedMs,
          sourceBits,
          project.interpolationMode,
        )
        : undefined
    : undefined;
  const gifTooLarge = exportingGif && estimatedSizeMb !== undefined && estimatedSizeMb > maxGifSizeMb;
  const gifLoopSeconds = gifLoopDurationSeconds(project.frames.length, project.mode, project.speedMs);
  const previewFrameDurationMs = project.interpolationMode !== "off" && preparedFrames.length > 1 ? project.speedMs / 2 : project.speedMs;
  const canExport = allPoints && validCrop && !exporting && (exportingGif ? !gifTooLarge : exportingPictures ? true : validDuration);
  const exportHint = exportingGif
    ? gifTooLarge
      ? strings.app.gifTooLarge(estimatedSizeMb)
      : strings.app.exportRequirements
    : exportingPictures
      ? strings.app.exportRequirements
      : durationError ?? strings.app.exportRequirements;
  const exportHintError = exportingGif ? gifTooLarge : exportingPictures ? false : Boolean(durationError);
  const pictureFrameCount = pictureSequenceLength(project.frames.length, project.interpolationMode);
  const estimateText = exportingPictures
    ? pictureFrameCount
      ? strings.app.pictureSetEstimate(pictureFrameCount, project.export.imageFormat)
      : strings.app.pictureSetLabel
    : estimatedSizeMb !== undefined
      ? strings.app.sizeEstimate(estimatedSizeMb)
      : strings.app.sizePending;

  useEffect(() => {
    if (runningInTauri) void setBackendLanguage(language).catch(() => undefined);
  }, [language]);

  useEffect(() => {
    if (!exporting) setProgress((current) => ({ ...current, message: strings.app.preparingFrames }));
  }, [language, exporting, strings.app.preparingFrames]);

  const addPaths = useCallback(async (paths: string[]) => {
    const unique = paths.filter((path) => !project.frames.some((frame) => frame.path === path));
    if (!unique.length) return;
    if (project.frames.length + unique.length > 4) {
      setNotice({ kind: "error", text: strings.app.tooManyPhotos });
      return;
    }
    try {
      const loaded = await loadImages(unique);
      const frames: PhotoFrame[] = loaded.map((frame) => ({ ...frame, id: crypto.randomUUID() }));
      setProject((current) => ({
        ...current,
        frames: [...current.frames, ...frames],
        selectedId: current.selectedId ?? frames[0]?.id,
      }));
      const dimensions = new Set([...project.frames, ...frames].map((frame) => `${frame.width}×${frame.height}`));
      if (dimensions.size > 1) {
        setNotice({ kind: "warning", text: strings.app.differentSizesWarning });
      } else {
        setNotice(undefined);
      }
    } catch (error) {
      setNotice({ kind: "error", text: asMessage(error) });
    }
  }, [project.frames, strings.app.differentSizesWarning, strings.app.tooManyPhotos]);

  const chooseImages = useCallback(async () => {
    const result = await open({ multiple: true, directory: false, filters: [{ name: strings.app.imageFilterName, extensions: imageExtensions }] });
    if (result) await addPaths(Array.isArray(result) ? result : [result]);
  }, [addPaths, strings.app.imageFilterName]);

  useEffect(() => {
    if (!runningInTauri) return;
    let disposed = false;
    let stop: undefined | (() => void);
    getCurrentWebviewWindow().onDragDropEvent((event) => {
      if (event.payload.type === "drop") void addPaths(event.payload.paths);
    }).then((unlisten) => {
      if (disposed) unlisten(); else stop = unlisten;
    }).catch(() => undefined);
    return () => { disposed = true; stop?.(); };
  }, [addPaths]);

  useEffect(() => {
    if (!bounds) return;
    if (!project.crop || !isCropInside(project.crop, bounds)) {
      const ratio = aspectRatioForPreset(project.cropAspect);
      setProject((current) => ({ ...current, crop: ratio ? cropToAspect(bounds, ratio) : bounds }));
    }
  }, [bounds, project.crop, project.cropAspect]);

  useEffect(() => {
    if (!project.crop || !allPoints) {
      setPreparedFrames([]);
      setPreviewFrames([]);
      return;
    }
    let cancelled = false;
    preparePreviewFrames(project.frames, project.crop, strings.previewErrors)
      .then((frames) => { if (!cancelled) setPreparedFrames(frames); })
      .catch((error) => { if (!cancelled) setNotice({ kind: "error", text: asMessage(error) }); });
    return () => { cancelled = true; };
  }, [project.frames, project.crop, allPoints, strings.previewErrors]);

  useEffect(() => {
    if (!preparedFrames.length) {
      setPreviewFrames([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const task = project.interpolationMode === "smooth" && runningInTauri
        ? prepareSmoothPreview({
          frames: project.frames.map((frame) => ({
            path: frame.path,
            width: frame.width,
            height: frame.height,
            point: frame.point!,
          })),
          crop: project.crop!,
          speedMs: project.speedMs,
          mode: project.mode,
          maxSize: 960,
        }).then((frames) => {
          const fallback = buildPreviewSequence(preparedFrames, project.mode, "blend", strings.previewErrors);
          return Promise.resolve(fallback).then((localFrames) => frames.map((src, index) => ({
            src,
            sourceIndex: localFrames[index]?.sourceIndex ?? localFrames[localFrames.length - 1]?.sourceIndex ?? 0,
            intermediate: localFrames[index]?.intermediate ?? false,
          })));
        })
        : buildPreviewSequence(preparedFrames, project.mode, project.interpolationMode, strings.previewErrors);
      task
        .then((frames) => { if (!cancelled) setPreviewFrames(frames); })
        .catch((error) => { if (!cancelled) setNotice({ kind: "error", text: asMessage(error) }); });
    }, project.interpolationMode === "smooth" ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [preparedFrames, project.crop, project.frames, project.mode, project.interpolationMode, project.speedMs, strings.previewErrors]);

  useEffect(() => {
    if (!runningInTauri) return;
    const unlisten = listen<ExportProgress>("export-progress", ({ payload }) => setProgress(payload));
    return () => { void unlisten.then((stop) => stop()); };
  }, []);

  const setPoint = (point: Point) => {
    if (!selectedFrame) return;
    setProject((current) => ({
      ...current,
      frames: current.frames.map((frame) => frame.id === selectedFrame.id ? { ...frame, point } : frame),
    }));
  };

  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setProject((current) => {
      const frames = moveItem(current.frames, from, to);
      return { ...current, frames, crop: undefined };
    });
  };

  const removeFrame = (id: string) => setProject((current) => {
    const frames = current.frames.filter((frame) => frame.id !== id);
    return { ...current, frames, selectedId: current.selectedId === id ? frames[0]?.id : current.selectedId, crop: undefined };
  });

  const chooseExportDirectory = useCallback(async (): Promise<string | undefined> => {
    const selected = await open({
      multiple: false,
      directory: true,
      defaultPath: exportDirectory || undefined,
      title: strings.app.chooseAutoExportFolder,
    });
    if (!selected || Array.isArray(selected)) return undefined;
    setExportDirectory(selected);
    localStorage.setItem(exportDirectoryKey, selected);
    return selected;
  }, [exportDirectory, strings.app.chooseAutoExportFolder]);

  const startExport = useCallback(async (saveAs = false) => {
    if (!canExport || !project.crop) return;
    let outputPath: string;
    try {
      if (saveAs) {
        const format = project.export.format;
        if (format === "pic") {
          const selectedDirectory = await open({
            multiple: false,
            directory: true,
            defaultPath: exportDirectory || undefined,
            title: strings.app.choosePictureSetFolder,
          });
          if (!selectedDirectory || Array.isArray(selectedDirectory)) return;
          setExportDirectory(selectedDirectory);
          localStorage.setItem(exportDirectoryKey, selectedDirectory);
          outputPath = await nextExportPath(selectedDirectory, format);
        } else {
          let defaultPath = indexedExportName(1, format);
          if (exportDirectory) defaultPath = await nextExportPath(exportDirectory, format);
          const selectedPath = await save({ defaultPath, filters: [{ name: format === "gif" ? strings.app.gifFilterName : strings.app.mp4FilterName, extensions: [format] }] });
          if (!selectedPath) return;
          outputPath = selectedPath.toLowerCase().endsWith(`.${format}`) ? selectedPath : `${selectedPath}.${format}`;
          const separator = Math.max(outputPath.lastIndexOf("/"), outputPath.lastIndexOf("\\"));
          if (separator >= 0) {
            const directory = outputPath.slice(0, separator);
            setExportDirectory(directory);
            localStorage.setItem(exportDirectoryKey, directory);
          }
        }
      } else {
        const directory = exportDirectory || await chooseExportDirectory();
        if (!directory) return;
        outputPath = await nextExportPath(directory, project.export.format);
      }
    } catch (error) {
      setNotice({ kind: "error", text: asMessage(error) });
      return;
    }
    setExporting(true);
    setProgress({ percent: 1, message: strings.app.preparingFrames });
    try {
      await exportVideo({
        frames: project.frames.map((frame) => ({
          path: frame.path,
          width: frame.width,
          height: frame.height,
          fileSizeBytes: frame.fileSizeBytes,
          point: frame.point!,
        })),
        crop: project.crop,
        speedMs: project.speedMs,
        mode: project.mode,
        interpolationMode: project.interpolationMode,
        durationSeconds: parsedDuration ?? project.export.durationSeconds,
        scale: project.export.scale,
        format: project.export.format,
        imageFormat: project.export.imageFormat,
        outputPath,
      });
      setNotice({
        kind: "success",
        text: strings.app.exportReady(outputPath),
        exportActions: true,
        openLabel: project.export.format === "pic" ? strings.app.openFolder : strings.app.openFile,
        revealLabel: strings.app.revealInFolder,
      });
    } catch (error) {
      const message = asMessage(error);
      setNotice({ kind: isCancelledMessage(message) ? "warning" : "error", text: message });
    } finally {
      setExporting(false);
    }
  }, [canExport, chooseExportDirectory, exportDirectory, parsedDuration, project, strings.app]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void startExport(false);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [startExport]);

  return (
    <div className="app-viewport">
    <main className={`app-shell ${notice ? "has-notice" : ""}`} style={shellStyle}>
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand"><img className="brand-mark" src={logoUrl} alt="" /><div><strong>WiggleGram</strong><small>STUDIO</small></div></div>
          <div className="language-switch" aria-label={strings.app.changeLanguage}>
            <button className={language === "ru" ? "active" : ""} onClick={() => { setLanguage("ru"); localStorage.setItem(languagePreferenceKey, "ru"); }}>RU</button>
            <button className={language === "en" ? "active" : ""} onClick={() => { setLanguage("en"); localStorage.setItem(languagePreferenceKey, "en"); }}>EN</button>
          </div>
        </div>
        <div className="project-actions">
          <button className="new-button" onClick={() => {
            const durationSeconds = preferredDuration();
            setProject({ ...initialProject, speedMs: preferredSpeed(), export: { ...initialProject.export, durationSeconds } });
            setDurationText(String(durationSeconds));
            setPreparedFrames([]);
            setPreviewFrames([]);
            setNotice(undefined);
          }}>{strings.app.newProject}</button>
        </div>
      </header>

      {notice && <div className={`notice ${notice.kind}`}>
        <span>{notice.kind === "error" ? "!" : notice.kind === "success" ? "✓" : "i"}</span>
        <p>{notice.text}</p>
        {notice.exportActions && <div className="notice-actions">
          <button onClick={() => void openExportedFile().catch((error) => setNotice({ kind: "error", text: asMessage(error) }))}>{notice.openLabel ?? strings.app.openFile}</button>
          <button onClick={() => void revealExportedFile().catch((error) => setNotice({ kind: "error", text: asMessage(error) }))}>{notice.revealLabel ?? strings.app.revealInFolder}</button>
        </div>}
        <button className="notice-close" aria-label={strings.app.closeNotice} onClick={() => setNotice(undefined)}>×</button>
      </div>}

      <ImportStrip
        frames={project.frames}
        selectedId={project.selectedId}
        strings={strings.importStrip}
        onChoose={chooseImages}
        onSelect={(selectedId) => setProject((current) => ({ ...current, selectedId }))}
        onReorder={reorder}
        onRemove={removeFrame}
      />

      <div className="workspace-grid">
        <PointEditor frame={selectedFrame} index={selectedIndex} strings={strings.pointEditor} onPoint={setPoint} />
        <CropEditor
          base={project.frames[0]}
          bounds={bounds}
          crop={project.crop}
          aspectPreset={project.cropAspect}
          strings={strings.cropEditor}
          onCrop={(crop) => setProject((current) => ({ ...current, crop }))}
          onAspectPreset={(cropAspect) => setProject((current) => ({ ...current, cropAspect }))}
          onAuto={() => bounds && setProject((current) => ({ ...current, crop: bounds, cropAspect: "free" }))}
        />
        <PreviewPanel
          frames={previewFrames}
          frameCount={preparedFrames.length}
          mode={project.mode}
          frameDurationMs={previewFrameDurationMs}
          ready={allPoints}
          strings={strings.previewPanel}
        />
        <Controls
          mode={project.mode}
          interpolationMode={project.interpolationMode}
          speedMs={project.speedMs}
          durationText={durationText}
          exportDirectory={exportDirectory}
          exportFormat={project.export.format}
          imageFormat={project.export.imageFormat}
          strings={strings.controls}
          outputWidth={outputDimensions?.width}
          outputHeight={outputDimensions?.height}
          estimateText={estimateText}
          estimatedSizeWarning={gifTooLarge}
          gifLoopSeconds={gifLoopSeconds}
          scale={project.export.scale}
          canExport={canExport}
          exporting={exporting}
          progress={progress.percent}
          status={progress.message}
          exportHint={exportHint}
          exportHintError={exportHintError}
          onMode={(mode) => setProject((current) => ({ ...current, mode }))}
          onInterpolationMode={(interpolationMode) => setProject((current) => ({ ...current, interpolationMode }))}
          onSpeed={(speedMs) => {
            const normalized = Math.max(50, Math.min(1000, speedMs || 50));
            setProject((current) => ({ ...current, speedMs: normalized }));
            localStorage.setItem(speedPreferenceKey, String(normalized));
          }}
          onDurationText={(value) => {
            setDurationText(value);
            const durationSeconds = parseDurationInput(value);
            if (durationSeconds !== undefined) {
              setProject((current) => ({ ...current, export: { ...current.export, durationSeconds } }));
              if (durationSeconds >= 0.2 && durationSeconds <= 120) localStorage.setItem(durationPreferenceKey, String(durationSeconds));
            }
          }}
          onExportFormat={(format) => setProject((current) => ({ ...current, export: { ...current.export, format } }))}
          onImageFormat={(imageFormat) => setProject((current) => ({ ...current, export: { ...current.export, imageFormat } }))}
          onScale={(scale) => setProject((current) => ({ ...current, export: { ...current.export, scale: Math.max(0.25, Math.min(1, scale)) } }))}
          onChooseExportDirectory={() => void chooseExportDirectory()}
          onExport={() => void startExport(false)}
          onExportAs={() => void startExport(true)}
          onCancel={() => void cancelExport()}
        />
      </div>

      <footer><a
        href="https://github.com/izyazev/WiggleGramStudio"
        target="_blank"
        rel="noreferrer"
        title={strings.app.githubRepoTitle}
        onClick={(event) => {
          if (!runningInTauri) return;
          event.preventDefault();
          void openGithubRepository().catch((error) => setNotice({ kind: "error", text: asMessage(error) }));
        }}
      >izyazev/WiggleGramStudio ↗</a></footer>
    </main>
    </div>
  );
}
