# 图片转 JPEG 转换器

一个 TypeScript 库，用于将图片转换为带自定义二进制头部的 JPEG 格式，专为嵌入式显示系统设计。使用 FFmpeg 进行高质量图片转换，生成与嵌入式 GUI 系统兼容的专有头部格式。

## ✨ 功能特性

- **标准 JPEG 编码**: 符合 ISO/IEC 10918-1 基线标准
- **多种采样因子**: 支持 400（灰度）、420、422、444 色度子采样
- **质量控制**: 可配置 JPEG 质量（1-31 范围，数值越小质量越高）
- **自定义二进制头部**: 生成 `gui_rgb_data_head_t` 和 `gui_jpeg_file_head_t` 结构
- **透明度支持**: 自动处理 PNG、WEBP、GIF、TIFF 的透明区域，支持自定义背景色
- **MCU 对齐（可选，`align`）**: JPEG 物理编码始终以 MCU 为单位；`align` 只控制 **JPEG 负载内 SOF 标记**报告的宽高是否向上取整到 MCU（开=取整，关=精确尺寸）。GUI 头部始终为原始宽高。适配对 MCU 对齐有要求的硬件解码器
- **最小尺寸 padding（可选，`minWidth`/`minHeight`）**: 指定最小**内容**宽高，原图小于该值时在右侧/下方补齐（黑色填充）；下限不小于 MCU。是否再取整到 MCU 由 `align` 决定，两者正交；GUI 头部仍保持原始宽高
- **缩放选项**: 内置图片缩放功能（50%、70%、80%）
- **二进制输出**: 生成包含嵌入式 JPEG 和自定义头部的 `.bin` 文件
- **双重接口**: 提供 CLI 工具和编程 API
- **TypeScript 支持**: 完整的类型定义和 IntelliSense 支持
- **源码集成**: 专为复制到项目中使用而设计

## ⚠️ 重要规范说明

### Spec v4.txt 严格合规

根据 `script/spec_v4.txt` 的严格要求：

> **gui_rgb_data_head_t 填充 type 、w 和 h，其余为 0**

这意味着生成的二进制头部中：

- ✅ **type** = 12 (JPEG 标识)
- ✅ **w** = 图片宽度
- ✅ **h** = 图片高度  
- ✅ **其余所有字段** = 0 (包括 scan, align, resize, compress, jpeg, idu, rsvd, version, rsvd2)

> **关于 `align` / `min` 与 GUI 头部**：无论是否开启 `align` 或设置 `minWidth`/`minHeight`，GUI 头部（`gui_rgb_data_head_t`）始终只填充 `type`/`w`/`h`，且 `w`/`h` 恒为**原始输入宽高**，头部内的 `align` 位与其余位字段强制为 0——严格保持 spec_v4 合规。这些选项只影响 **JPEG 负载内部的 SOF 标记**及其编码内容，SOF 不受 spec_v4 头部约束管辖。详见下文「MCU 对齐」「最小尺寸 padding」章节。

### API 兼容性说明

为了保持 API 的向后兼容性，以下参数仍然保留在接口中，但 **不会影响实际的头部生成**：

- `resize` - 头部中 resize 字段强制为 0
- `compress` - 头部中 compress 字段强制为 0  
- `version` - 头部中 version 字段强制为 0

### 头部结构验证

生成的头部结构严格按照以下格式：

```
字节 0: 0x00 (所有位字段都为 0)
字节 1: 0x0C (type = 12, JPEG)
字节 2-3: 图片宽度 (uint16, little-endian)
字节 4-5: 图片高度 (uint16, little-endian)  
字节 6: 0x00 (version = 0)
字节 7: 0x00 (rsvd2 = 0)
字节 8-11: JPEG 数据大小 (uint32, little-endian)
字节 12-15: 0x00000000 (对齐字段)
字节 16+: JPEG 数据 (从 0xFFD8 开始)
```

## 🚀 快速开始

### 环境要求

1. **Node.js**: 版本 14 或更高
2. **FFmpeg**: 必须安装并在系统 PATH 中可用
3. **TypeScript**: 如果需要编译源码

### FFmpeg 安装

```bash
# Windows (使用 Chocolatey)
choco install ffmpeg

# macOS (使用 Homebrew)
brew install ffmpeg

# Ubuntu/Debian
sudo apt update && sudo apt install ffmpeg

# 验证安装
ffmpeg -version
```

## 📦 源码集成方法

### 方法一：完整源码复制（推荐）

```bash
# 1. 复制核心源码文件到你的项目
cp -r image-to-jpeg-converter/src/* your-project/src/image-converter/

# 2. 复制类型定义文件（可选，用于 TypeScript 项目）
cp -r image-to-jpeg-converter/dist/*.d.ts your-project/types/

# 3. 如果使用 JavaScript 项目，复制编译后的文件
cp -r image-to-jpeg-converter/dist/* your-project/lib/image-converter/
```

### 方法二：选择性文件复制

如果只需要核心功能，可以只复制必要文件：

```bash
# 核心文件（必需）
cp image-to-jpeg-converter/src/types.ts your-project/src/
cp image-to-jpeg-converter/src/converter.ts your-project/src/
cp image-to-jpeg-converter/src/ffmpeg-executor.ts your-project/src/
cp image-to-jpeg-converter/src/header-generator.ts your-project/src/
cp image-to-jpeg-converter/src/file-assembler.ts your-project/src/
cp image-to-jpeg-converter/src/validator.ts your-project/src/
cp image-to-jpeg-converter/src/index.ts your-project/src/

# CLI 工具（可选）
cp image-to-jpeg-converter/src/cli.ts your-project/src/
```

### 方法三：项目结构集成

推荐的项目结构：

```
your-project/
├── src/
│   ├── image-converter/          # 图片转换器模块
│   │   ├── types.ts             # 类型定义
│   │   ├── converter.ts         # 主转换器
│   │   ├── ffmpeg-executor.ts   # FFmpeg 执行器
│   │   ├── header-generator.ts  # 头部生成器
│   │   ├── file-assembler.ts    # 文件组装器
│   │   ├── validator.ts         # 输入验证器
│   │   ├── index.ts            # 导出接口
│   │   └── cli.ts              # 命令行工具（可选）
│   └── your-app.ts             # 你的应用代码
├── package.json
└── tsconfig.json
```

## 💻 编程 API 使用

### 基本用法

```typescript
import { convertToJpeg, SamplingFactor } from './image-converter';

// 简单转换
const result = await convertToJpeg({
  inputPath: 'photo.png',
  outputPath: 'photo.bin',
  samplingFactor: SamplingFactor.YUV420,
  quality: 10
});

console.log(`✅ 转换成功: ${result.outputPath}`);
console.log(`📏 JPEG 大小: ${result.jpegSize} 字节`);
console.log(`📐 图片尺寸: ${result.dimensions.width}x${result.dimensions.height}`);
```

### 透明度处理

```typescript
// 带透明度的图片处理
const transparentResult = await convertToJpeg({
  inputPath: 'logo.png',
  outputPath: 'logo.bin',
  samplingFactor: SamplingFactor.YUV422,
  quality: 8,
  backgroundColor: 'white'  // 透明区域使用白色背景
});
```

### 高级选项

```typescript
// 完整配置示例
const advancedResult = await convertToJpeg({
  inputPath: 'input.png',
  outputPath: 'output.bin',
  samplingFactor: SamplingFactor.YUV444,  // 最高质量采样
  quality: 2,                             // 最高质量设置
  backgroundColor: '#FF0000'              // 红色背景（透明图片）
  
  // 注意：以下参数已弃用，不会影响头部生成
  // resize: ResizeOption.Fifty,          // 头部中 resize 字段强制为 0
  // compress: true,                      // 头部中 compress 字段强制为 0  
  // version: 1,                          // 头部中 version 字段强制为 0
});
```

### MCU 对齐

JPEG **物理编码始终以 MCU（最小编码单元）为单位**——块尺寸由色度采样决定，编码器内部会把最后不足一个 MCU 的部分补齐，解码时再裁剪掉。这一点与任何参数无关。

`align` 控制的只是 **JPEG 负载内 SOF 标记里写入的宽高**是否向上取整到 MCU：

- **开启**：在编码前于**右侧/下方**做 padding（黑色填充）到 MCU 边界，使 SOF 报告对齐后的宽高（如 686 → 688）。面向「按整块 MCU 解码、无法裁剪回非对齐尺寸」的硬件解码器。
- **关闭**（默认）：SOF 报告精确内容尺寸（可能非 MCU 倍数，如 686）；物理上仍按 MCU 编码，多出的部分由解码器裁剪。

无论开关，**GUI 头部始终保持原始输入宽高**。

MCU 粒度（按采样因子）：

| 采样因子 | MCU 尺寸 |
|---------|---------|
| 420 | 16 × 16 |
| 422 | 16 × 8 |
| 444 | 8 × 8 |
| 400（灰度） | 8 × 8 |

```typescript
// 输入 686x686，采样 420（MCU 16x16）→ 对齐到 688x688
const result = await convertToJpeg({
  inputPath: 'photo.png',   // 686x686
  outputPath: 'photo.bin',
  samplingFactor: SamplingFactor.YUV420,
  quality: 10,
  align: true
});

result.dimensions;        // { width: 686, height: 686 } —— GUI 头部（原始尺寸）
result.encodedDimensions; // { width: 688, height: 688 } —— JPEG SOF（对齐后）
```

> **说明**：
> - `align` 默认关闭，默认路径行为不变，也不会调用 `ffprobe`。
> - 开启 `align` 需要 `ffprobe`（随 FFmpeg 一同安装）在 PATH 中可用——用于读取 padding 前的原始宽高。
> - 仅当对齐**实际改变了尺寸**时，返回值才包含 `encodedDimensions`；若输入本就对齐，则不填充、不返回该字段。
> - GUI 头部的 `align` 位与其余位字段仍为 0，严格遵循 spec_v4.txt。

### 最小尺寸 padding

当图片过小、需要保证**内容尺寸**不低于某个下限时，可用 `minWidth`/`minHeight` 指定最小内容宽高。若原图任一维度小于对应下限，编码前会在**右侧/下方**做 padding（黑色填充）补齐到该下限；GUI 头部依旧保持**原始输入宽高**。

`min` 只决定**内容尺寸**，是否再取整到 MCU 由 `align` 决定（两者正交）。每个维度：

- 内容尺寸 `content = max(原始尺寸, 下限)`；下限**不会小于一个 MCU**——传入值小于 MCU（或省略）时按 MCU 处理（对应「不应小于 mcu，默认是对应的 mcu 值」）。
- **SOF（JPEG header）宽高** = `align 开 ? 向上取整到 MCU(content) : content`。
- **物理编码** = `向上取整到 MCU(content)`（恒为 MCU 整数倍，解码器裁剪回 SOF）。

```typescript
// 输入 40x40 的小图，采样 420（MCU 16x16），要求最小内容 50x50

// align 关（默认）：SOF = 精确内容尺寸，不取整到 MCU
const r1 = await convertToJpeg({
  inputPath: 'icon.png',    // 40x40
  outputPath: 'icon.bin',
  samplingFactor: SamplingFactor.YUV420,
  quality: 10,
  minWidth: 50,
  minHeight: 50,
});
r1.dimensions;        // { width: 40, height: 40 } —— GUI 头部（原始）
r1.encodedDimensions; // { width: 50, height: 50 } —— JPEG SOF（精确内容，非 MCU）

// align 开：SOF = 向上取整到 MCU(50) = 64
const r2 = await convertToJpeg({
  inputPath: 'icon.png',    // 40x40
  outputPath: 'icon2.bin',
  samplingFactor: SamplingFactor.YUV420,
  quality: 10,
  align: true,
  minWidth: 50,
  minHeight: 50,
});
r2.dimensions;        // { width: 40, height: 40 } —— GUI 头部（原始）
r2.encodedDimensions; // { width: 64, height: 64 } —— JPEG SOF（取整到 MCU）
```

> **说明**：
> - `minWidth`/`minHeight` 默认未设置；一旦设置任一项即会触发 padding（**无需同时开启 `align`**），并且同样需要 `ffprobe` 读取原始宽高。
> - `min` 只设内容尺寸；是否取整到 MCU 由 `align` 决定（正交）。下限本身不小于一个 MCU。
> - 可只设置单个维度，另一维度的内容下限取该采样的 MCU（对已大于 MCU 的原图为 no-op）。
> - 仅当尺寸**实际改变**（SOF ≠ 原始）时才返回 `encodedDimensions`；GUI 头部与位字段行为与 `align` 一致（保持原始宽高、位字段为 0）。
> - 4:2:0 / 4:2:2 的 SOF 宽高需为偶数；请使用偶数 `min`（否则编码器可能自行调整）。

### 行为对照表（`align` × `min`）

下表列出各组合下三个尺寸的取值。原始尺寸 40×40，采样默认 420（MCU 16×16），另附 444/422 示例：

| 采样 | 原始 | `min` | `align` | GUI 头部 | JPEG header（SOF） | 物理 MCU 编码 |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 420 | 40×40 | 未设 | 关 | 40×40 | 40×40 | 48×48 |
| 420 | 40×40 | 未设 | 开 | 40×40 | 48×48 | 48×48 |
| 420 | 40×40 | 50×50 | 关 | 40×40 | **50×50** | 64×64 |
| 420 | 40×40 | 50×50 | 开 | 40×40 | 64×64 | 64×64 |
| 420 | 40×40 | 64×64 | 关 | 40×40 | 64×64 | 64×64 |
| 420 | 40×40 | 100×100 | 关 | 40×40 | **100×100** | 112×112 |
| 420 | 40×40 | 100×100 | 开 | 40×40 | 112×112 | 112×112 |
| 444 | 40×40 | 50×50 | 关 | 40×40 | 50×50 | 56×56 |
| 444 | 40×40 | 50×50 | 开 | 40×40 | 56×56 | 56×56 |
| 422 | 40×40 | 50×50 | 关 | 40×40 | 50×50 | 64×56 |
| 422 | 40×40 | 50×50 | 开 | 40×40 | 64×56 | 64×56 |

- **GUI 头部**：恒为原始输入宽高（spec_v4 合规），与 `align`/`min` 无关。
- **JPEG header（SOF）**：`align` 关 → 精确内容尺寸 `max(原始, 下限)`（可非 MCU，加粗行）；`align` 开 → 向上取整到 MCU。这是可观测的库输出（`encodedDimensions`），仅在其 ≠ 原始时返回。
- **物理 MCU 编码**：编码器内部行为，**恒为 MCU 整数倍** = `向上取整到 MCU(内容尺寸)`；解码器据 SOF 裁剪回报告尺寸，通常不可见。
- `min` 未设 + `align` 关（首行）：不触发 padding、不调用 `ffprobe`、不返回 `encodedDimensions`。

## 📋 详细参数说明

### ConversionConfig 接口

```typescript
interface ConversionConfig {
  /** 输入图片文件路径（支持 FFmpeg 支持的所有格式） */
  inputPath: string;

  /** 输出二进制文件路径（建议使用 .bin 扩展名） */
  outputPath: string;

  /** 色度子采样因子 */
  samplingFactor: SamplingFactor;

  /** JPEG 编码质量（可选，1-31，数值越小质量越高） */
  quality?: number;

  /** 图片缩放选项（可选） */
  resize?: ResizeOption;

  /** 启用压缩标志（可选，默认 false） */
  compress?: boolean;

  /** 版本字段（可选，默认 0） */
  version?: number;

  /** 透明图片的背景色（可选，默认 'black'） */
  backgroundColor?: string;

  /** 是否将 JPEG SOF（coded）宽高向上取整到 MCU 网格（可选，默认 false）。
   *  JPEG 物理编码始终以 MCU 为单位；此开关只决定 SOF 标记报告 MCU 对齐尺寸（开）
   *  还是精确内容尺寸（关，可非 MCU）。GUI 头部始终保持原始宽高；需要 ffprobe */
  align?: boolean;

  /** 最小内容宽度（可选）。原图宽度小于该值时在右侧 padding 补齐至该下限；
   *  下限不小于一个 MCU。是否再取整到 MCU 由 align 决定。设置后即触发 padding，需要 ffprobe */
  minWidth?: number;

  /** 最小内容高度（可选）。原图高度小于该值时在下方 padding 补齐至该下限；
   *  下限不小于一个 MCU。是否再取整到 MCU 由 align 决定。设置后即触发 padding，需要 ffprobe */
  minHeight?: number;
}
```

### 参数详细说明

#### 1. inputPath（必需）
- **类型**: `string`
- **说明**: 输入图片文件的完整路径
- **支持格式**: PNG、JPEG、BMP、TIFF、GIF、WEBP 等 FFmpeg 支持的格式
- **示例**: 
  ```typescript
  inputPath: './images/photo.png'
  inputPath: '/absolute/path/to/image.jpg'
  inputPath: 'C:\\Users\\user\\Pictures\\image.bmp'
  ```

#### 2. outputPath（必需）
- **类型**: `string`
- **说明**: 输出二进制文件的路径，建议使用 `.bin` 扩展名
- **格式**: 包含 16 字节自定义头部 + JPEG 数据
- **示例**:
  ```typescript
  outputPath: './output/result.bin'
  outputPath: '/tmp/converted.bin'
  ```

#### 3. samplingFactor（必需）
- **类型**: `SamplingFactor` 枚举
- **说明**: JPEG 色度子采样因子，影响图片质量和文件大小
- **选项**:
  ```typescript
  SamplingFactor.Grayscale = 400  // 灰度图片，最小文件
  SamplingFactor.YUV420 = 420     // 4:2:0 采样，常用平衡选择
  SamplingFactor.YUV422 = 422     // 4:2:2 采样，较好质量
  SamplingFactor.YUV444 = 444     // 4:4:4 采样，最佳质量
  ```
- **推荐**:
  - 一般用途: `YUV420`
  - 高质量需求: `YUV444`
  - 文件大小优先: `Grayscale`

#### 4. quality（可选）
- **类型**: `number`
- **范围**: 1-31
- **说明**: JPEG 编码质量，数值越小质量越高，文件越大
- **默认值**: 根据采样因子自动选择
- **推荐设置**:
  ```typescript
  quality: 2-5    // 极高质量（大文件）
  quality: 6-10   // 高质量（推荐）
  quality: 11-20  // 中等质量
  quality: 21-31  // 低质量（小文件）
  ```

#### 5. resize（可选，已弃用）
- **类型**: `ResizeOption` 枚举
- **说明**: ⚠️ **已弃用** - 根据 spec_v4.txt 严格要求，头部中的 resize 字段强制为 0
- **选项**:
  ```typescript
  ResizeOption.None = 0      // 不缩放（默认）
  ResizeOption.Fifty = 1     // 缩放到 50%
  ResizeOption.Seventy = 2   // 缩放到 70%
  ResizeOption.Eighty = 3    // 缩放到 80%
  ```
- **注意**: 参数保留用于 API 兼容性，但实际头部中 resize 字段始终为 0

#### 6. compress（可选，已弃用）
- **类型**: `boolean`
- **说明**: ⚠️ **已弃用** - 根据 spec_v4.txt 严格要求，头部中的 compress 字段强制为 0
- **默认值**: `false`（但实际不影响头部生成）
- **用途**: 保留用于 API 兼容性，实际头部中 compress 位始终为 0

#### 7. version（可选，已弃用）
- **类型**: `number`
- **说明**: ⚠️ **已弃用** - 根据 spec_v4.txt 严格要求，头部中的 version 字段强制为 0
- **默认值**: `0`（但实际不影响头部生成）
- **用途**: 保留用于 API 兼容性，实际头部中 version 字段始终为 0

#### 8. backgroundColor（可选）
- **类型**: `string`
- **说明**: 透明图片的背景色
- **默认值**: `'black'`
- **支持格式**:
  ```typescript
  backgroundColor: 'black'        // 颜色名称
  backgroundColor: 'white'
  backgroundColor: '#FF0000'      // 十六进制
  backgroundColor: 'rgb(255,0,0)' // RGB 格式
  ```

#### 9. align（可选）
- **类型**: `boolean`
- **默认值**: `false`
- **说明**: JPEG 物理编码始终以 MCU 为单位；此开关只决定 **JPEG SOF 标记报告的宽高**是否向上取整到 MCU。开=对齐尺寸，关=精确内容尺寸（可非 MCU）。**GUI 头部始终保持原始宽高**，位字段仍为 0
- **依赖**: 需要 `ffprobe`（随 FFmpeg 安装）在 PATH 中可用
- **MCU 粒度**: 420→16×16、422→16×8、444/400→8×8
- **详见**: [MCU 对齐](#mcu-对齐) 章节

#### 10. minWidth（可选）
- **类型**: `number`
- **默认值**: 未设置（等效于对应的 MCU 宽度）
- **说明**: 最小**内容**宽度。原图宽度小于该值时在**右侧** padding（黑色填充）补齐至该下限。内容宽 = `max(原始宽, minWidth)`；SOF 宽 = `align 开 ? 向上取整到 MCU(内容宽) : 内容宽`
- **下限**: 不小于一个 MCU；传入值小于 MCU 时按 MCU 处理（**不应小于 mcu**）
- **依赖**: 设置后即触发 padding（无需同时开启 `align`），需要 `ffprobe`
- **详见**: [最小尺寸 padding](#最小尺寸-padding) 章节

#### 11. minHeight（可选）
- **类型**: `number`
- **默认值**: 未设置（等效于对应的 MCU 高度）
- **说明**: 最小**内容**高度。原图高度小于该值时在**下方** padding（黑色填充）补齐至该下限。内容高 = `max(原始高, minHeight)`；SOF 高 = `align 开 ? 向上取整到 MCU(内容高) : 内容高`
- **下限**: 不小于一个 MCU；传入值小于 MCU 时按 MCU 处理（**不应小于 mcu**）
- **依赖**: 设置后即触发 padding（无需同时开启 `align`），需要 `ffprobe`
- **详见**: [最小尺寸 padding](#最小尺寸-padding) 章节

### ConversionResult 返回值

```typescript
interface ConversionResult {
  /** 转换是否成功 */
  success: true;

  /** 输出文件路径 */
  outputPath: string;

  /** JPEG 数据大小（字节，不包含自定义头部） */
  jpegSize: number;

  /** 图片尺寸（逻辑/原始尺寸，与 GUI 头部一致） */
  dimensions: {
    width: number;   // 宽度（像素）
    height: number;  // 高度（像素）
  };

  /** 编码尺寸（JPEG SOF 中报告的宽高）：align 开时为 MCU 对齐尺寸，
   *  仅设置 min 时为精确内容尺寸（可能非 MCU）。仅当该尺寸 ≠ 原始尺寸时出现 */
  encodedDimensions?: {
    width: number;
    height: number;
  };
}
```

## 🖥️ 命令行工具使用

### 基本语法

```bash
node dist/cli.js -i <输入文件> -o <输出文件> -s <采样因子> -q <质量>
```

### 参数说明

- `-i, --input <path>`: 输入图片文件路径
- `-o, --output <path>`: 输出二进制文件路径
- `-s, --sampling <factor>`: 采样因子（400/420/422/444）
- `-q, --quality <number>`: 质量设置（1-31）
- `-r, --resize <option>`: 缩放选项（50/70/80）
- `-c, --compress`: 启用压缩标志
- `-a, --align`: 将 JPEG SOF 宽高向上取整到 MCU 网格（关时 SOF 报告精确内容尺寸；物理始终 MCU 编码；GUI 头部保持原始宽高；需要 ffprobe）
- `--min-width <pixels>`: 最小内容宽度，原图更小时在右侧 padding 补齐（不小于 MCU；是否取整到 MCU 由 `-a` 决定；需要 ffprobe）
- `--min-height <pixels>`: 最小内容高度，原图更小时在下方 padding 补齐（不小于 MCU；是否取整到 MCU 由 `-a` 决定；需要 ffprobe）
- `-v, --version`: 显示版本信息
- `-h, --help`: 显示帮助信息

### 使用示例

```bash
# 基本转换
node dist/cli.js -i photo.png -o photo.bin -s 420 -q 10

# 高质量转换
node dist/cli.js -i image.png -o image.bin -s 444 -q 2

# 灰度转换
node dist/cli.js -i color.png -o gray.bin -s 400 -q 15

# 缩放 + 压缩
node dist/cli.js -i large.png -o small.bin -s 420 -q 8 -r 50 -c

# MCU 对齐（SOF 向上取整到 MCU，GUI 头部保持原始宽高）
node dist/cli.js -i photo.png -o photo.bin -s 420 -q 10 -a

# 最小尺寸 padding（内容补齐到至少 50x50；align 关 → SOF=50x50 精确尺寸）
node dist/cli.js -i icon.png -o icon.bin -s 420 -q 10 --min-width 50 --min-height 50

# 最小尺寸 padding + MCU 对齐（内容 50x50 → SOF 取整到 64x64）
node dist/cli.js -i icon.png -o icon.bin -s 420 -q 10 -a --min-width 50 --min-height 50
```

## 📁 输出文件格式

生成的 `.bin` 文件结构：

```
┌─────────────────────────────────────┐
│ RGB Data Header (8 字节)            │
│ - 位字段 (scan, align, resize 等)   │
│ - 类型 (12 = JPEG)                 │
│ - 宽度和高度                        │
│ - 版本和保留字段                    │
├─────────────────────────────────────┤
│ JPEG 文件大小 (4 字节)              │
├─────────────────────────────────────┤
│ 对齐字段 (4 字节, 总是 0)           │
├─────────────────────────────────────┤
│ JPEG 数据 (从 0xFFD8 开始)          │
│ - 标准 JPEG 格式                    │
│ - 可被标准 JPEG 解码器读取          │
└─────────────────────────────────────┘
```

## 🔧 集成到现有项目

### TypeScript 项目集成

```typescript
// 1. 复制源码到项目中
// 2. 在你的代码中导入
import { convertToJpeg, SamplingFactor, ResizeOption } from './lib/image-converter';

// 3. 在应用中使用
export class ImageProcessor {
  async processImage(inputPath: string, outputPath: string) {
    try {
      const result = await convertToJpeg({
        inputPath,
        outputPath,
        samplingFactor: SamplingFactor.YUV420,
        quality: 10
      });
      
      return {
        success: true,
        path: result.outputPath,
        size: result.jpegSize
      };
    } catch (error) {
      console.error('图片处理失败:', error.message);
      return { success: false, error: error.message };
    }
  }
}
```

### JavaScript 项目集成

```javascript
// 1. 使用编译后的 JavaScript 文件
const { convertToJpeg, SamplingFactor } = require('./lib/image-converter');

// 2. 在应用中使用
async function processImage(inputPath, outputPath) {
  try {
    const result = await convertToJpeg({
      inputPath: inputPath,
      outputPath: outputPath,
      samplingFactor: SamplingFactor.YUV420,
      quality: 10
    });
    
    console.log('转换成功:', result.outputPath);
    return result;
  } catch (error) {
    console.error('转换失败:', error.message);
    throw error;
  }
}
```

### Express.js Web 应用集成

```javascript
const express = require('express');
const multer = require('multer');
const { convertToJpeg, SamplingFactor } = require('./lib/image-converter');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.post('/convert', upload.single('image'), async (req, res) => {
  try {
    const result = await convertToJpeg({
      inputPath: req.file.path,
      outputPath: `converted/${req.file.filename}.bin`,
      samplingFactor: SamplingFactor.YUV420,
      quality: parseInt(req.body.quality) || 10,
      backgroundColor: req.body.backgroundColor || 'black'
    });
    
    res.json({
      success: true,
      outputPath: result.outputPath,
      jpegSize: result.jpegSize,
      dimensions: result.dimensions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      type: error.type
    });
  }
});
```

## 🚨 错误处理

### 错误类型

```typescript
type ConversionErrorType = 
  | 'validation'  // 输入验证失败
  | 'ffmpeg'      // FFmpeg 执行失败
  | 'io'          // 文件 I/O 操作失败
  | 'header';     // 头部生成失败
```

### 错误处理示例

```typescript
try {
  const result = await convertToJpeg(config);
  console.log('转换成功:', result);
} catch (error) {
  switch (error.type) {
    case 'validation':
      console.error('参数验证失败:', error.message);
      // 检查输入文件路径和参数
      break;
      
    case 'ffmpeg':
      console.error('FFmpeg 错误:', error.message);
      // 检查 FFmpeg 安装和输入文件格式
      break;
      
    case 'io':
      console.error('文件操作失败:', error.message);
      // 检查文件权限和磁盘空间
      break;
      
    case 'header':
      console.error('头部生成失败:', error.message);
      // JPEG 数据可能损坏
      break;
      
    default:
      console.error('未知错误:', error.message);
  }
}
```

## 📚 相关文档

- [API 参考文档](docs/API.md) - 完整的 API 文档
- [集成指南](docs/INTEGRATION.md) - 详细的集成说明
- [透明度处理](docs/TRANSPARENCY.md) - 透明度功能说明
- [CLI 使用指南](examples/cli-usage.md) - 命令行工具详细说明
- [使用示例](examples/) - 各种使用场景的示例代码

## 🔍 故障排除

### 常见问题

1. **FFmpeg 未找到**
   ```
   错误: FFmpeg is not installed or not found in PATH
   解决: 安装 FFmpeg 并确保在系统 PATH 中
   ```

2. **输入文件不存在**
   ```
   错误: Input file does not exist
   解决: 检查输入文件路径是否正确
   ```

3. **权限不足**
   ```
   错误: Permission denied
   解决: 检查输出目录的写入权限
   ```

4. **不支持的文件格式**
   ```
   错误: Unsupported input format
   解决: 使用 FFmpeg 支持的图片格式
   ```

### 调试命令

```bash
# 检查 FFmpeg 安装
ffmpeg -version

# 检查支持的格式
ffmpeg -formats | grep -E "(png|jpeg|bmp)"

# 手动测试转换
ffmpeg -i input.png -pix_fmt yuvj420p -q:v 10 test.jpg
```

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目。

## 📞 支持

如果遇到问题或需要帮助，请：

1. 查看文档和示例
2. 检查 [故障排除](#-故障排除) 部分
3. 提交 Issue 描述问题
# Install globally (optional)
npm install -g ./image-to-jpeg-converter

# Basic conversion with 4:2:0 sampling
image-to-jpeg -i input.png -o output.jpg -s 420 -q 10

# Grayscale conversion
image-to-jpeg -i photo.bmp -o photo.jpg -s 400 -q 15

# High quality with resize to 50%
image-to-jpeg -i large.tiff -o small.jpg -s 444 -q 2 -r 50

# With compression flag
image-to-jpeg -i input.png -o output.jpg -s 422 -q 5 -c
```

## 📖 Configuration Options

### Sampling Factors

| Factor | Description | Use Case |
|--------|-------------|----------|
| `400` | Grayscale (Y only) | Black & white images, smallest size |
| `420` | 4:2:0 subsampling | Most common, good balance |
| `422` | 4:2:2 subsampling | Better quality, moderate size |
| `444` | 4:4:4 subsampling | Best quality, largest size |

### Quality Settings

| Range | Quality | Recommended Use |
|-------|---------|-----------------|
| 1-5 | Very High | Professional photos, archival |
| 6-10 | High | Web images, presentations |
| 11-20 | Medium | General purpose, good balance |
| 21-31 | Low | Thumbnails, previews |

### Resize Options

- `50` - Resize to 50% of original dimensions
- `70` - Resize to 70% of original dimensions  
- `80` - Resize to 80% of original dimensions

## 🔧 Advanced Usage

### Error Handling

```typescript
import { convertToJpeg, ConversionError, SamplingFactor } from './image-to-jpeg-converter';

try {
  const result = await convertToJpeg({
    inputPath: 'input.png',
    outputPath: 'output.jpg',
    samplingFactor: SamplingFactor.YUV420,
    quality: 10,
    resize: 50,
    compress: true
  });
  
  console.log('✅ Success:', result);
} catch (error) {
  if (error instanceof ConversionError) {
    switch (error.type) {
      case 'validation':
        console.error('❌ Invalid input:', error.message);
        break;
      case 'ffmpeg':
        console.error('❌ FFmpeg error:', error.details);
        break;
      case 'io':
        console.error('❌ File I/O error:', error.message);
        break;
      case 'header':
        console.error('❌ Header generation error:', error.message);
        break;
    }
  }
}
```

### Batch Processing

```typescript
import { convertToJpeg, SamplingFactor } from './image-to-jpeg-converter';
import { readdir } from 'fs/promises';

async function convertDirectory(inputDir: string, outputDir: string) {
  const files = await readdir(inputDir);
  const images = files.filter(f => /\.(png|bmp|tiff|gif)$/i.test(f));
  
  const results = await Promise.allSettled(
    images.map(file => convertToJpeg({
      inputPath: `${inputDir}/${file}`,
      outputPath: `${outputDir}/${file.replace(/\.[^.]+$/, '.jpg')}`,
      samplingFactor: SamplingFactor.YUV420,
      quality: 10
    }))
  );
  
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      console.log(`✅ ${images[i]} converted`);
    } else {
      console.error(`❌ ${images[i]} failed:`, result.reason.message);
    }
  });
}
```

## 🏗️ Binary Header Format

The library generates custom headers compatible with embedded GUI systems:

### RGB Data Header (8 bytes)
```c
typedef struct gui_rgb_data_head {
    unsigned char scan : 1;      // Scan flag
    unsigned char align : 1;     // Alignment flag  
    unsigned char resize: 2;     // Resize option (0-3)
    unsigned char compress: 1;   // Compression flag
    unsigned char jpeg: 1;       // JPEG flag
    unsigned char idu: 1;        // IDU flag
    unsigned char rsvd : 1;      // Reserved
    char type;                   // Image type (12 for JPEG)
    short w;                     // Width in pixels
    short h;                     // Height in pixels
    char version;                // Version field
    char rsvd2;                  // Reserved
} gui_rgb_data_head_t;
```

### JPEG File Header
```c
typedef struct gui_jpeg_file_head {
    gui_rgb_data_head_t img_header;  // RGB header (8 bytes)
    uint32_t size;                   // JPEG size (from 0xFFD8)
    uint32_t dummy;                  // Alignment (always 0)
    uint8_t jpeg[1024];              // JPEG data
} gui_jpeg_file_head_t;
```

## 📋 Requirements

### System Requirements
- **Node.js**: 18.0.0 or higher
- **FFmpeg**: Must be installed and in system PATH
- **TypeScript**: 5.0+ (for development)

### FFmpeg Installation

**Windows:**
```bash
# Using Chocolatey
choco install ffmpeg

# Or download from https://ffmpeg.org/
```

**macOS:**
```bash
# Using Homebrew
brew install ffmpeg
```

**Linux:**
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install ffmpeg

# CentOS/RHEL  
sudo yum install ffmpeg
```

### Supported Input Formats
- PNG, BMP, TIFF, GIF, WEBP
- Any format supported by FFmpeg

## 📚 Documentation

- **[API Reference](docs/API.md)** - Complete API documentation with examples
- **[Integration Guide](docs/INTEGRATION.md)** - Step-by-step integration instructions

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

## 🔍 Troubleshooting

### Common Issues

**FFmpeg not found:**
```
Error: FFmpeg not found in system PATH
```
**Solution:** Install FFmpeg and ensure it's accessible from command line.

**Invalid quality range:**
```
Error: Quality must be between 1 and 31
```
**Solution:** Use quality values in the valid range (1-31).

**File not found:**
```
Error: Input file does not exist
```
**Solution:** Check file path and permissions.

### Debug Mode

Enable detailed logging:
```bash
DEBUG=image-to-jpeg-converter node your-app.js
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [FFmpeg](https://ffmpeg.org/) for image processing
- Uses [TypeScript](https://www.typescriptlang.org/) for type safety
- Tested with [Vitest](https://vitest.dev/) and [fast-check](https://fast-check.dev/)

---

**Made with ❤️ for embedded display systems**
