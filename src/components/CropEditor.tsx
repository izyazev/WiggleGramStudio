import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { aspectRatioForPreset, cropToAspect, fitInside, normalizeCrop, transformCrop } from "../geometry";
import type { CropTransformAction } from "../geometry";
import type { CropAspectPreset, CropRect, PhotoFrame, Point } from "../model";
import type { UiStrings } from "../i18n";

interface Props {
  base?: PhotoFrame;
  bounds?: CropRect;
  crop?: CropRect;
  aspectPreset: CropAspectPreset;
  strings: UiStrings["cropEditor"];
  onCrop: (crop: CropRect) => void;
  onAspectPreset: (preset: CropAspectPreset) => void;
  onAuto: () => void;
}

const presets: CropAspectPreset[] = ["free", "4:3", "3:4", "16:9", "9:16"];

export function CropEditor({ base, bounds, crop, aspectPreset, strings, onCrop, onAspectPreset, onAuto }: Props) {
  const drag = useRef<{ start: Point; action: CropTransformAction | "new"; initial?: CropRect } | undefined>(undefined);
  const [draft, setDraft] = useState<CropRect>();
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
    if (!base || !viewport.width || !viewport.height) return undefined;
    return fitInside(base, viewport, 12);
  }, [base, viewport]);

  const pointFromEvent = (event: PointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * (base?.width ?? 1),
      y: ((event.clientY - rect.top) / rect.height) * (base?.height ?? 1),
    };
  };

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (!bounds) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-crop-action]");
    const action = (handle?.dataset.cropAction as CropTransformAction | undefined) ?? "new";
    drag.current = { start: pointFromEvent(event), action, initial: crop };
    setDraft(undefined);
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !bounds) return;
    const current = pointFromEvent(event);
    const ratio = aspectRatioForPreset(aspectPreset);
    const fresh = normalizeCrop(drag.current.start, current, bounds);
    setDraft(
      drag.current.action === "new" || !drag.current.initial
        ? (ratio ? cropToAspect(fresh, ratio) : fresh)
        : transformCrop(drag.current.initial, drag.current.action, drag.current.start, current, bounds, 8, ratio),
    );
  };

  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !bounds) return;
    const current = pointFromEvent(event);
    const ratio = aspectRatioForPreset(aspectPreset);
    const fresh = normalizeCrop(drag.current.start, current, bounds);
    const value = drag.current.action === "new" || !drag.current.initial
      ? (ratio ? cropToAspect(fresh, ratio) : fresh)
      : transformCrop(drag.current.initial, drag.current.action, drag.current.start, current, bounds, 8, ratio);
    drag.current = undefined;
    setDraft(undefined);
    if (value.width >= 8 && value.height >= 8) onCrop(value);
  };

  const shown = draft ?? crop;
  return (
    <section className="crop-panel panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{strings.title}</span>
          <h2>{strings.subtitle}</h2>
        </div>
        <button className="ghost-button" onClick={onAuto} disabled={!bounds}>{strings.auto}</button>
      </div>
      <div className="crop-presets" aria-label={strings.aspectLabel}>
        {presets.map((preset) => (
          <button
            key={preset}
            className={aspectPreset === preset ? "active" : ""}
            disabled={!bounds}
            onClick={() => {
              onAspectPreset(preset);
              const ratio = aspectRatioForPreset(preset);
            if (ratio && bounds) onCrop(cropToAspect(crop ?? bounds, ratio));
          }}
          >
            {preset === "free" ? strings.free : preset}
          </button>
        ))}
      </div>
      <div className="crop-stage-wrap" ref={viewportRef}>
        {base && bounds && stageSize ? (
          <div
            className="crop-stage"
            style={{ width: stageSize.width, height: stageSize.height }}
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
          >
            <img src={base.previewUrl} alt={strings.imageAlt} draggable={false} />
            <div
              className="common-bounds"
              style={{
                left: `${(bounds.x / base.width) * 100}%`,
                top: `${(bounds.y / base.height) * 100}%`,
                width: `${(bounds.width / base.width) * 100}%`,
                height: `${(bounds.height / base.height) * 100}%`,
              }}
            />
            {shown && (
              <div
                className="crop-rect"
                data-crop-action="move"
                style={{
                  left: `${(shown.x / base.width) * 100}%`,
                  top: `${(shown.y / base.height) * 100}%`,
                  width: `${(shown.width / base.width) * 100}%`,
                  height: `${(shown.height / base.height) * 100}%`,
                }}
              >
                <i className="handle nw" data-crop-action="nw" />
                <i className="handle n" data-crop-action="n" />
                <i className="handle ne" data-crop-action="ne" />
                <i className="handle e" data-crop-action="e" />
                <i className="handle se" data-crop-action="se" />
                <i className="handle s" data-crop-action="s" />
                <i className="handle sw" data-crop-action="sw" />
                <i className="handle w" data-crop-action="w" />
              </div>
            )}
          </div>
        ) : <div className="crop-placeholder">{strings.placeholder}</div>}
      </div>
      <div className="crop-meta">
        <span>{crop ? `${crop.width} × ${crop.height} px` : strings.notSelected}</span>
        <span>{strings.help}</span>
      </div>
    </section>
  );
}
