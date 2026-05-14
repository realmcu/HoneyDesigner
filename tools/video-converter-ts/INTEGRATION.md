# 集成指南

本文档说明如何将 video-converter 源码集成到你的项目中。

## 集成概述

video-converter 采用**源码集成**方式：将 `src/` 目录复制到你的项目，直接以相对路径导入。  
零运行时 npm 依赖，完整 TypeScript 类型支持。

完整文件列表与 API 参考详见 [SOURCE_INTEGRATION.md](./SOURCE_INTEGRATION.md)。

---

## 快速开始

### 1. 复制源码

```bash
# Linux/Mac
cp -r video-converter-ts/src/ your-project/src/video-converter/

# Windows
xcopy /E video-converter-ts\src\ your-project\src\video-converter\
```

> 务必包含 `preprocess/` 和 `postprocess/` 子目录，不要复制 `cli.ts`。

### 2. 配置 TypeScript

在 `package.json` 的 devDependencies 中确保有：

```json
{
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.10.0"
  }
}
```

### 3. 导入并使用

```typescript
import { VideoConverter, VideoScaler, OutputFormat } from './video-converter';
```

---

## 完整集成示例

以下示例展示在 VSCode 插件中集成的典型用法，同样适用于任何 Node.js 项目。

### 项目结构

```
your-project/
├── src/
│   ├── main.ts                   # 你的入口文件
│   └── video-converter/          ← 复制整个 src/ 到此
│       ├── converter.ts
│       ├── parser.ts
│       ├── models.ts
│       ├── errors.ts
│       ├── ffmpeg-builder.ts
│       ├── ffmpeg-executor.ts
│       ├── index.ts
│       ├── preprocess/
│       │   ├── video-scaler.ts
│       │   └── index.ts
│       └── postprocess/
│           ├── avi-aligner.ts
│           ├── mjpeg-packer.ts
│           ├── h264-packer.ts
│           └── index.ts
├── package.json
└── tsconfig.json
```

### 基本转换

```typescript
import { VideoConverter, OutputFormat } from './video-converter';

const converter = new VideoConverter((current, total) => {
  const percent = (current / total * 100).toFixed(1);
  console.log(`进度: ${percent}%`);
});

const result = await converter.convert(
  'input.mp4',
  'output.avi',
  OutputFormat.AVI_MJPEG
);

console.log('转换完成:', result.outputPath);
```

### 带缩放的转换

```typescript
import { VideoConverter, OutputFormat } from './video-converter';

const converter = new VideoConverter();

// 先缩放至 640px 宽（高度自动保持宽高比），再转换
await converter.convert('input.mp4', 'output.avi', OutputFormat.AVI_MJPEG, {
  scale: { width: 640 },
  quality: 2
});
```

### 独立缩放（不转换格式）

```typescript
import { VideoScaler } from './video-converter';

const scaler = new VideoScaler();

await scaler.scale('input.mp4', 'resized.mp4', { width: 640 });
await scaler.scale('input.mp4', 'resized.mp4', { height: 360 });
await scaler.scale('input.mp4', 'resized.mp4', { width: 640, height: 360 });
```

### 获取视频信息

```typescript
import { VideoConverter } from './video-converter';

const converter = new VideoConverter();
const info = await converter.getVideoInfo('input.mp4');

console.log(`${info.width}x${info.height} @ ${info.frameRate}fps, ${info.duration.toFixed(1)}s`);
```

### VSCode 插件集成示例

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
          scale: { width: 640 }
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

## 集成检查清单

- [ ] 复制 `src/`（含 `preprocess/`、`postprocess/`）到项目，不含 `cli.ts`
- [ ] 添加 `typescript` 和 `@types/node` 到 devDependencies
- [ ] 运行 `npm install` 安装 devDependencies
- [ ] 确认 `tsconfig.json` 中 `types` 包含 `"node"`
- [ ] 验证 FFmpeg：`ffmpeg -version`
- [ ] 测试基本转换（`VideoConverter.convert`）
- [ ] 测试独立缩放（`VideoScaler.scale`）
- [ ] 测试错误处理（传入不存在的文件）

---

## 错误处理

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
    console.error('请安装 FFmpeg 并确保其在 PATH 中');
  } else if (error instanceof VideoFormatError) {
    console.error('不支持的格式:', (error as Error).message);
  } else if (error instanceof FFmpegError) {
    console.error('FFmpeg 执行失败:', (error as Error).message);
  } else if (error instanceof PostProcessError) {
    console.error('后处理失败:', (error as Error).message);
  } else if (error instanceof VideoConverterError) {
    console.error('转换错误:', (error as Error).message);
  } else {
    throw error;
  }
}
```

---

## 调试模式

设置 `debug: true` 保留缩放中间文件（`<output-basename>.pre-scaled.mp4`）：

```typescript
await converter.convert('input.mp4', 'output.avi', OutputFormat.AVI_MJPEG, {
  scale: { width: 320 },
  debug: true   // output.pre-scaled.mp4 不会被自动删除
});
```

---

## 性能建议

多次转换时复用转换器实例：

```typescript
class VideoService {
  private readonly converter: VideoConverter;

  constructor(onProgress?: (current: number, total: number) => void) {
    this.converter = new VideoConverter(onProgress);
  }

  convert(input: string, output: string, format: OutputFormat) {
    return this.converter.convert(input, output, format);
  }
}
```

---

## 常见问题

### Q: 用户需要安装 FFmpeg 吗？
**A**: 是的。FFmpeg 必须安装在系统中并在 PATH 里，通过 `ffmpeg -version` 验证。

### Q: 支持哪些输入视频格式？
**A**: FFmpeg 支持的所有格式，包括 MP4、AVI、MOV、MKV、FLV 等。

### Q: 如何处理大文件？
**A**: 转换是异步操作，使用进度回调向用户展示进度即可，不会阻塞主线程。

---

## 技术支持

- **GitHub**: https://github.com/Belief997/w01-video_converter
- **Issues**: https://github.com/Belief997/w01-video_converter/issues
