/**
 * MCU (Minimum Coded Unit) sizing and coded-dimension utilities for JPEG.
 *
 * Two distinct notions of "size" live here:
 *
 * 1. Physical encoding — JPEG ALWAYS encodes in whole MCU blocks whose pixel
 *    size depends on the chroma subsampling factor. That physical size is
 *    `roundUpToMCU(content)` no matter what options are chosen; the encoder
 *    pads the last partial MCU internally and the decoder crops it away.
 *
 * 2. SOF (coded) dimensions — the width/height actually WRITTEN into the JPEG
 *    SOF marker. This is what {@link computeEncodedDimensions} returns, and the
 *    `align` flag controls whether it is rounded up to the MCU grid or left at
 *    the exact content size (a possibly non-MCU value that the decoder crops).
 *
 * A separate `min` floor decides the CONTENT size (how far the frame is padded
 * with black), independently of whether the SOF value is then MCU-aligned.
 *
 * These helpers are pure (no I/O) so they can be unit-tested in isolation and
 * reused by both the converter and the FFmpeg command builder.
 *
 * @module alignment
 */

import { SamplingFactor } from './types.js';

/** MCU block size in pixels. */
export interface McuSize {
  /** MCU width in pixels */
  width: number;
  /** MCU height in pixels */
  height: number;
}

/** Image dimensions in pixels. */
export interface Dimensions {
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
}

/**
 * Optional minimum-size floor for the CONTENT (each axis independent).
 *
 * A value raises the content floor for that axis (black padding is added up to
 * it); it is always clamped up to at least one MCU, so it can never drop below
 * the MCU size ("不应小于 mcu"). An omitted axis defaults to exactly one MCU,
 * which is a no-op for any image already larger than the MCU.
 *
 * This floor is independent of `align`: it decides how large the content is,
 * while `align` decides whether the resulting SOF value is MCU-rounded.
 */
export interface MinSize {
  /** Minimum content width in pixels (raised to at least one MCU) */
  width?: number | undefined;
  /** Minimum content height in pixels (raised to at least one MCU) */
  height?: number | undefined;
}

/**
 * Returns the MCU (Minimum Coded Unit) size for a chroma subsampling factor.
 *
 * The MCU is the smallest group of blocks the JPEG encoder emits as a unit, so
 * the coded frame is always padded up to a whole number of MCUs on each axis:
 * - 400 (grayscale): 8×8   — one 8×8 luma block per MCU
 * - 420 (4:2:0):     16×16 — 2×2 luma blocks per MCU
 * - 422 (4:2:2):     16×8  — 2×1 luma blocks per MCU
 * - 444 (4:4:4):     8×8   — 1×1 luma block per MCU
 *
 * @param samplingFactor - Chroma subsampling factor
 * @returns MCU size in pixels
 */
export function mcuSizeOf(samplingFactor: SamplingFactor): McuSize {
  switch (samplingFactor) {
    case SamplingFactor.YUV420:
      return { width: 16, height: 16 };
    case SamplingFactor.YUV422:
      return { width: 16, height: 8 };
    case SamplingFactor.YUV444:
    case SamplingFactor.Grayscale:
      return { width: 8, height: 8 };
    default:
      // Unknown factor: fall back to 8×8. Invalid factors are rejected upstream
      // by the validator, so this branch only satisfies exhaustiveness.
      return { width: 8, height: 8 };
  }
}

/**
 * Rounds a value up to the nearest multiple of `unit`.
 */
function roundUp(value: number, unit: number): number {
  return Math.ceil(value / unit) * unit;
}

/**
 * Computes the SOF (coded) dimensions the JPEG will report, per axis.
 *
 * The math has two independent steps:
 *
 * 1. Content floor — `content = max(size, floor)`, where `floor` is the
 *    caller-supplied minimum (see {@link MinSize}) clamped to at least one MCU.
 *    This is how far the frame is padded with black. With no minimum the floor
 *    is one MCU, a no-op for any image larger than the MCU.
 * 2. Alignment — when `align` is true the content is rounded UP to the MCU
 *    boundary; when false the exact content size is used (which may be a
 *    non-MCU value). Either way the physical encoding is still MCU-based
 *    (`roundUpToMCU(content)`) — `align` only controls the SOF number.
 *
 * So: `align ? roundUpToMCU(max(size, floor)) : max(size, floor)`.
 *
 * If the result equals the original the caller can treat padding as a no-op and
 * skip it entirely.
 *
 * @param width - Original width in pixels
 * @param height - Original height in pixels
 * @param samplingFactor - Chroma subsampling factor
 * @param align - Round the SOF value up to the MCU grid (true) or keep the
 *   exact content size (false)
 * @param min - Optional minimum content-size floor per axis
 * @returns SOF dimensions (>= original and >= min on each axis; MCU-aligned iff `align`)
 *
 * @example
 * // 686×686 @ 420 (MCU 16×16), align on → 688×688 (MCU-aligned SOF)
 * computeEncodedDimensions(686, 686, SamplingFactor.YUV420, true); // { width: 688, height: 688 }
 *
 * @example
 * // 40×40 @ 420 with a 50×50 min, align OFF → 50×50 (exact content, NOT MCU-rounded)
 * computeEncodedDimensions(40, 40, SamplingFactor.YUV420, false, { width: 50, height: 50 });
 *
 * @example
 * // same 50×50 min but align ON → 64×64 (content 50 rounded up to the MCU grid)
 * computeEncodedDimensions(40, 40, SamplingFactor.YUV420, true, { width: 50, height: 50 });
 */
export function computeEncodedDimensions(
  width: number,
  height: number,
  samplingFactor: SamplingFactor,
  align: boolean,
  min?: MinSize
): Dimensions {
  const mcu = mcuSizeOf(samplingFactor);
  // Content floor is at least one MCU; a caller minimum raises it but never below MCU.
  const minWidth = Math.max(min?.width ?? mcu.width, mcu.width);
  const minHeight = Math.max(min?.height ?? mcu.height, mcu.height);
  const contentWidth = Math.max(width, minWidth);
  const contentHeight = Math.max(height, minHeight);
  // `align` gates ONLY the MCU rounding of the SOF value; the content size
  // itself is unchanged. Physical encoding is always MCU-based regardless.
  return {
    width: align ? roundUp(contentWidth, mcu.width) : contentWidth,
    height: align ? roundUp(contentHeight, mcu.height) : contentHeight,
  };
}

/**
 * Returns true if the dimensions are already aligned to the MCU boundary for
 * the given sampling factor (i.e. padding would be a no-op).
 *
 * @param width - Width in pixels
 * @param height - Height in pixels
 * @param samplingFactor - Chroma subsampling factor
 * @returns Whether both axes are already MCU-aligned
 */
export function isAligned(
  width: number,
  height: number,
  samplingFactor: SamplingFactor
): boolean {
  const aligned = computeEncodedDimensions(width, height, samplingFactor, true);
  return aligned.width === width && aligned.height === height;
}
