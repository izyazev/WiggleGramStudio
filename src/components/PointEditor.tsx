import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { PhotoFrame, Point } from "../model";
import { compactFileName } from "../model";
import { fitInside } from "../geometry";
import type { UiStrings } from "../i18n";

interface Props {
  frame?: PhotoFrame;
  index: number;
  strings: UiStrings["pointEditor"];
  onPoint: (point: Point) => void;
}

export function PointEditor({ frame, index, strings, onPoint }: Props) {
  const [zoom, setZoom] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => setViewport({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const stageSize = useMemo(() => {
    if (!frame || !viewport.width || !viewport.height) return undefined;
    return fitInside(frame, viewport, 14, zoom);
  }, [frame, viewport, zoom]);

  const choosePoint = (event: MouseEvent<HTMLDivElement>) => {
    if (!frame) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * frame.width;
    const y = ((event.clientY - rect.top) / rect.height) * frame.height;
    onPoint({ x: Math.max(0, Math.min(frame.width, x)), y: Math.max(0, Math.min(frame.height, y)) });
  };

  return (
    <section className="editor-panel panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{strings.title}</span>
          <h2 title={frame?.name}>{frame ? strings.frameTitle(index, compactFileName(frame.name)) : strings.choosePhotos}</h2>
        </div>
        <div className="zoom-controls" aria-label={strings.zoomLabel}>
          <button onClick={() => setZoom((value) => Math.max(1, value - 0.5))} disabled={!frame}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((value) => Math.min(5, value + 0.5))} disabled={!frame}>+</button>
          <button className="reset-point-zoom" aria-label={strings.resetZoom} title={strings.resetZoom} onClick={() => setZoom(1)} disabled={!frame}>↺</button>
        </div>
      </div>

      <div className="point-canvas-scroll" ref={viewportRef}>
        {frame && stageSize ? (
          <div
            className="point-canvas-inner"
            style={{
              width: Math.max(viewport.width, stageSize.width + 28),
              height: Math.max(viewport.height, stageSize.height + 28),
            }}
          >
            <div className="point-stage" style={{ width: stageSize.width, height: stageSize.height }} onClick={choosePoint}>
              <img src={frame.previewUrl} alt={frame.name} draggable={false} />
              {frame.point && (
                <span
                  className="anchor-marker"
                  style={{ left: `${(frame.point.x / frame.width) * 100}%`, top: `${(frame.point.y / frame.height) * 100}%` }}
                >
                  <i />
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="editor-placeholder">
            <span>◎</span>
            <p>{strings.placeholder}</p>
          </div>
        )}
      </div>
      <p className="editor-tip">
        {frame?.point ? strings.tipPlaced : strings.tipEmpty}
      </p>
    </section>
  );
}
