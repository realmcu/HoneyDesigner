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
   再对照规范矩阵人工核对组件/属性（验证器不查这两项）。详见"HML 验证"。
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
| 资源路径 | 以 `/` 开头，是"从 assets 文件夹起的相对路径"，如 `/icon.bin`、`/NotoSansSC-Bold.ttf` | `icon.bin`、`assets/icon.bin` |
| 字体 | `hg_label` 必须有 `fontFile`，且字体文件须在 assets 中 | 缺 `fontFile` |

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
                hAlign="CENTER" fontFile="/NotoSansSC-Bold.ttf" />
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
组件嵌套规则、`hg_view` 不嵌套、资源路径以 `/` 开头、Entry View 唯一性。

> ⚠️ 验证器**不查组件白名单、不查属性名**。用了不存在/当前引擎不可用的组件，或写错属性名（如把 `width` 写成 `w`），也可能 `valid:true`。
> 因此 `valid:true` 后仍须对照 `HML-Spec.md` 核对：组件在当前引擎可用、属性名正确。

详细 API：`references/http-api.md`。

## 文件参考

- **`HML-Spec.md`**（项目根）— **唯一真相源**：全部组件、属性、事件、引擎矩阵。
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
