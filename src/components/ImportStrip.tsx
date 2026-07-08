import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { PhotoFrame } from "../model";
import type { UiStrings } from "../i18n";

interface Props {
  frames: PhotoFrame[];
  selectedId?: string;
  strings: UiStrings["importStrip"];
  onChoose: () => void;
  onSelect: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}

export function ImportStrip({ frames, selectedId, strings, onChoose, onSelect, onReorder, onRemove }: Props) {
  const [dragging, setDragging] = useState<number>();
  const dragState = useRef<{ index: number; startX: number; startY: number; moved: boolean } | undefined>(undefined);

  const beginPointerReorder = (event: PointerEvent<HTMLElement>, index: number) => {
    if ((event.target as HTMLElement).closest(".remove-frame")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = { index, startX: event.clientX, startY: event.clientY, moved: false };
  };

  const movePointerReorder = (event: PointerEvent<HTMLElement>) => {
    const state = dragState.current;
    if (!state) return;
    if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 6) return;
    state.moved = true;
    setDragging(state.index);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-frame-index]");
    const targetIndex = Number(target?.dataset.frameIndex);
    if (!Number.isInteger(targetIndex) || targetIndex === state.index) return;
    onReorder(state.index, targetIndex);
    state.index = targetIndex;
    setDragging(targetIndex);
  };

  const endPointerReorder = (frameId: string) => {
    const state = dragState.current;
    if (state && !state.moved) onSelect(frameId);
    dragState.current = undefined;
    setDragging(undefined);
  };

  const cancelPointerReorder = () => {
    dragState.current = undefined;
    setDragging(undefined);
  };

  return (
    <section className="import-strip" aria-label={strings.ariaLabel}>
      <div className="section-heading compact-heading">
        <div>
          <span className="eyebrow">{strings.title}</span>
          <strong>{frames.length}/4</strong>
        </div>
        <button className="ghost-button" onClick={onChoose} disabled={frames.length >= 4}>
          {strings.add}
        </button>
      </div>

      <div className="thumbnail-row">
        {frames.map((frame, index) => (
          <article
            key={frame.id}
            data-frame-index={index}
            className={`thumbnail ${selectedId === frame.id ? "selected" : ""} ${dragging === index ? "dragging" : ""}`}
            role="button"
            tabIndex={0}
            onPointerDown={(event) => beginPointerReorder(event, index)}
            onPointerMove={movePointerReorder}
            onPointerUp={() => endPointerReorder(frame.id)}
            onPointerCancel={cancelPointerReorder}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(frame.id); }}
          >
            <img src={frame.previewUrl} alt={strings.frameAlt(index)} draggable={false} />
            <span className="frame-number">{index + 1}</span>
            <span
              className="drag-handle"
              aria-hidden="true"
              title={strings.dragToReorder}
            >
              ⠿
            </span>
            <span className={`point-state ${frame.point ? "done" : ""}`}>
              {frame.point ? strings.pointSelected : strings.pointRequired}
            </span>
            <button
              className="remove-frame"
              aria-label={strings.removeFrame(frame.name)}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(frame.id);
              }}
            >
              ×
            </button>
          </article>
        ))}
        {frames.length === 0 && (
          <button className="empty-import" onClick={onChoose}>
            <span className="import-icon">↥</span>
            <strong>{strings.emptyTitle}</strong>
            <span>{strings.emptySubtitle}</span>
          </button>
        )}
      </div>
      {frames.length > 1 && <p className="reorder-hint"><span>⠿</span> {strings.reorderHint}</p>}
    </section>
  );
}
