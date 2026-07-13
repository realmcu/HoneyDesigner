---
name: honeygui-designer
description: |
  Generate HoneyGUI HML (XML-based UI markup) files for embedded devices from natural language descriptions.

  Use when user wants to:
  - Create/design GUI interfaces for embedded systems, wearables, or IoT devices
  - Generate HML files from descriptions like "design a settings screen" or "create a dashboard"
  - Build UI layouts for HoneyGUI projects with components like buttons, images, text, labels, etc.
  - Convert UI requirements into structured HML format

  Trigger keywords: "design", "create interface/screen/UI/page", "generate HML",
  "smart watch/wearable interface", "embedded GUI", "build UI", "make a screen",
  or any request describing GUI layouts for embedded/IoT devices.
---

# HoneyGUI Designer Skill

根据自然语言描述生成生产级的 HoneyGUI HML 文件。

## ⚠️ 唯一真相源：HML-Spec.md

**组件清单、属性名、事件结构、引擎矩阵一律以规范全文为准**，不要凭记忆或本文件的概述生成 HML。

- **在项目里工作时**：规范是**项目根 `HML-Spec.md`**（打开项目时自动分发，已按当前项目 `targetEngine`
  过滤并注入引擎说明；任何 agent 用 Read 即可）。这是项目内唯一一份规范，下文所有 `HML-Spec.md` 均指它。
- **维护本 skill / 改规范时**：唯一真相源是扩展仓库内 `references/hml-spec.md`，直接编辑此文件
  （分发到项目时不再复制它，改由项目根那份承载，避免两份不一致）。

**生成或修改任何 HML 前，先 Read 规范全文。** 本 SKILL.md 只讲工作流与最易踩的坑；
组件/属性细节、引擎可用性、事件/定时器/动画全在规范里。

### 引擎决定可用组件（关键）

HML 是**一套语言、两个 codegen 后端**：`honeygui` 与 `lvgl`，每个项目在 `project.json` 的
`targetEngine` 锁定一个。**只用规范中标注当前引擎 ✓（ready）的组件**；标 `planned`（🚧 / "暂不支持"）
或 `unsupported`（❌）的一律勿用——codegen 会产出 stub 或根本不支持，仿真编译会失败。

- HoneyGUI 项目**勿用**：`hg_input` / `hg_checkbox` / `hg_radio` / `hg_switch` / `hg_slider` /
  `hg_progressbar`（这些是 **LVGL-only**）、`hg_canvas`。
- LVGL 项目**勿用**：`hg_video` / `hg_3d`（planned）、`hg_glass` / `hg_particle` / `hg_menu_cellular`。
- **任何引擎都不存在、永远勿用**：`hg_container`、`hg_grid`、`hg_tab`。需要布局时用
  `hg_view` / `hg_window` / `hg_list`。

> 注意：`validate-hml` 通过**不等于**组件/属性正确——验证器只查 8 条结构规则（见下），
> **不校验组件白名单、不校验属性名**。组件与属性的正确性必须对照 `HML-Spec.md` 人工确认。

## 快速开始

当用户请求 UI 设计时：

1. **理解需求** — 设备类型、屏幕分辨率（智能手表默认 454x454）、所需功能、视觉风格。
2. **Read 规范** — 打开 `HML-Spec.md`，确认要用的组件在当前引擎可用、属性名与事件结构。
3. **规划布局** — 在脑海构思组件层次；考虑触摸目标、可读性；多屏则规划导航。
4. **生成 HML** — 用规范方言（见下"方言速记"），包含 `<meta>` 与 `<view>`，事件用 `<events>` 结构。
5. **验证 HML** ⚠️ — **必须调用** `POST http://localhost:38912/api/validate-hml`，修复所有 errors 后重验；
   再对照规范矩阵人工核对组件/属性（验证器不查这两项）。若连接失败，见"HML 验证"一节的降级步骤。详见"HML 验证"。
6. **迭代优化** — 呈现 HML，接受反馈改进，基于嵌入式最佳实践提建议。

## HML 方言速记（最常被写错，务必照此）

这些是 AI 最容易用错的写法。完整规则见 `HML-Spec.md`。

| 维度 | ✅ 正确 | ❌ 错误 |
|------|--------|--------|
| 尺寸 | `width="120"` `height="48"` | `w="120"` `h="48"` |
| 文本对齐 | `hAlign="CENTER"`（`LEFT`/`CENTER`/`RIGHT`）、`vAlign="MID"` | `textAlign="center"` |
| meta | `<project name="App" resolution="454x454" pixelMode="RGB565" />` + `<author .../>` | `<title>` + 嵌套 `<resolution>` |
| 事件 | `<events><event type="onClick"><action type="callFunction" functionName="fn"/></event></events>` | 内联 `onClick="fn"` |
| 按钮 | `hg_button` 用 `imageOn`/`imageOff` + `clickCallback`（普通）或 `onCallback`/`offCallback`（toggle），**非容器、无子组件** | `hg_button src=`、内嵌子组件、`text=` |
| entry | 恰好一个 `hg_view entry="true"` | 缺 entry 或多个 entry |
| 图像路径 | `src`/`imageOn`/`imageOff` 以 `assets/` 开头，如 `assets/icon.png`（与设计器一致，预览/仿真都认） | `/icon.bin`、`icon.png` |
| 字体路径 | `fontFile` 以 `/` 开头（从 assets 起算），如 `/NotoSansSC-Medium.ttf` | `NotoSansSC-Medium.ttf`、`assets/x.ttf` |
| 字体 | `hg_label` 必须有 `fontFile`，且字体文件须在 assets 中 | 缺 `fontFile` |

## 字体处理（`hg_label` 系列必读）

`hg_label` / `hg_time_label` / `hg_timer_label` 必须有 `fontFile`，且文件须**真实存在于 `assets/`**，
否则仿真编译失败。⚠️ `validate-hml` 只查路径以 `/` 开头、**不查文件是否存在**，会对不存在的字体误报 `valid:true`。

确定 `fontFile` 时（**只在项目内操作，不读插件目录或系统字体**）：

1. **列出 `assets/`，用里面已有的字体源**。扩展在打开项目时，若 assets 没有任何字体，
   会自动放入默认字体 `NotoSansSC-Medium.ttf`（Noto Sans 简体中文，覆盖中文+英文+数字），
   所以正常情况下 assets 至少有它，直接以 `/NotoSansSC-Medium.ttf` 引用即可。
2. **`fontFile` 引用 ttf 源文件**；`.bin` 是 build 时由 ttf 转换出的产物，不是字体源，别引用。
3. **万一 assets 一个字体都没有**，提示用户在设计器资源管理器中添加字体，
   **不要凭空引用不存在的字体名**。

> 中文文本必须用覆盖 CJK 的字体（如 NotoSansSC）；纯拉丁字体（如 Inter）渲染中文会缺字/豆腐块。

## 多语言处理（`hg_label` 文案词条化）

`hg_label` 可加 `i18nKey` 关联 `i18n/strings.json` 词条，设计器多语言预览与 codegen 据此取当前语言文案；
`i18nKey` **只整串替换、无占位符插值**，缺 key/翻译时回落到 `text`，且**仅 `hg_label` 生效**。
词条化、批量加语言、混排文本、字体覆盖等完整流程见 **`references/i18n.md`**。

> ⚠️ 两个必记的坑：① 解析顺序是 catalog → `text`，给已绑 `i18nKey` 的 label 改 `text=` **无效**，
> 要改 `strings.json` 里的词条翻译（或换/清空 `i18nKey`）；② 混排文本（"行程: 126.5 km"）因无插值别整串词条化，
> 静态标签用 `i18nKey`、动态数值另用 `characterSets`。

## 按需检索图像（先盘点，确实缺失才取）

**设计前先盘点 `assets/`：已有图像够用就复用**（减法优先）。确实缺失的图标/插画，
**不要手写 SVG 画**，而是从开源图标库（Iconify 聚合两百多个集）检索现成矢量图，
经清洗/适配后交扩展栅格化为 PNG。流程：搜索 → 验证（渲染回看）→ 适配（清洗/调色/风格对齐），
详见 **`references/icon-sourcing.md`**。

## HML 结构骨架

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <project name="MyApp" appId="com.example.myapp"
             resolution="454x454" pixelMode="RGB565" />
    <author name="Developer" email="dev@example.com" />
  </meta>
  <view>
    <hg_view id="view_main" entry="true" x="0" y="0" width="454" height="454"
             backgroundColor="#000000">
      <hg_label id="lbl_title" x="127" y="40" width="200" height="40"
                text="Hello" fontSize="24" color="#FFFFFF"
                hAlign="CENTER" fontFile="/NotoSansSC-Medium.ttf" />
    </hg_view>
  </view>
</hml>
```

## 嵌套规则（关键，验证器会查）

1. **只有容器** (`hg_view`、`hg_window`、`hg_list`、`hg_list_item`) 能包含子组件。
2. **非容器控件必须放在容器内**——不能直接作 `<view>` 的子节点。
3. **非容器控件不能有子组件**（如 `hg_label`/`hg_image`/`hg_button` 内不可嵌任何元素）。
4. `hg_view` **不能嵌套** `hg_view`。
5. `hg_list` 的子节点应为 `hg_list_item`；`hg_list_item` 可含任意非容器控件。

## 事件处理

事件用 `<events>` 子节点声明，模型是 **event → action**：

```xml
<hg_view id="view_home" x="0" y="0" width="454" height="454" entry="true">
  <events>
    <event type="onSwipeLeft">
      <action type="switchView" target="view_settings"
              switchOutStyle="SWITCH_OUT_TO_LEFT_USE_TRANSLATION"
              switchInStyle="SWITCH_IN_FROM_RIGHT_USE_TRANSLATION" />
    </event>
  </events>
  <!-- 子组件 -->
</hg_view>
```

- 常用事件：`onClick`、`onLongPress`、`onSwipeLeft/Right/Up/Down`、`onShow`/`onHide`（仅 `hg_view`）。
- 常用动作：`switchView`（切视图）、`callFunction`（调 C 回调）、`sendMessage`、`controlTimer`。
- `callFunction` 引用的 C 函数需先在 `src/user/...` 写空实现（仅为仿真编译通过）。
- 完整事件/动作/切换动画清单见 `HML-Spec.md` §12 / §14。

## HML 验证

生成 HML 后，调用 Extension HTTP API 验证：

```bash
# 方法 1：验证 HML 内容字符串
curl -X POST http://localhost:38912/api/validate-hml \
  -H "Content-Type: application/json" \
  -d '{"hmlContent":"<?xml version=\"1.0\"?><hml>...</hml>"}'

# 方法 2：通过文件路径验证
curl -X POST http://localhost:38912/api/validate-hml \
  -H "Content-Type: application/json" \
  -d '{"filePath":"ui/main.hml"}'
```

**验证器的 8 条规则**（必要不充分）：内容非空、XML 语法、文档结构（meta+view）、组件 ID 唯一性与格式、
组件嵌套规则、`hg_view` 不嵌套、图像路径 `assets/` 开头（字体 `fontFile` 以 `/` 开头）、Entry View 唯一性。

> ⚠️ 验证器**不查组件白名单、不查属性名**。用了不存在/当前引擎不可用的组件，或写错属性名（如把 `width` 写成 `w`），也可能 `valid:true`。
> 因此 `valid:true` 后仍须对照 `HML-Spec.md` 核对：组件在当前引擎可用、属性名正确。

> 🔌 **降级：服务连不上怎么办** — 该 API 由 HoneyGUI Visual Designer 扩展在本机 38912 端口提供，
> 只有在装了该扩展的 VS Code 里打开 HoneyGUI 项目时才会运行（例如脱离扩展单独使用本 skill 时就没有）。
> 若请求连接失败/超时：**不要**假装验证通过、也**不要**跳过校验，改为逐条对照上面的 8 条规则 +
> `HML-Spec.md` 的组件/属性矩阵人工核查，并在交付时明确告知用户"本次未执行自动结构校验（服务不可用），
> 已改为人工核对，建议在装有该扩展的环境中重新验证"。

详细 API：`references/http-api.md`。

## 从设计器选区编辑（Copy for AI）

用户在设计器里右键「复制给 AI」后，剪贴板会得到一段英文文本包，形如：

- 首行 `# HoneyGUI Designer selection — file: ui/Xxx.hml` 指明要改的 HML 文件。
- `Screenshot:` 下面是一张 PNG 的**绝对路径**——用你的读文件能力读它；图中**红框=用户选中的控件、框上标签=组件 id**。
- `Pointed controls:` 列出用户指向的控件：`id (type) parent=.. x=.. y=.. w=.. h=.. 关键属性`。`id` 唯一，可直接在 HML 里定位。

据此修改对应 `ui/*.hml`（`id` 不变，改几何/属性/文本）。改完调用
`POST http://localhost:38912/api/validate-hml {"filePath":"ui/Xxx.hml"}` 验证（连不上见"HML 验证"一节的降级步骤）；
组件/属性仍以项目根 `HML-Spec.md` 为准。用户的具体指令在文本包之后另行给出。

> ⚠️ 若被指控件是带 `i18nKey` 的 `hg_label`，用户让改文案时**改 `text=` 不生效**（预览/codegen 优先取 catalog）——
> 要改 `i18n/strings.json` 里对应词条的翻译，详见"多语言处理"节。

## 文件参考

- **`HML-Spec.md`**（项目根）— **唯一真相源**：全部组件、属性、事件、引擎矩阵。
- **`references/icon-sourcing.md`** — 图标取材：Iconify 检索 → 验证 → 适配 → 栅格化，版权分类，调用方式。
- **`references/i18n.md`** — 多语言：词条化、批量加语言、混排文本拆分、字体覆盖、I18n Manager 定位。
- **`references/design-principles.md`** — 嵌入式 UI 设计方法论（spec 不涵盖）。
- **`references/layout-patterns.md`** — 常见布局模式与代码示例（spec 不涵盖）。
- **`references/common-mistakes.md`** — 高频错误与修复。
- **`references/http-api.md`** — Extension HTTP API 完整文档。

## 示例使用提示（防照抄）

`assets/examples/` 中的示例**仅示范语法结构与组件用法**——必须按用户的**具体需求原创设计**，
**不要套用示例的布局、配色或文案**。优先参考演示单一语法点的小片段，而非整屏成品界面。

## 使用提示

- **先 Read 规范，再生成**：组件/属性以 `HML-Spec.md` 为准。
- **从简单开始**：先完成基本布局，再增加复杂性。
- **边做边验证**：验证 + 对照规范双重确认。
- **考虑嵌入式特性**：电池、有限资源、手指友好的触摸目标（≥44x44px）。
- **快速迭代**：生成 → 验证 → 反馈 → 改进。
