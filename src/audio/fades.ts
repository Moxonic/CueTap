/**
 * Fade shaping.
 *
 * Everything here is built from chained linearRampToValueAtTime calls rather than
 * setValueCurveAtTime. Curves are the "obvious" API but they throw InvalidStateError
 * whenever a new automation overlaps a running curve — which is exactly what happens
 * when you stop a cue mid-fade — and Safari is the strictest about it. A chain of
 * short linear ramps approximates any shape closely enough to be inaudible and can be
 * cancelled at any moment.
 */

/** Equal-power fade in: sin(t * PI/2). Pairs with fadeOutShape to a constant power sum. */
export function fadeInShape(t: number): number {
  return Math.sin((t * Math.PI) / 2)
}

/** Equal-power fade out: cos(t * PI/2). */
export function fadeOutShape(t: number): number {
  return Math.cos((t * Math.PI) / 2)
}

/** Below this a ramp is just a de-click and shape stops mattering. */
export const DECLICK = 0.015

function steps(duration: number): number {
  return Math.max(2, Math.min(64, Math.ceil(duration * 60)))
}

/**
 * Ramp `param` from `from` to `to` over `duration`, following `shape` (a 0..1 -> 0..1
 * easing applied to the interpolation). Clears any pending automation first, so this
 * is safe to call on top of an in-flight fade.
 */
export function rampShaped(
  param: AudioParam,
  from: number,
  to: number,
  startTime: number,
  duration: number,
  shape: (t: number) => number,
): void {
  param.cancelScheduledValues(startTime)
  param.setValueAtTime(from, startTime)
  if (duration <= 0) {
    param.setValueAtTime(to, startTime)
    return
  }
  const n = steps(duration)
  for (let i = 1; i <= n; i++) {
    const t = i / n
    param.linearRampToValueAtTime(from + (to - from) * shape(t), startTime + duration * t)
  }
}

/** Silence -> target, equal-power. */
export function fadeIn(param: AudioParam, target: number, startTime: number, duration: number): void {
  rampShaped(param, 0, target, startTime, Math.max(duration, 0), fadeInShape)
}

/**
 * Current level -> silence, equal-power.
 *
 * rampShaped interpolates `from + (to - from) * shape(t)`, so to land on
 * `from * cos(t*PI/2)` with to = 0 the shape has to be `1 - cos(t*PI/2)`.
 */
export function fadeOut(param: AudioParam, from: number, startTime: number, duration: number): void {
  rampShaped(param, from, 0, startTime, Math.max(duration, DECLICK), (t) => 1 - fadeOutShape(t))
}
