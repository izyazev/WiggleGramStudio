// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PhotoFrame } from "../model";
import { getUiStrings } from "../i18n";
import { ImportStrip } from "./ImportStrip";
import { Controls } from "./Controls";
import { PointEditor } from "./PointEditor";
import { PreviewPanel } from "./PreviewPanel";

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = [];
const strings = getUiStrings("ru");

function frame(id: string): PhotoFrame {
  return {
    id,
    path: `/${id}.jpg`,
    name: `${id}.jpg`,
    width: 2324,
    height: 3196,
    previewUrl: "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    previewWidth: 1,
    previewHeight: 1,
    fileSizeBytes: 4_300_000,
    point: { x: 100, y: 100 },
  };
}

function mount(element: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => root.render(element));
  return { root, container };
}

beforeAll(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { value: vi.fn(), configurable: true });
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: class { observe() {} disconnect() {} },
    configurable: true,
  });
});

afterEach(() => {
  for (const item of mounted.splice(0)) {
    act(() => item.root.unmount());
    item.container.remove();
  }
  vi.restoreAllMocks();
});

describe("frame strip", () => {
  it("reorders by dragging anywhere on a thumbnail", () => {
    const onReorder = vi.fn();
    const { container } = mount(
      <ImportStrip
        frames={[frame("one"), frame("two"), frame("three")]}
        selectedId="one"
        strings={strings.importStrip}
        onChoose={vi.fn()}
        onSelect={vi.fn()}
        onReorder={onReorder}
        onRemove={vi.fn()}
      />,
    );
    const cards = container.querySelectorAll<HTMLElement>("[data-frame-index]");
    Object.defineProperty(document, "elementFromPoint", { value: () => cards[1], configurable: true });
    act(() => {
      cards[0].dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
      cards[0].dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 120, clientY: 10 }));
    });
    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });
});

describe("point editor", () => {
  it("keeps zoom when the selected frame changes", () => {
    const first = frame("one");
    const second = frame("two");
    const { root, container } = mount(<PointEditor frame={first} index={0} strings={strings.pointEditor} onPoint={vi.fn()} />);
    const buttons = container.querySelectorAll<HTMLButtonElement>(".zoom-controls button");
    act(() => buttons[1].click());
    expect(container.querySelector(".zoom-controls span")?.textContent).toBe("150%");
    act(() => root.render(<PointEditor frame={second} index={1} strings={strings.pointEditor} onPoint={vi.fn()} />));
    expect(container.querySelector(".zoom-controls span")?.textContent).toBe("150%");
  });
});

describe("export controls", () => {
  it("keeps the duration field empty instead of forcing the minimum", () => {
    const onDurationText = vi.fn();
    const onExportFormat = vi.fn();
    const { container } = mount(
      <Controls
        mode="ping-pong"
        interpolationMode="off"
        speedMs={180}
        durationText="4"
        exportDirectory=""
        exportFormat="mp4"
        imageFormat="png"
        strings={strings.controls}
        scale={1}
        estimateText="≈ 12.0 МБ"
        exportHint="Нужны 2–4 кадра, точки и корректная область."
        canExport
        exporting={false}
        progress={0}
        onMode={vi.fn()}
        onInterpolationMode={vi.fn()}
        onSpeed={vi.fn()}
        onDurationText={onDurationText}
        onExportFormat={onExportFormat}
        onImageFormat={vi.fn()}
        onScale={vi.fn()}
        onChooseExportDirectory={vi.fn()}
        onExport={vi.fn()}
        onExportAs={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = container.querySelector<HTMLInputElement>("#duration")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onDurationText).toHaveBeenCalledWith("");
    const formatButtons = container.querySelectorAll<HTMLButtonElement>(".export-format button");
    act(() => formatButtons[1].click());
    expect(onExportFormat).toHaveBeenCalledWith("gif");
  });

  it("describes gif export as a single looping cycle", () => {
    const { container } = mount(
      <Controls
        mode="ping-pong"
        interpolationMode="off"
        speedMs={110}
        durationText="10"
        exportDirectory=""
        exportFormat="gif"
        imageFormat="png"
        strings={strings.controls}
        scale={1}
        estimateText="≈ 32.0 МБ"
        gifLoopSeconds={0.66}
        exportHint="Нужны 2–4 кадра, точки и корректная область."
        canExport
        exporting={false}
        progress={0}
        onMode={vi.fn()}
        onInterpolationMode={vi.fn()}
        onSpeed={vi.fn()}
        onDurationText={vi.fn()}
        onExportFormat={vi.fn()}
        onImageFormat={vi.fn()}
        onScale={vi.fn()}
        onChooseExportDirectory={vi.fn()}
        onExport={vi.fn()}
        onExportAs={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelector("#duration")).toBeNull();
    expect(container.textContent).toContain("Экспортируется одним циклом");
    expect(container.textContent).toContain("зацикливается автоматически");
  });

  it("shows picture export options and hides the duration field", () => {
    const onImageFormat = vi.fn();
    const { container } = mount(
      <Controls
        mode="ping-pong"
        interpolationMode="off"
        speedMs={110}
        durationText="10"
        exportDirectory=""
        exportFormat="pic"
        imageFormat="png"
        strings={strings.controls}
        scale={1}
        estimateText="4 PNG"
        exportHint="Нужны 2–4 кадра, точки и корректная область."
        canExport
        exporting={false}
        progress={0}
        onMode={vi.fn()}
        onInterpolationMode={vi.fn()}
        onSpeed={vi.fn()}
        onDurationText={vi.fn()}
        onExportFormat={vi.fn()}
        onImageFormat={onImageFormat}
        onScale={vi.fn()}
        onChooseExportDirectory={vi.fn()}
        onExport={vi.fn()}
        onExportAs={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelector("#duration")).toBeNull();
    expect(container.textContent).toContain("совмещённые и обрезанные кадры");
    const imageButtons = container.querySelectorAll<HTMLButtonElement>(".image-format button");
    act(() => imageButtons[2].click());
    expect(onImageFormat).toHaveBeenCalledWith("tiff");
  });
});

describe("live preview", () => {
  it("zooms the cached animation frame without rebuilding it", () => {
    const { container } = mount(
      <PreviewPanel
        frames={[{ src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", sourceIndex: 0, intermediate: false }]}
        frameCount={1}
        mode="ping-pong"
        frameDurationMs={180}
        ready
        strings={strings.previewPanel}
      />,
    );
    const zoomButtons = container.querySelectorAll<HTMLButtonElement>(".preview-zoom-controls button");
    const inner = container.querySelector<HTMLElement>(".preview-zoom-inner")!;
    expect(inner.style.width).toBe("100%");
    act(() => zoomButtons[1].click());
    expect(inner.style.width).toBe("125%");
    expect(container.querySelector(".preview-zoom-controls span")?.textContent).toBe("125%");
  });

  it("switches interpolation mode to smooth", () => {
    const onInterpolationMode = vi.fn();
    const { container } = mount(
      <Controls
        mode="ping-pong"
        interpolationMode="off"
        speedMs={110}
        durationText="10"
        exportDirectory=""
        exportFormat="mp4"
        imageFormat="png"
        strings={strings.controls}
        scale={1}
        estimateText="≈ 12.0 МБ"
        exportHint="Нужны 2–4 кадра, точки и корректная область."
        canExport
        exporting={false}
        progress={0}
        onMode={vi.fn()}
        onInterpolationMode={onInterpolationMode}
        onSpeed={vi.fn()}
        onDurationText={vi.fn()}
        onExportFormat={vi.fn()}
        onImageFormat={vi.fn()}
        onScale={vi.fn()}
        onChooseExportDirectory={vi.fn()}
        onExport={vi.fn()}
        onExportAs={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const buttons = container.querySelectorAll<HTMLButtonElement>(".interpolation-mode button");
    act(() => {
      buttons[1].click();
    });
    expect(onInterpolationMode).toHaveBeenCalledWith("smooth");
  });
});
