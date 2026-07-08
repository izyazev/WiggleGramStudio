import type { InterpolationMode, PlaybackMode } from "./model";

export function playbackOrder(count: number, mode: PlaybackMode): number[] {
  if (count <= 0) return [];
  const forward = Array.from({ length: count }, (_, index) => index);
  if (mode === "loop" || count < 3) {
    return mode === "ping-pong" && count === 2 ? [0, 1] : forward;
  }
  return [...forward, ...forward.slice(1, -1).reverse()];
}

export interface PlaybackStep {
  frameIndex: number;
  nextFrameIndex: number;
  blend: number;
}

export function playbackSteps(
  count: number,
  mode: PlaybackMode,
  interpolationMode: InterpolationMode = "off",
): PlaybackStep[] {
  const order = playbackOrder(count, mode);
  if (!order.length) return [];
  if (interpolationMode === "off" || order.length < 2) {
    return order.map((frameIndex, index) => ({
      frameIndex,
      nextFrameIndex: order[(index + 1) % order.length] ?? frameIndex,
      blend: 0,
    }));
  }
  return order.flatMap((frameIndex, index) => {
    const nextFrameIndex = order[(index + 1) % order.length] ?? frameIndex;
    return [
      { frameIndex, nextFrameIndex, blend: 0 },
      { frameIndex, nextFrameIndex, blend: 0.5 },
    ];
  });
}

export interface TimedFrame {
  frameIndex: number;
  nextFrameIndex: number;
  blend: number;
  durationMs: number;
}

export function exportTimeline(
  count: number,
  mode: PlaybackMode,
  speedMs: number,
  durationSeconds: number,
  interpolationMode: InterpolationMode = "off",
): TimedFrame[] {
  const steps = playbackSteps(count, mode, interpolationMode);
  if (!steps.length || speedMs <= 0 || durationSeconds <= 0) return [];
  const totalMs = Math.round(durationSeconds * 1000);
  const stepDurationMs = interpolationMode !== "off" && count > 1 ? speedMs / 2 : speedMs;
  const result: TimedFrame[] = [];
  let elapsed = 0;
  let cursor = 0;
  while (elapsed < totalMs) {
    const step = steps[cursor % steps.length];
    const durationMs = Math.min(stepDurationMs, totalMs - elapsed);
    result.push({ ...step, durationMs });
    elapsed += durationMs;
    cursor += 1;
  }
  return result;
}
