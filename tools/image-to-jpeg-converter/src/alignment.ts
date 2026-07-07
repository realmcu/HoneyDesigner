/**
 * MCU (Minimum Coded Unit) alignment utilities for JPEG encoding.
 *
 * JPEG encodes in MCU blocks whose pixel size depends on the chroma subsampling
 * factor. Some hardware JPEG decoders decode whole MCU blocks and therefore
 * require the coded (SOF) dimensions to be aligned to the MCU boundary, rather
 * than relying on the decoder to crop back to the stored size.
 *
 * These helpers compute the MCU size for a sampling factor and the padded-up
 * ("aligned") dimensions. They are pure (no I/O) so they can be unit-tested in
 * isolation and reused by both the converter and the FFmpeg command builder.
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
 * Computes MCU-aligned dimensions for the given sampling factor.
 *
 * Each axis is rounded UP to the nearest MCU boundary. If the input is already
 * aligned the same dimensions are returned, so the caller can compare against
 * the original to detect a no-op (and skip padding entirely).
 *
 * @param width - Original width in pixels
 * @param height - Original height in pixels
 * @param samplingFactor - Chroma subsampling factor
 * @returns Aligned dimensions (>= original on each axis)
 *
 * @example
 * // 686×686 @ 420 (MCU 16×16) → 688×688
 * computeAlignedDimensions(686, 686, SamplingFactor.YUV420); // { width: 688, height: 688 }
 */
export function computeAlignedDimensions(
  width: number,
  height: number,
  samplingFactor: SamplingFactor
): Dimensions {
  const mcu = mcuSizeOf(samplingFactor);
  return {
    width: roundUp(width, mcu.width),
    height: roundUp(height, mcu.height),
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
  const aligned = computeAlignedDimensions(width, height, samplingFactor);
  return aligned.width === width && aligned.height === height;
}
