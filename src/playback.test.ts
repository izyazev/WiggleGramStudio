import { describe, expect, it } from "vitest";
import { exportTimeline, playbackOrder, playbackSteps } from "./playback";

describe("playback sequence", () => {
  it("builds a ping-pong order without duplicated endpoints", () => {
    expect(playbackOrder(4, "ping-pong")).toEqual([0, 1, 2, 3, 2, 1]);
    expect(playbackOrder(3, "ping-pong")).toEqual([0, 1, 2, 1]);
    expect(playbackOrder(2, "ping-pong")).toEqual([0, 1]);
  });

  it("builds a forward loop", () => {
    expect(playbackOrder(4, "loop")).toEqual([0, 1, 2, 3]);
  });

  it("adds blended transition steps when intermediate frames are enabled", () => {
    expect(playbackSteps(3, "ping-pong", "blend")).toEqual([
      { frameIndex: 0, nextFrameIndex: 1, blend: 0 },
      { frameIndex: 0, nextFrameIndex: 1, blend: 0.5 },
      { frameIndex: 1, nextFrameIndex: 2, blend: 0 },
      { frameIndex: 1, nextFrameIndex: 2, blend: 0.5 },
      { frameIndex: 2, nextFrameIndex: 1, blend: 0 },
      { frameIndex: 2, nextFrameIndex: 1, blend: 0.5 },
      { frameIndex: 1, nextFrameIndex: 0, blend: 0 },
      { frameIndex: 1, nextFrameIndex: 0, blend: 0.5 },
    ]);
  });

  it("trims the last frame to the exact requested duration", () => {
    const timeline = exportTimeline(4, "ping-pong", 180, 1);
    expect(timeline.map(({ frameIndex }) => frameIndex)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(timeline.map(({ durationMs }) => durationMs)).toEqual([180, 180, 180, 180, 180, 100]);
    expect(timeline.reduce((sum, frame) => sum + frame.durationMs, 0)).toBe(1000);
  });

  it("keeps the total duration while splitting each step in half for intermediate frames", () => {
    const timeline = exportTimeline(2, "loop", 100, 0.45, "blend");
    expect(timeline.map(({ frameIndex, blend }) => `${frameIndex}:${blend}`)).toEqual([
      "0:0",
      "0:0.5",
      "1:0",
      "1:0.5",
      "0:0",
      "0:0.5",
      "1:0",
      "1:0.5",
      "0:0",
    ]);
    expect(timeline.map(({ durationMs }) => durationMs)).toEqual([50, 50, 50, 50, 50, 50, 50, 50, 50]);
    expect(timeline.reduce((sum, frame) => sum + frame.durationMs, 0)).toBe(450);
  });
});
