/**
 * Pre-processing modules
 *
 * These modules operate on the input video *before* the main conversion
 * pipeline. Each processor is a standalone class with an independent API,
 * designed to be called and tested in isolation.
 */

export { VideoScaler } from './video-scaler';
