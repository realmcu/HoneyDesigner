# 图标取材指南（搜索 → 验证 → 适配）

> **AI 不是绘图引擎，是调度器**：理解意图 → 从开源图标库检索现成矢量图 → 清洗/适配 → 交扩展栅格化为 PNG。
> **不要手写 SVG 去画实物图标。** 有标准长相的东西（品牌 logo、国旗、物体、通用 UI 图标），
> 取设计师画好的原版永远比盲画准，还省掉反复迭代。手绘只是"库里确实没有"时的下策（见末节）。

---

## 管线总览

```text
关键词 → Iconify 检索候选 → 取 SVG → 清洗/适配 → POST /api/svg-to-image → assets/<name>.png → 写进 HML
```

- **检索**：AI 调 Iconify HTTP API。这是**设计时**联网取材——产物是本地 PNG（再转 `.bin`），
  仿真/固件运行时仍然离线，不违反离线原则。
- **栅格化**：扩展内置 resvg（WASM，离线），**与 SVG 来源无关**——检索来的 SVG 照样喂。
- **PNG → .bin**：仿真/构建期自动转，本流程到 PNG 即止。

---

## 第 0 步：盘点 assets，能复用就不取（减法优先）

1. 列出 `assets/`（含子目录）现有图像。
2. **已有图像能满足需求 → 直接用，不取。**
3. 只为"确实缺失"的部分进入检索流程。

## 第 1 步：搜索（Iconify 聚合两百多个开源图标集）

### 1.1 意图理解：中文需求 → 英文图标关键词

检索前先把用户的描述翻成图标库通用的英文词：蓝牙→`bluetooth`、设置→`settings`/`gear`、
电池→`battery`、虾→`shrimp`、心率→`heart-rate`/`pulse`。一个意图多试几个近义词。

### 1.2 搜索 API

```text
GET https://api.iconify.design/search?query=<关键词>&limit=32
```

返回候选 `prefix:name` 列表，**每个集都带 license 字段**。实测 `query=shrimp` 节选：

```json
{
  "icons": ["lucide:shrimp", "ph:shrimp", "tdesign:shrimp",
            "noto:shrimp", "twemoji:shrimp", "openmoji:shrimp", "..."],
  "collections": {
    "lucide": { "license": { "spdx": "ISC" } },
    "ph":     { "license": { "spdx": "MIT" }, "name": "Phosphor" },
    "noto":   { "license": { "spdx": "Apache-2.0" }, "palette": true },
    "openmoji": { "license": { "spdx": "CC-BY-SA-4.0" }, "palette": true }
  }
}
```

挑选维度：**风格**（线性 / 扁平 / 多色 emoji，对齐第 3.2 节）、**license**（见"版权"章）、**是否贴合现有 UI**。

### 1.3 取图 API

```text
GET https://api.iconify.design/<prefix>/<name>.svg
```

实测 `simple-icons/bluetooth.svg` 真实返回：

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M12 0C6.76 0 ..."/></svg>
```

两个必须注意的默认值：`fill="currentColor"`（不指定颜色就渲染成**纯黑**）、`width="1em"`（尺寸占位，
栅格化时由 `width` 参数主导，无妨）。改色见第 3.1 节。

## 第 2 步：验证（取下来真渲染，别只看名字）

图标名对不代表长得对。**取到 SVG → POST `/api/svg-to-image` → Read 产物 PNG 自检**：

- [ ] 剪影一眼认得出是这个东西吗？
- [ ] 比例 / 粗细对吗？
- [ ] 是想要的那一个，没撞成别的物体吗？

候选不确定时，取 2~3 个**逐个**渲染（顺序，勿并行，见末节）后看图对比选优——比反复改一个快。

## 第 3 步：适配（清洗 + 风格对齐）

### 3.1 颜色（最常踩的坑）

Iconify 默认 `fill="currentColor"` → resvg 渲染成**黑色**。要换色，三选一：

1. 取图时加参数（**单色集**，服务端改，最省事）：
   `https://api.iconify.design/mdi/home.svg?color=%23ff0000&width=96`
   实测会把 `currentColor` 替换为 `#ff0000`、`1em` 替换为 `96`。
2. 取下来后在本地把字符串 `currentColor` 替换成目标色值。
3. **多色集**（搜索结果里 `"palette": true`，如彩色 emoji `twemoji:shrimp`）**别动颜色**，原样用——
   它的配色是设计好的，替换会毁掉。

### 3.2 风格对齐（融入用户 UI，不强加审美）

1. **用户点名了风格** → 选对应风格的集（线性选 lucide/phosphor，扁平彩色选 fluent-emoji/noto）。
2. **没点名但 assets 已有图** → 读现有图的视觉语言（线性/扁平、主色、线宽），新图选风格一致的集。
3. **都没有** → 默认安全风格：**扁平极简、单/双色**（线性集 + 统一主色），通用、与任何 UI 都不冲突。

### 3.3 尺寸 / 背景

- `width="1em"` 不用管，`svg-to-image` 的 `width` 参数主导最终像素。
- Iconify 图标**默认透明、无底矩形**，正好符合规范——**别自己加 `<rect>` 背景**
  （透明 → resvg 输出 alpha=0 → 引擎按形状混合）。

---

## 版权（按 license 分类，必读）

| license | 含义 | 代表集 |
|---------|------|--------|
| **MIT / Apache / ISC** | 商用无忧 | lucide、phosphor、tdesign、icon-park、fluent-emoji、noto、flowbite |
| **CC BY** | 要署名 | twemoji、font-awesome、streamline、game-icons |
| **CC BY-SA** | **传染性**，衍生须同协议开源，商业固件慎用 | openmoji |
| **品牌 logo** | SVG 文件多为 CC0，但**商标权独立存在** | simple-icons |

> 品牌 logo（Google、微信等）：能不能放进产品 UI 是**商标使用**问题，不是文件许可问题——**让用户拍板**。
> Iconify 不改变图标的版权性质，只改变获取方式；走它取 logo 和去官网下，商标问题完全一样。

---

## 调用方式：POST /api/svg-to-image

把清洗后的 SVG 字符串交扩展栅格化为 PNG。

**默认用 bash 单引号内联即可**（Linux / macOS / Windows git bash）——SVG 用双引号属性、不含单引号，单引号一包就行：

```bash
curl -X POST http://localhost:38912/api/svg-to-image -H "Content-Type: application/json" \
  -d '{"svg":"<svg viewBox=\"0 0 24 24\"><path fill=\"#2563EB\" d=\"...\"/></svg>","name":"icon_bt","width":96}'
```

> 仅 **PowerShell 非交互**环境例外：内联 JSON 会被 PS 拆坏，需改走"临时文件 + `--data-binary`"三步模式
>（`curl.exe` 取图 → `python` 写无 BOM JSON → `curl.exe --data-binary @file`）。详见 `references/http-api.md` 第 3 条。

| 参数 | 必填 | 说明 |
|------|------|------|
| `svg` | ✅ | SVG 字符串（已清洗：颜色确定、无外部引用） |
| `name` | ✅ | 资源名，仅 `[a-zA-Z0-9_-]`，不含扩展名与路径 |
| `width` | ✅ | 输出 PNG 像素宽度 |
| `height` | 可选 | 省略则按 SVG viewBox 比例 |
| `overwrite` | 可选 | 默认 `false`；同名已存在返回 `ASSET_EXISTS`(409)，加此参数可强制替换 |

成功返回 `data.assetPath`（形如 `assets/icon_bt.png`），直接填进 HML。

> resvg 硬禁 `<image>` 与任何 `data:`/网络引用——Iconify 图标天然只是矢量 `path`，不含这些，无需担心。
> **图标里别放文字**：图标取材走纯矢量图标，不涉及 `<text>`；界面文案一律用 HML 的 `hg_label` 渲染。

---

## 写进 HML

```xml
<hg_image id="icon_bt" src="assets/icon_bt.png" x="20" y="20" width="96" height="96"/>

<hg_button id="btn_power" imageOn="assets/btn_on.png" imageOff="assets/btn_off.png"
           x="160" y="200" width="96" height="96" clickCallback="on_power_click"/>
```

- `src` 只写 `.png`，**不写 `.bin`**（仿真/编译时自动转）。
- 写完仍须调 `validate-hml` 校验结构。

---

## 端到端示例（搜 → 验 → 适配 → 落地）

```bash
# 1. 搜索候选（挑 license=MIT / 线性风格）
curl -s "https://api.iconify.design/search?query=bluetooth&limit=10"

# 2. 取 SVG（用 curl 取，别用脚本库直连——Iconify CDN 对无 User-Agent 的请求返回 403；服务端改色+定宽）
curl -s "https://api.iconify.design/mdi/bluetooth.svg?color=%232563EB&width=96"

# 3. 把上一步的 SVG 内联进 -d（bash 单引号包裹，SVG 的双引号原样保住）
curl -X POST http://localhost:38912/api/svg-to-image -H "Content-Type: application/json" \
  -d '{"svg":"<上一步返回的 svg>","name":"icon_bt","width":96}'

# 4. Read assets/icon_bt.png 自检 → 通过则写进 HML，再 validate-hml
```

> PowerShell 非交互环境改用三步模式（见 `references/http-api.md` 第 3 条）。

---

## 执行注意事项（Windows / 非交互环境）

- **检索与栅格化都用 `curl.exe`**：PowerShell 里 `curl` 是 `Invoke-WebRequest` 别名，行为不一致。
  或用 `Invoke-RestMethod -UseBasicParsing`。
- **顺序调用，勿用 `Start-Job`/`Wait-Job` 并行**——非交互下会挂死。
- **Iconify 连不通时**：换自托管地址（Iconify API 开源可内网部署），或把图标集作为
  `@iconify-json/<prefix>` npm 包装进本地后离线取。
- 完整 HTTP API 说明见 **`references/http-api.md`**。

---

## 实在搜不到怎么办（例外，下策）

主路径永远是"先搜库"。确实搜不到时，按序：

1. **换词 / 换集再搜**：换英文近义词，或直接指定大集（`mdi`、`ph`、`tabler`）翻。
2. **组合现有图标**：用两三个简单图标拼出需要的语义。
3. **让用户提供素材**：高度定制的品牌插画，请用户给 SVG/PNG。
4. **最简几何兜底**：仅当上面都不行，才手写最简单的几何 SVG（圆/方/线组合），
   **仍须走第 2 步渲染自检**。不要用矢量硬模拟照片纹理/写实材质——那是 SVG 的死穴。
