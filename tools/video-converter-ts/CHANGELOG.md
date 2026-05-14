# Changelog — video-converter-ts

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

---

## [1.1.0] - 2026-05-14

### Added

- **视频缩放预处理**：新增 `VideoScaler` 类（`src/preprocess/video-scaler.ts`），提供独立的视频缩放 API，与转换流程完全解耦
  - `scaler.scale(input, output, { width?, height? })` — 接收像素单位参数
  - 仅指定 `width` 或 `height` 时，自动保持宽高比（结果为偶数像素，兼容所有编解码器）
  - 同时指定 `width` 和 `height` 时，按精确尺寸缩放
  - 使用 libx264 CRF 18 输出中间文件，质量接近无损
- **`ConversionOptions.scale`**：在 `convert()` API 中添加 `scale?: ScaleOptions` 参数，支持在转换前自动完成缩放预处理
- **`ScaleOptions` 接口**：新增 `{ width?: number; height?: number }` 类型
- **`FFmpegBuilder.buildScaleCmd()`**：构建 FFmpeg 缩放命令（`-vf scale=W:H`）
- **debug 模式**：开启 `debug: true` 时，缩放中间文件保留在输出目录旁（`<name>.pre-scaled.mp4`）；关闭时自动清理
- **预处理模块目录**：`src/preprocess/`，后续预处理功能在此扩展
- `VideoScaler` 通过 `index.ts` 对外导出，可独立调用与测试

### Changed

- `VideoConverter.convert()` 内部重构：将格式分发逻辑提取为私有方法 `runConversion()`，同时支持无缩放和带缩放两条路径
- `ConversionResult.inputPath` 始终返回用户传入的原始路径（即使内部使用了缩放中间文件）

---

## [1.0.0] - 2026-01-20

### Added
- `VideoConverter`：主转换器类，支持 MJPEG / AVI-MJPEG / H264 三种输出格式
- `FFmpegBuilder`：FFmpeg 命令构建器（TypeScript 实现）
- `FFmpegExecutor`：子进程执行器，支持进度回调
- `VideoParser`：基于 ffprobe 的视频信息解析
- `postprocess/AviAligner`：纯 TypeScript AVI 8 字节对齐实现
- `postprocess/MjpegPacker`：纯 TypeScript MJPEG 打包实现
- `postprocess/H264Packer`：H264 自定义头部封装
- CLI 入口：`node dist/cli.js`，基于 Commander
- 调试模式（`-d`）：保留 AVI 转换中间文件
- 完整 TypeScript 类型定义
