import type { ExportFormat, ExportImageFormat, InterpolationMode, PlaybackMode } from "../model";
import type { UiStrings } from "../i18n";

interface Props {
  mode: PlaybackMode;
  interpolationMode: InterpolationMode;
  speedMs: number;
  durationText: string;
  exportDirectory: string;
  exportFormat: ExportFormat;
  imageFormat: ExportImageFormat;
  strings: UiStrings["controls"];
  scale: number;
  outputWidth?: number;
  outputHeight?: number;
  estimateText: string;
  estimatedSizeWarning?: boolean;
  gifLoopSeconds?: number;
  canExport: boolean;
  exporting: boolean;
  progress: number;
  status?: string;
  exportHint: string;
  exportHintError?: boolean;
  onMode: (mode: PlaybackMode) => void;
  onInterpolationMode: (mode: InterpolationMode) => void;
  onSpeed: (speed: number) => void;
  onDurationText: (duration: string) => void;
  onExportFormat: (format: ExportFormat) => void;
  onImageFormat: (format: ExportImageFormat) => void;
  onScale: (scale: number) => void;
  onChooseExportDirectory: () => void;
  onExport: () => void;
  onExportAs: () => void;
  onCancel: () => void;
}

function formatLoopSeconds(strings: UiStrings["controls"], seconds?: number): string {
  if (seconds === undefined) return strings.oneCycle;
  return strings.formatSeconds(seconds);
}

export function Controls(props: Props) {
  const sliderValue = 1050 - props.speedMs;
  const exportLabel = props.exportFormat === "pic" ? props.imageFormat.toUpperCase() : props.exportFormat.toUpperCase();
  const interpolationNote = props.interpolationMode === "smooth"
    ? props.strings.interpolationSmoothNote
    : props.strings.interpolationOffNote;

  return (
    <aside className="controls panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{props.strings.motion}</span>
          <h2>{props.strings.settings}</h2>
        </div>
      </div>

      <label className="control-label">{props.strings.mode}</label>
      <div className="segmented">
        <button className={props.mode === "ping-pong" ? "active" : ""} onClick={() => props.onMode("ping-pong")}>↔ Ping-pong</button>
        <button className={props.mode === "loop" ? "active" : ""} onClick={() => props.onMode("loop")}>↻ Loop</button>
      </div>

      <div className="control-title-row">
        <label className="control-label" htmlFor="speed">{props.strings.speed}</label>
        <div className="unit-input"><input value={props.speedMs} min={50} max={1000} step={10} type="number" onChange={(e) => props.onSpeed(Number(e.target.value))} /><span>{props.strings.milliseconds}</span></div>
      </div>
      <input id="speed" className="range" type="range" min={50} max={1000} step={10} value={sliderValue} onChange={(e) => props.onSpeed(1050 - Number(e.target.value))} />
      <div className="range-legend"><span>{props.strings.slower}</span><span>{props.strings.faster}</span></div>
      <div className="control-title-row motion-toggle-row">
        <label className="control-label">{props.strings.interpolationMode}</label>
      </div>
      <div className="segmented interpolation-mode" aria-label={props.strings.interpolationMode}>
        <button className={props.interpolationMode === "off" ? "active" : ""} onClick={() => props.onInterpolationMode("off")}>{props.strings.interpolationOff}</button>
        <button className={props.interpolationMode === "smooth" ? "active" : ""} onClick={() => props.onInterpolationMode("smooth")}>{props.strings.interpolationSmooth}</button>
      </div>
      <p className="toggle-note">{interpolationNote}</p>

      <hr />
      <span className="eyebrow">{props.strings.export}</span>
      <div className="segmented export-format" aria-label={props.strings.exportFormatLabel}>
        <button className={props.exportFormat === "mp4" ? "active" : ""} onClick={() => props.onExportFormat("mp4")}>MP4</button>
        <button className={props.exportFormat === "gif" ? "active" : ""} onClick={() => props.onExportFormat("gif")}>GIF</button>
        <button className={props.exportFormat === "pic" ? "active" : ""} onClick={() => props.onExportFormat("pic")}>PIC</button>
      </div>
      {props.exportFormat === "mp4" ? (
        <div className="control-title-row">
          <label className="control-label" htmlFor="duration">{props.strings.duration}</label>
          <div className="unit-input"><input id="duration" value={props.durationText} min={0.2} max={120} step={0.1} type="number" onChange={(e) => props.onDurationText(e.target.value)} /><span>{props.strings.seconds}</span></div>
        </div>
      ) : props.exportFormat === "gif" ? (
        <div className="export-cycle-note">
          <label className="control-label">{props.strings.gif}</label>
          <p>{props.strings.gifCycleNote(formatLoopSeconds(props.strings, props.gifLoopSeconds))}</p>
        </div>
      ) : (
        <>
          <div className="export-cycle-note">
            <label className="control-label">{props.strings.pic}</label>
            <p>{props.strings.picNote}</p>
          </div>
          <div className="segmented image-format" aria-label={props.strings.imageFormatLabel}>
            <button className={props.imageFormat === "png" ? "active" : ""} onClick={() => props.onImageFormat("png")}>PNG</button>
            <button className={props.imageFormat === "jpg" ? "active" : ""} onClick={() => props.onImageFormat("jpg")}>JPG</button>
            <button className={props.imageFormat === "tiff" ? "active" : ""} onClick={() => props.onImageFormat("tiff")}>TIFF</button>
          </div>
        </>
      )}

      <div className="control-title-row resolution-title">
        <label className="control-label" htmlFor="resolution">{props.strings.resolution}</label>
        <span className="resolution-percent">{Math.round(props.scale * 100)}%</span>
      </div>
      <input id="resolution" className="range resolution-range" type="range" min={25} max={100} step={5} value={Math.round(props.scale * 100)} onChange={(e) => props.onScale(Number(e.target.value) / 100)} />
      <div className="range-legend"><span>25%</span><span>100%</span></div>
      <div className="resolution-estimate">
        <strong>{props.outputWidth && props.outputHeight ? `${props.outputWidth} × ${props.outputHeight} px` : props.strings.chooseArea}</strong>
        <span className={props.estimatedSizeWarning ? "warning" : ""}>{props.estimateText}</span>
      </div>

      <div className="export-folder-label">
        <span className="control-label">{props.strings.exportFolder}</span>
        <button onClick={props.onChooseExportDirectory}>{props.exportDirectory ? props.strings.change : props.strings.choose}</button>
      </div>
      <div className={`export-folder ${props.exportDirectory ? "selected" : ""}`} title={props.exportDirectory || undefined}>
        {props.exportDirectory || props.strings.chooseAtExport}
      </div>

      {props.exporting && (
        <div className="progress-block">
          <div><span>{props.status ?? props.strings.exporting}</span><strong>{Math.round(props.progress)}%</strong></div>
          <progress value={props.progress} max={100} />
        </div>
      )}

      {props.exporting ? (
        <button className="export-button cancel" onClick={props.onCancel}>{props.strings.cancelExport}</button>
      ) : (
        <>
          <button className="export-button" disabled={!props.canExport} onClick={props.onExport}><span>{props.strings.exportButton(exportLabel)}</span><i>⌘S</i></button>
          <button className="export-as-button" disabled={!props.canExport} onClick={props.onExportAs}>{props.strings.saveAs}</button>
        </>
      )}
      {!props.canExport && !props.exporting && <p className={`export-hint ${props.exportHintError ? "error" : ""}`}>{props.exportHint}</p>}
    </aside>
  );
}
