# Changelog — video-converter-ts

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [Unreleased]

---

## [1.3.0] - 2026-05-28

### Added

- **AVI-MSV1 输出格式**：新增 `OutputFormat.AVI_MSV1`（`avi_msv1`），使用 Microsoft Video 1（`msvideo1`）编码器，像素格式 `rgb555le`
  - 支持通过 `backgroundColor` 参数合成 GIF 透明背景（白色/黑色/任意 CSS 颜色）
  - 支持 `frameRate`、`quality`（`-q:v 1–31`）参数控制
  - 支持 `scale`（向后兼容字段）和 `preprocess` pipeline（scale/crop 有序组合）
  - 自动对齐输出尺寸为 **4 的倍数**（`msvideo1` 编码器硬性要求，使用 `scale=trunc(iw/4)*4:trunc(ih/4)*4`）
  - 无需 AviAligner 后处理（MSV1 帧为原始 RGB555，非 JPEG 数据）
- **`FFmpegBuilder.buildAviMsv1Cmd()`**：构建 MSV1 命令，包含标准路径（`-vf`）和 backgroundColor 路径（`filter_complex` overlay）
- CLI 新增 `avi_msv1` 格式支持，`-f avi_msv1`

### Changed

- `package.json` description 更新，补充 AVI-MSV1 格式说明

---

## [1.2.0] - 2026-05-20

### Added

- **视频裁剪预处理**：新增 `VideoCropper` 类（`src/preprocess/video-cropper.ts`），提供独立的视频裁剪 API，与转换流程完全解耦
  - `cropper.crop(input, output, { width, height, x?, y? })` — 接收像素单位参数
  - `width` 和 `height` 均为必填项（正整数）
  - `x` / `y` 为可选偏移量（非负整数），省略时 FFmpeg 自动居中裁剪区域
  - 使用 libx264 CRF 18 输出中间文件，质量接近无损
- **`CropOptions` 接口**：新增 `{ width: number; height: number; x?: number; y?: number }` 类型
- **`PreprocessStep` 联合类型**：`{ type: 'scale'; options: ScaleOptions } | { type: 'crop'; options: CropOptions }`
- **`ConversionOptions.preprocess`**：在 `convert()` API 中添加 `preprocess?: PreprocessStep[]` 参数，支持有序的多步预处理 pipeline
  - 各步骤按数组顺序依次执行，上一步的输出作为下一步的输入
  - 设置 `preprocess` 时，`scale` 字段被忽略（`preprocess` 优先级更高）
  - 向后兼容：未设置 `preprocess` 时，`scale` 字段仍按 v1.1 逻辑工作
- **`FFmpegBuilder.buildCropCmd()`**：构建 FFmpeg 裁剪命令（`-vf crop=W:H[:X:Y]`）
- **debug 模式扩展**：开启 `debug: true` 时，所有预处理中间文件均保留（命名格式 `<name>.pre-<步骤序号>-<类型>.mp4`）；关闭时自动清理

### Changed

- `VideoConverter.convert()` 内部预处理逻辑重构：单一 `scale?` 块替换为通用预处理 pipeline 循环，`scale` 字段自动转换为单步 pipeline 保持向后兼容

### Docs

- 合并 `QUICK_START.md` 和 `INTEGRATION.md` 全部内容到 `SOURCE_INTEGRATION.md`，删除冗余文档，`SOURCE_INTEGRATION.md` 成为唯一集成与 API 参考文档
- `README.md` 更新 API 概览（补全 v1.2.0 类型）、项目结构和版本记录

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
