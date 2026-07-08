import { useEffect, useMemo, useState } from "react";
import type { PlaybackMode } from "../model";
import type { UiStrings } from "../i18n";
import type { PreviewSequenceFrame } from "../preview";

interface Props {
  frames: PreviewSequenceFrame[];
  frameCount: number;
  mode: PlaybackMode;
  frameDurationMs: number;
  ready: boolean;
  strings: UiStrings["previewPanel"];
}

export function PreviewPanel({ frames, frameCount, mode, frameDurationMs, ready, strings }: Props) {
  const [cursor, setCursor] = useState(0);
  const [zoom, setZoom] = useState(1);
  const activeIndex = useMemo(() => frames[cursor]?.sourceIndex ?? 0, [cursor, frames]);

  useEffect(() => setCursor(0), [frames, mode]);
  useEffect(() => {
    if (frames.length < 2) return;
    const timer = window.setInterval(() => setCursor((value) => (value + 1) % frames.length), frameDurationMs);
    return () => window.clearInterval(timer);
  }, [frameDurationMs, frames.length]);

  const source = frames[cursor]?.src;
  return (
    <section className="preview-panel panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{strings.title}</span>
          <h2>{mode === "ping-pong" ? strings.pingPong : strings.loop}</h2>
        </div>
        <div className="preview-toolbar">
          <div className="zoom-controls preview-zoom-controls" aria-label={strings.zoomLabel}>
            <button onClick={() => setZoom((value) => Math.max(1, value - 0.25))} disabled={!source}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((value) => Math.min(4, value + 0.25))} disabled={!source}>+</button>
            <button className="reset-preview-zoom" aria-label={strings.resetZoom} title={strings.resetZoom} onClick={() => setZoom(1)} disabled={!source}>↺</button>
          </div>
          <span className={`live-pill ${ready ? "active" : ""}`}><i /> {strings.live}</span>
        </div>
      </div>
      <div className="preview-stage">
        {source ? (
          <div className="preview-zoom-inner" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
            <img src={source} alt={strings.imageAlt} />
          </div>
        ) : (
          <div className="preview-placeholder">
            <span>↔</span>
            <p>{ready ? strings.preparing : strings.needPoints}</p>
          </div>
        )}
      </div>
      {frameCount > 0 && (
        <div className="preview-dots">
          {Array.from({ length: frameCount }, (_, index) => <i key={index} className={activeIndex === index ? "active" : ""} />)}
        </div>
      )}
    </section>
  );
}
