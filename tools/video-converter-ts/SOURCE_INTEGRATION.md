# 源码集成指南

本文档是将 video-converter 以源码方式集成到项目的完整参考文档。

## 核心优势

- ✅ **零运行时依赖** - 核心功能不依赖任何第三方包
- ✅ **纯 TypeScript** - 完整类型支持
- ✅ **模块化设计** - 只需复制 `src/` 目录
- ✅ **可自定义** - 直接修改源码满足特殊需求

---

## 需要哪些源文件

将以下文件复制到你的项目，`cli.ts` 不需要（依赖 commander，仅用于本仓库命令行工具）：

```
your-project/src/video-converter/
├── converter.ts          # 主转换器（VideoConverter 类，含预处理 pipeline）
├── parser.ts             # 视频信息解析（供多个类使用）
├── ffmpeg-builder.ts     # FFmpeg 命令构建（buildScaleCmd、buildCropCmd 等）
├── ffmpeg-executor.ts    # FFmpeg 执行器
├── models.ts             # 所有类型：VideoInfo、ConversionOptions、ConversionResult、ScaleOptions、CropOptions、PreprocessStep、OutputFormat、ProgressCallback
├── errors.ts             # 错误类：VideoConverterError、VideoFormatError、FFmpegNotFoundError、FFmpegError、PostProcessError
├── index.ts              # 重导出全部公共 API
├── preprocess/
│   ├── video-scaler.ts   # 独立缩放器（VideoScaler 类）
│   ├── video-cropper.ts  # 独立裁剪器（VideoCropper 类）
│   └── index.ts          # preprocess 导出入口
└── postprocess/
    ├── avi-aligner.ts    # AVI 8字节对齐后处理
    ├── mjpeg-packer.ts   # MJPEG 打包后处理
    ├── h264-packer.ts    # H264 自定义头部封装后处理
    └── index.ts          # postprocess 导出入口
```

> **注意：** `preprocess/` 目录含 VideoScaler（v1.1.0）和 VideoCropper（v1.2.0），务必完整复制。

---

## 快速集成（3 步）

### 第 1 步：复制源码文件

**使用脚本（推荐）：**

```bash
# Linux/Mac
chmod +x copy-source.sh
./copy-source.sh ../your-project/src/video-converter

# Windows
copy-source.bat ..\your-project\src\video-converter
```

**手动复制：**

```bash
# Linux/Mac
cp -r src/ your-project/src/video-converter/

# Windows
xcopy /E src\ your-project\src\video-converter\
```

### 第 2 步：配置 TypeScript

确保 `tsconfig.json` 包含 Node.js 类型，可选添加路径别名：

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "types": ["node"],
    "paths": {
      "@/video-converter": ["./src/video-converter/index.ts"]
    }
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0"
  }
}
```

### 第 3 步：导入并使用

```typescript
// 直接相对路径导入
import { VideoConverter, OutputFormat } from './video-converter';

// 或使用路径别名
import { VideoConverter, OutputFormat } from '@/video-converter';

const converter = new VideoConverter();
await converter.convert('input.mp4', 'output.avi', OutputFormat.AVI_MJPEG);
```

---

## 完整 API 参考

### 类型与枚举

```typescript
// 输出格式
enum OutputFormat {
  MJPEG     = 'mjpeg',      // 连续 JPEG 帧裸流
  AVI_MJPEG = 'avi_mjpeg',  // AVI 容器封装，8 字节对齐
  H264      = 'h264'        // H.264 裸流 + 自定义 32 字节头部
}
```

| 格式 | 枚举值 | 推荐扩展名 | 说明 |
|------|--------|------------|------|
| MJPEG | `OutputFormat.MJPEG` | `.mjpeg` | 连续 JPEG 帧裸流 |
| AVI-MJPEG | `OutputFormat.AVI_MJPEG` | `.avi` | AVI 容器，所有帧 8 字节对齐，含 idx1 索引 |
| H264 | `OutputFormat.H264` | `.h264` | H.264 裸流 + 自定义 32 字节头部（含分辨率、帧数、帧时间）|

```typescript

// 缩放参数（width / height 至少提供一个，均为正整数）
interface ScaleOptions {
  width?: number;   // 目标宽度；仅提供时高度自动保持宽高比（偶数值）
  height?: number;  // 目标高度；仅提供时宽度自动保持宽高比（偶数值）
  // 两者均提供时为精确尺寸（可能改变宽高比）
}

// 裁剪参数（width 和 height 均为必填正整数）
interface CropOptions {
  width: number;    // 裁剪区域宽度（正整数）
  height: number;   // 裁剪区域高度（正整数）
  x?: number;       // 裁剪区域左上角 X 偏移（非负整数；省略时 FFmpeg 自动居中）
  y?: number;       // 裁剪区域左上角 Y 偏移（非负整数；省略时 FFmpeg 自动居中）
}

// 预处理步骤（有序 pipeline 中的单个步骤）
type PreprocessStep =
  | { type: 'scale'; options: ScaleOptions }
  | { type: 'crop';  options: CropOptions  };

// 转换选项
interface ConversionOptions {
  frameRate?: number;           // 目标帧率（默认保持原帧率）
  quality?: number;             // MJPEG 质量 1-31（越小越好）；H264 CRF 0-51（越小越好）
  debug?: boolean;              // 默认 false；true 时保留所有预处理中间文件
  preprocess?: PreprocessStep[]; // 有序预处理 pipeline（优先级高于 scale）
  scale?: ScaleOptions;         // v1.1 缩放简写，等价于 preprocess: [{ type: 'scale', options }]
}

// 视频信息
interface VideoInfo {
  width: number;
  height: number;
  frameRate: number;
  frameCount: number;
  duration: number;   // 秒
  codec: string;
  filePath: string;
}

// 转换结果
interface ConversionResult {
  success: boolean;
  inputPath: string;        // 始终为调用者传入的原始路径（非临时缩放路径）
  outputPath: string;
  outputFormat: OutputFormat;
  frameCount: number;
  frameRate: number;
  quality: number;
  errorMessage?: string;
}

// 进度回调
type ProgressCallback = (current: number, total: number) => void;
```

### VideoConverter 类

```typescript
class VideoConverter {
  /**
   * @param onProgress 可选进度回调，每处理一帧调用一次
   */
  constructor(onProgress?: ProgressCallback)

  /**
   * 获取视频信息，不进行转换
   */
  getVideoInfo(filePath: string): Promise<VideoInfo>

  /**
   * 转换视频。
   * 若 options.preprocess 存在，按顺序执行每个预处理步骤（缩放/裁剪），
   * 上一步输出作为下一步输入；最终结果进入转换流程。
   * 若仅 options.scale 存在，等价于 preprocess: [{ type:'scale', options:scale }]。
   * debug: true 时所有中间文件保存为 <output-basename>.pre-<N>-<type>.mp4，不清理。
   */
  convert(
    inputPath: string,
    outputPath: string,
    format: OutputFormat,
    options?: ConversionOptions
  ): Promise<ConversionResult>
}
```

### VideoScaler 类

`VideoScaler` 与 `VideoConverter` 完全解耦，内部自带独立的 FFmpegBuilder、FFmpegExecutor、VideoParser。

```typescript
class VideoScaler {
  constructor(onProgress?: ProgressCallback)

  /**
   * 缩放视频。
   * 缩放命令：ffmpeg -vf scale=W:H -c:v libx264 -crf 18 -preset fast
   * 自动维度使用 -2：scale=W:-2（仅宽）或 scale=-2:H（仅高）。
   * @throws VideoConverterError 若 width 和 height 均未提供，或值非正整数
   */
  scale(
    inputPath: string,
    outputPath: string,
    options: ScaleOptions
  ): Promise<void>
}
```

### VideoCropper 类

`VideoCropper` 与 `VideoConverter` 完全解耦，内部自带独立的 FFmpegBuilder、FFmpegExecutor、VideoParser。

```typescript
class VideoCropper {
  constructor(onProgress?: ProgressCallback)

  /**
   * 裁剪视频。
   * 裁剪命令：ffmpeg -vf crop=W:H[:X:Y] -c:v libx264 -crf 18 -preset fast
   * 省略 x/y 时 FFmpeg 自动居中裁剪区域。
   * @throws VideoConverterError 若 width/height 非正整数，或 x/y 为负数/非整数
   */
  crop(
    inputPath: string,
    outputPath: string,
    options: CropOptions
  ): Promise<void>
}
```

### 错误类

```typescript
class VideoConverterError extends Error {}   // 基类
class VideoFormatError extends VideoConverterError {}     // 不支持的格式
class FFmpegNotFoundError extends VideoConverterError {}  // FFmpeg 未安装或不在 PATH
class FFmpegError extends VideoConverterError {}          // FFmpeg 执行失败
class PostProcessError extends VideoConverterError {}     // 后处理失败
```

### 完整导入列表

```typescript
import {
  VideoConverter,       // 主转换器类
  VideoScaler,          // 独立缩放器类
  VideoCropper,         // 独立裁剪器类
  OutputFormat,         // 输出格式枚举：MJPEG | AVI_MJPEG | H264
  VideoInfo,            // 视频信息接口
  ConversionResult,     // 转换结果接口
  ConversionOptions,    // 转换选项（含 preprocess、scale、debug 等）
  ScaleOptions,         // 缩放参数 { width?, height? }
  CropOptions,          // 裁剪参数 { width, height, x?, y? }
  PreprocessStep,       // 预处理步骤联合类型
  ProgressCallback,     // 进度回调类型 (current: number, total: number) => void
  VideoConverterError,  // 基础错误类
  FFmpegNotFoundError,  // FFmpeg 未安装或不在 PATH
  FFmpegError,          // FFmpeg 执行失败
  VideoFormatError,     // 不支持的视频格式
  PostProcessError      // 后处理失败
} from './video-converter';
```

---

## 使用示例

### 基本转换

```typescript
import { VideoConverter, OutputFormat } from './video-converter';

const converter = new VideoConverter();

const result = await converter.convert(
  'input.mp4',
  'output.avi',
  OutputFormat.AVI_MJPEG
);

console.log('转换完成:', result);
```

### 带进度回调

```typescript
import { VideoConverter, OutputFormat } from './video-converter';

const converter = new VideoConverter((current, total) => {
  const percent = (current / total * 100).toFixed(1);
  process.stdout.write(`\r进度: ${percent}% (${current}/${total})`);
});

await converter.convert('input.mp4', 'output.avi', OutputFormat.AVI_MJPEG);
console.log('\n完成');
```

### 获取视频信息

```typescript
import { VideoConverter } from './video-converter';

const converter = new VideoConverter();
const info = await converter.getVideoInfo('input.mp4');

console.log(`分辨率: ${info.width}x${info.height}`);
console.log(`帧率: ${info.frameRate} fps`);
console.log(`总帧数: ${info.frameCount}`);
console.log(`时长: ${info.duration.toFixed(2)} 秒`);
console.log(`编码: ${info.codec}`);
```

### 带缩放的转换（scale 简写，向后兼容）

转换器内部自动完成：**缩放 → 转换 → 清理临时文件**。

```typescript
import { VideoConverter, OutputFormat } from './video-converter';

const converter = new VideoConverter();

// 仅指定宽度，高度自动保持宽高比
const result = await converter.convert(
  'input.mp4',
  'output.avi',
  OutputFormat.AVI_MJPEG,
  { scale: { width: 640 } }
);

// 精确指定宽高
await converter.convert('input.mp4', 'output.mjpeg', OutputFormat.MJPEG, {
  scale: { width: 640, height: 360 }
});
```

### 使用 preprocess pipeline（推荐）

```typescript
import { VideoConverter, OutputFormat } from './video-converter';

const converter = new VideoConverter();

// 仅裁剪后转换
await converter.convert('input.mp4', 'output.avi', OutputFormat.AVI_MJPEG, {
  preprocess: [{ type: 'crop', options: { width: 640, height: 360 } }]
});

// 先缩放，再裁剪，再转换（多步 pipeline）
await converter.convert('input.mp4', 'output.avi', OutputFormat.AVI_MJPEG, {
  preprocess: [
    { type: 'scale', options: { width: 1280 } },
    { type: 'crop',  options: { width: 640, height: 360 } },
  ]
});

// 先裁剪，再缩放，再转换（顺序反过来）
await converter.convert('input.mp4', 'output.avi', OutputFormat.AVI_MJPEG, {
  preprocess: [
    { type: 'crop',  options: { width: 640, height: 360 } },
    { type: 'scale', options: { width: 320 } },
  ]
});
```

### 独立使用 VideoScaler

```typescript
import { VideoScaler } from './video-converter';

const scaler = new VideoScaler();

// 仅指定宽度，高度自动保持宽高比（偶数值）
await scaler.scale('input.mp4', 'scaled_w640.mp4', { width: 640 });

// 仅指定高度，宽度自动保持宽高比（偶数值）
await scaler.scale('input.mp4', 'scaled_h360.mp4', { height: 360 });

// 精确指定宽高（可能改变宽高比）
await scaler.scale('input.mp4', 'scaled_exact.mp4', { width: 640, height: 360 });
```

### 独立使用 VideoCropper

```typescript
import { VideoCropper } from './video-converter';

const cropper = new VideoCropper();

// 居中裁剪 640×360（省略 x/y，FFmpeg 自动计算偏移）
await cropper.crop('input.mp4', 'cropped_center.mp4', { width: 640, height: 360 });

// 从左上角(0, 0)裁剪 640×360
await cropper.crop('input.mp4', 'cropped_offset.mp4', { width: 640, height: 360, x: 0, y: 0 });

// 指定 x 偏移，y 方向自动居中
await cropper.crop('input.mp4', 'cropped_x.mp4', { width: 640, height: 360, x: 100 });
```

### 调试模式

```typescript
import { VideoConverter, OutputFormat } from './video-converter';

const converter = new VideoConverter();

// debug: true 时，所有预处理中间文件保留，命名格式：output.pre-1-scale.mp4、output.pre-2-crop.mp4
await converter.convert('input.mp4', 'output.avi', OutputFormat.AVI_MJPEG, {
  preprocess: [
    { type: 'scale', options: { width: 640 } },
    { type: 'crop',  options: { width: 320, height: 180 } },
  ],
  debug: true
});
// 转换后会保留 output.pre-1-scale.mp4 和 output.pre-2-crop.mp4 供排查
```

### 错误处理

```typescript
import {
  VideoConverter,
  OutputFormat,
  VideoConverterError,
  VideoFormatError,
  FFmpegNotFoundError,
  FFmpegError,
  PostProcessError
} from './video-converter';

const converter = new VideoConverter();

try {
  await converter.convert('input.mp4', 'output.avi', OutputFormat.AVI_MJPEG);
} catch (error) {
  if (error instanceof FFmpegNotFoundError) {
    console.error('FFmpeg 未安装或未在 PATH 中，请先安装 FFmpeg');
  } else if (error instanceof VideoFormatError) {
    console.error('不支持的视频格式:', error.message);
  } else if (error instanceof FFmpegError) {
    console.error('FFmpeg 执行失败:', error.message);
  } else if (error instanceof PostProcessError) {
    console.error('后处理失败:', error.message);
  } else if (error instanceof VideoConverterError) {
    console.error('转换错误:', error.message);
  } else {
    throw error;  // 非预期错误，向上抛出
  }
}
```

---

## 依赖要求

### 运行时依赖

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | 18+ | 使用 ES Modules |
| FFmpeg | 任意 | 必须在系统 PATH 中（`ffmpeg -version` 验证） |

### 编译时依赖（devDependencies）

```json
{
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.10.0"
  }
}
```

核心功能**不需要任何运行时 npm 依赖**。

---

## 集成检查清单

- [ ] 复制 `src/`（含 `preprocess/` 和 `postprocess/`）到项目
- [ ] 在 `package.json` 中添加 `typescript` 和 `@types/node` 到 devDependencies
- [ ] 配置 `tsconfig.json`（module、moduleResolution、types）
- [ ] 验证 FFmpeg 已安装：`ffmpeg -version`
- [ ] 测试基本转换功能
- [ ] 测试 preprocess pipeline（缩放、裁剪、组合步骤）
- [ ] 测试错误处理（如传入不存在的文件）
- [ ] 将源码文件加入版本控制

---

## VSCode 插件完整集成示例

以下示例展示在 VSCode 插件中集成的典型用法。

```typescript
// src/commands/convertVideo.ts
import * as vscode from 'vscode';
import * as path from 'path';
import {
  VideoConverter,
  OutputFormat,
  FFmpegNotFoundError,
  VideoFormatError,
  FFmpegError
} from '../video-converter';

export async function convertVideoCommand(): Promise<void> {
  const files = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { '视频文件': ['mp4', 'avi', 'mov', 'mkv'] },
    title: '选择要转换的视频文件'
  });

  if (!files || files.length === 0) return;

  const inputPath = files[0].fsPath;
  const outputPath = path.join(
    path.dirname(inputPath),
    `${path.basename(inputPath, path.extname(inputPath))}_converted.avi`
  );

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '视频转换中', cancellable: false },
    async (progress) => {
      const converter = new VideoConverter((current, total) => {
        const pct = Math.round(current / total * 100);
        progress.report({ message: `${pct}% (${current}/${total} 帧)` });
      });

      try {
        await converter.convert(inputPath, outputPath, OutputFormat.AVI_MJPEG, {
          preprocess: [{ type: 'scale', options: { width: 640 } }]
        });
        vscode.window.showInformationMessage(`转换完成: ${outputPath}`);
      } catch (error) {
        if (error instanceof FFmpegNotFoundError) {
          vscode.window.showErrorMessage('FFmpeg 未安装，请先安装 FFmpeg 并加入 PATH');
        } else if (error instanceof VideoFormatError) {
          vscode.window.showErrorMessage(`格式错误: ${(error as Error).message}`);
        } else if (error instanceof FFmpegError) {
          vscode.window.showErrorMessage(`FFmpeg 执行失败: ${(error as Error).message}`);
        } else {
          vscode.window.showErrorMessage(`转换失败: ${(error as Error).message}`);
        }
      }
    }
  );
}
```

---

## 性能建议

多次转换时复用转换器实例，避免重复初始化开销：

```typescript
class VideoService {
  private readonly converter: VideoConverter;

  constructor(onProgress?: ProgressCallback) {
    this.converter = new VideoConverter(onProgress);
  }

  convert(input: string, output: string, format: OutputFormat, options?: ConversionOptions) {
    return this.converter.convert(input, output, format, options);
  }
}
```

---

## 示例项目结构（VSCode 插件）

```
your-vscode-extension/
├── src/
│   ├── extension.ts
│   ├── commands/
│   │   └── convertVideo.ts
│   └── video-converter/        ← 复制到此处
│       ├── converter.ts
│       ├── parser.ts
│       ├── models.ts
│       ├── errors.ts
│       ├── ffmpeg-builder.ts
│       ├── ffmpeg-executor.ts
│       ├── index.ts
│       ├── preprocess/
│       │   ├── video-scaler.ts
│       │   ├── video-cropper.ts
│       │   └── index.ts
│       └── postprocess/
│           ├── avi-aligner.ts
│           ├── mjpeg-packer.ts
│           ├── h264-packer.ts
│           └── index.ts
├── package.json
└── tsconfig.json
```

---

## 常见问题

### Q: 用户需要安装 FFmpeg 吗？

**A**: 是的。FFmpeg 必须安装在系统中并在 PATH 里，用 `ffmpeg -version` 验证。

### Q: 支持哪些输入视频格式？

**A**: FFmpeg 支持的所有格式，包括 MP4、AVI、MOV、MKV、FLV 等。

### Q: 如何处理大文件？

**A**: 转换是异步操作，使用进度回调向用户展示进度即可，不会阻塞主线程。

### Q: 需要安装 commander 吗？

**A**: 不需要。`commander` 只用于本仓库的 CLI 工具（`cli.ts`），集成时不需要复制该文件。

### Q: 如何更新到新版本？

**A**: 从 GitHub 拉取最新源码后，对比差异手动同步变更的文件；或将本仓库作为 Git Submodule 管理。

### Q: VideoScaler 和 VideoConverter.convert(scale) 有什么区别？

**A**: 效果相同，使用场景不同：
- `VideoConverter.convert({ scale })` — 缩放是转换的一部分，适合"缩放后转格式"的完整流程
- `VideoScaler.scale()` — 纯粹的独立缩放，不涉及格式转换，适合只需缩放的场景

### Q: 支持哪些 Node.js 版本？

**A**: Node.js 18+（使用 ES Modules）。

### Q: 可以在浏览器中使用吗？

**A**: 不可以。依赖 Node.js 的 `fs`、`child_process` 等模块，只能在 Node.js 环境运行。

---

## 技术支持

- **GitHub**: https://github.com/Belief997/w01-video_converter
- **Issues**: https://github.com/Belief997/w01-video_converter/issues

## 许可证

MIT - 可自由使用、修改和分发
