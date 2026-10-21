# HML (HoneyGUI 标记语言) 规范

> 版本: 2.0 | 最后更新: 2026-06-15

HML 是一种基于 XML 的标记语言，由 HoneyGUI Design 用于描述嵌入式 GUI 布局。本文档作为 AI 代理生成 HML 文件的权威参考。

HML 是**一种语言，配备两个代码生成后端（引擎）**：`honeygui` 和 `lvgl`。
每个项目通过 `project.json` → `targetEngine` 锁定唯一一个引擎。某个组件可能在两个引擎上
都可用、仅在一个引擎上可用，或两个都不可用。**只能使用当前项目引擎下标记为可用（✓）的组件。**
标记为 "暂不支持，勿用" / "planned" / "unsupported" 的组件
对该引擎绝不可使用。

## 引擎支持模型（务必先读）

每个组件章节都标注了它在各引擎下的状态，以两种同步的形式呈现：

1. 标题正下方的一行可读说明，例如 `引擎: ✓HoneyGUI ✓LVGL`。
2. 下一行的机器可解析 HTML 注释，例如 `<!-- engine: honeygui=ready lvgl=ready -->`。

> ⚠️ HTML 注释形式**由工具消费**（按引擎的分发过滤器 + CI
> 漂移检查）。请保持其精确格式：`<!-- engine: honeygui=<status> lvgl=<status> -->`，
> 其中 `<status>` ∈ `ready` | `unsupported`。不要随意自由书写。

| 状态 | 含义 | 可用? |
|--------|---------|---------|
| `ready` | 该引擎已完整实现 | ✅ 是 |
| `unsupported` | 该引擎完全不可用 | ❌ 否 — 请勿使用 |

标题中使用的可读标签简写：

| 标题标签 | 等价状态 |
|---------------|---------------------|
| `引擎: ✓HoneyGUI ✓LVGL` | honeygui=ready, lvgl=ready |
| `引擎: 仅HoneyGUI` | honeygui=ready, lvgl=unsupported |
| `引擎: 仅HoneyGUI（LVGL 暂未实现）` | honeygui=ready, lvgl=unsupported |
| `引擎: 仅LVGL` | honeygui=unsupported, lvgl=ready |
| `引擎: 暂不支持，勿用` | honeygui=unsupported, lvgl=unsupported |

> **真相来源是代码，而非本文档。** 该矩阵派生自两个代码生成
> 注册表（`src/codegen/honeygui/components/index.ts`、`src/codegen/lvgl/components/index.ts`）
> 以及 `ComponentLibrary.tsx` 的 `engineSupport`。当它们与某个存在于注册表中的 `unsupported`
> Generator 不一致时，以 `engineSupport` 为准（已注册的 Generator ≠ ready）。


## hg_view 不能嵌套 hg_view!!!!

- 不能有父子 hg_view 关系
- hg_view 的 xy 坐标只在 webview 画布上有意义，在 GUI 上没有意义，所以改变 xy 使视图集形成网格效果 (0,0;a,0;2a,0;0,b;a,b;.....)

## 只有字体文件在 assets 文件夹中，hg_label 才能访问它们!!!

- 回退方案：如果 assets 文件夹中没有字体文件，将 fallback 文件夹中的字体文件复制到 assets 文件夹，并使用这些回退字体文件。

## 请设置 hg_label 的字体文件。

## 不能使用相对文件路径
- 所有资源文件的路径是 '/' + '从 assets 文件夹开始的相对路径'
- 示例：'/NotoSansSC-Bold.ttf' 是正确的，'NotoSansSC-Bold.ttf' 会出错。

## 如果需要，在 src\user 中编写空的用户 C 函数（仅用于 GUI 模拟器编译通过）
- 示例：``` void func1(void *a, void *b) { (void)a; (void)b; gui_log("func1\n"); } ```
- 如果不需要，就不要写。
- 在 src\user\NewProjectxxxMain_user.c 和 src\user\NewProjectxxx4Main_user.h 中
- 在事件设置中，如果选择调用函数，需要先在 src\user 中编写空的 C 函数
- 这些函数内部可以为空或只打印日志
- 只能在 src\user 文件夹中！！！不要在其他文件夹中写
- 其他文件夹的 C 文件是工具自动生成的，不能被你编辑



---

## 目录

1. [文档结构](#1-文档结构)
2. [元数据部分](#2-元数据部分)
3. [视图部分](#3-视图部分)
4. [通用属性](#4-通用属性)
5. [组件分类与嵌套规则](#5-组件分类与嵌套规则)
6. [容器组件](#6-容器组件)
7. [基础控件](#7-基础控件)
8. [输入控件（仅 LVGL）](#8-输入控件仅-lvgl)
9. [图形控件](#9-图形控件)
10. [多媒体控件](#10-多媒体控件)
11. [事件系统](#11-事件系统)
12. [定时器与动画系统](#12-定时器与动画系统)
13. [视图切换动画](#13-视图切换动画)
14. [代码生成映射](#14-代码生成映射)
15. [示例](#15-示例)

---

## 1. 文档结构

每个 HML 文件都是一个 UTF-8 编码的 XML 文档，具有以下骨架结构：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hml>
    <meta>
        <!-- project metadata -->
    </meta>
    <view>
        <!-- component tree -->
    </view>
</hml>
```

### 规则

| 项目 | 要求 |
|------|-------------|
| 根元素 | `<hml>` — 必需 |
| 子元素 | 恰好两个子元素：先 `<meta>` 后 `<view>`，按此顺序 |
| 编码 | UTF-8 |
| 标签前缀 | 所有组件标签必须以 `hg_` 或 `custom_` 开头 |

### 标签约定

- **叶子节点**（无子元素、无事件）：使用自闭合标签 — `<hg_image id="img1" ... />`
- **容器**或**带事件的节点**：使用开闭标签 — `<hg_view ...>...</hg_view>`

---

## 2. 元数据部分

`<meta>` 节点保存项目级配置：

```xml
<meta>
    <project name="MyApp" appId="com.example.myapp"
             resolution="454x454" minSdk="1.0" pixelMode="RGB565" />
    <author name="Developer" email="dev@example.com" />
</meta>
```

### `<project>` 属性

| 属性 | 类型 | 说明 |
|-----------|------|-------------|
| `name` | string | 项目名称 |
| `appId` | string | 应用标识符 |
| `resolution` | string | 屏幕分辨率，采用 `WxH` 格式（例如 `454x454`、`480x272`） |
| `minSdk` | string | 最低 SDK 版本 |
| `pixelMode` | string | 像素格式：`RGB565`、`ARGB8888` 等 |

### `<author>` 属性

| 属性 | 类型 | 说明 |
|-----------|------|-------------|
| `name` | string | 作者姓名 |
| `email` | string | 作者邮箱 |

---

## 3. 视图部分

`<view>` 节点包含 UI 组件树。顶层子元素通常是表示不同屏幕/页面的 `hg_view` 容器。

```xml
<view>
    <hg_view id="view_home" x="0" y="0" width="454" height="454" entry="true">
        <hg_label id="lbl1" x="10" y="10" width="100" height="24" text="Hello" />
    </hg_view>
    <hg_view id="view_settings" x="0" y="0" width="454" height="454">
        <!-- another screen -->
    </hg_view>
</view>
```

`<view>` 内的组件在序列化时按 `zIndex` 排序。

---

## 4. 通用属性

所有组件都支持以下基础属性：

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `id` | string | 自动生成 | 全局唯一的组件标识符 |
| `name` | string | 与 `id` 相同 | 显示名称（用于设计器 UI） |
| `x` | int | 0 | 相对于父元素的 X 坐标 |
| `y` | int | 0 | 相对于父元素的 Y 坐标 |
| `width` | int | 100 | 宽度（像素） |
| `height` | int | 40 | 高度（像素） |
| `visible` | boolean | true | 可见性标志 |
| `enabled` | boolean | true | 交互启用标志 |
| `locked` | boolean | false | 在设计器中锁定（防止拖动） |
| `zIndex` | int | 0 | 堆叠顺序 — 值越大渲染越靠上 |
| `showOverflow` | boolean | false | 在设计器中显示溢出内容 |

> **ID 命名约定**：使用小写字母加下划线，例如 `btn_menu`、`lbl_time`、`img_bg`。

---

## 5. 组件分类与嵌套规则

### 所有组件类型 — 引擎矩阵

状态图例：✅ 就绪 · ❌ 不支持（请勿使用）。
**事实来源 = 代码**（参见上文的引擎支持模型）。本矩阵是
commit `340bc18`（2026-06-15）从 `engineSupport` 重新生成的快照。

| 类别 | 标签 | HoneyGUI | LVGL |
|----------|-----|----------|------|
| **容器** | `hg_view` | ✅ | ✅ |
| | `hg_window` | ✅ | ✅ |
| | `hg_list` | ✅ | ✅ |
| | `hg_list_item` | ✅ | ✅ |
| | `hg_menu_cellular` | ✅ | ❌ |
| **基础** | `hg_button` | ✅ | ✅ |
| | `hg_label` | ✅ | ✅ |
| | `hg_time_label` | ✅ | ✅ |
| | `hg_timer_label` | ✅ | ✅ |
| | `hg_image` | ✅ | ✅ |
| **输入**（仅 LVGL） | `hg_input` | ❌ | ✅ |
| | `hg_checkbox` | ❌ | ✅ |
| | `hg_radio` | ❌ | ✅ |
| | `hg_switch` | ❌ | ✅ |
| | `hg_slider` | ❌ | ✅ |
| | `hg_progressbar` | ❌ | ✅ |
| **图形** | `hg_arc` | ✅ | ✅ |
| | `hg_circle` | ✅ | ✅ |
| | `hg_rect` | ✅ | ✅ |
| | `hg_progress` | ✅ | ❌ |
| | `hg_svg` | ✅ | ✅ |
| | `hg_qbcode` | ✅ | ✅ |
| | `hg_glass` | ✅ | ❌ |
| | `hg_particle` | ✅ | ❌ |
| **多媒体** | `hg_image`（见基础） | ✅ | ✅ |
| | `hg_gif` | ✅ | ✅ |
| | `hg_video` | ✅ | ❌ |
| | `hg_lottie` | ✅ | ✅ |
| | `hg_3d` | ✅ | ❌ |
| **不支持** | `hg_canvas` | ❌ | ❌ |

> **不存在（切勿使用）：** `hg_container`、`hg_grid`、`hg_tab` — 两个 codegen
> 注册表中都没有。如果需要布局，请使用 `hg_view` / `hg_window` / `hg_list`。

> **各引擎提醒：**
> - **HoneyGUI 项目** 不得使用 ❌ 输入族（`hg_input`/`hg_checkbox`/`hg_radio`/
>   `hg_switch`/`hg_slider`/`hg_progressbar`），也不得使用 `hg_canvas` — 两个引擎均不支持。
> - **LVGL 项目** 不得使用 `hg_video`/`hg_3d`（unsupported），也不得使用 ❌ 仅 HoneyGUI 的组件
>   （`hg_glass`/`hg_particle`）以及 `hg_menu_cellular`。

### 嵌套规则（关键）

1. **只有容器**（`hg_view`、`hg_window`、`hg_list`、`hg_list_item`）**才能容纳子组件**。
2. **非容器控件必须是某个容器的子元素** — 它们不能作为 `<view>` 的直接子元素出现。
3. **非容器控件不能拥有子组件**。
4. `hg_list` 的子元素应当是 `hg_list_item` 元素。
5. `hg_list_item` 可以包含任意非容器控件。

### 有效树示例

```
<view>
  └─ hg_view (container)
       ├─ hg_label (leaf)
       ├─ hg_image (leaf)
       └─ hg_window (nested container)
            └─ hg_label (leaf)
```



---

## 6. 容器组件

### 6.1 `hg_view` — 视图容器

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

代表完整屏幕/页面的主要顶层容器。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `entry` | boolean | false | 入口视图——应用启动时显示的第一个屏幕。应当恰好有一个视图设置 `entry="true"` |
| `backgroundColor` | color | #000000 | 背景颜色 |
| `borderRadius` | number | 20 | 边框圆角 |
| `padding` | number | 12 | 内边距 |
| `overflow` | enum | auto | `auto` / `hidden` / `scroll` |
| `residentMemory` | boolean | — | 切换离开时保留在内存中 |
| `animateStep` | number | height/10 | 动画步进值 |
| `opacity` | number | 255 | 不透明度（0–255） |

- **默认尺寸**: 350×250
- **C API**: `GUI_VIEW_INSTANCE` 宏

### 6.2 `hg_window` — 窗口容器

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

带可选背景和模糊效果的窗口容器。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `showBackground` | boolean | false | 显示背景填充 |
| `backgroundColor` | color | #808080 | 背景颜色 |
| `enableBlur` | boolean | false | 启用模糊效果 |
| `blurDegree` | number | 225 | 模糊强度 |

- **默认尺寸**: 450×350
- **C API**: `gui_win_create`



### 6.4 `hg_list` — 列表容器

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

支持多种布局样式的可滚动列表。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `itemWidth` | number | 100 | 列表项宽度 |
| `itemHeight` | number | 100 | 列表项高度 |
| `space` | number | 5 | 列表项间距 |
| `direction` | enum | VERTICAL | `VERTICAL` / `HORIZONTAL` |
| `style` | enum | LIST_CLASSIC | 列表样式（见下表） |
| `cardStackLocation` | number | 0 | 卡片堆叠位置 |
| `circleRadius` | number | — | 圆形布局半径（自动计算） |
| `noteNum` | number | 5 | 可见列表项数量 |
| `autoAlign` | boolean | true | 自动对齐到最近的列表项 |
| `inertia` | boolean | true | 惯性滚动 |
| `loop` | boolean | false | 循环滚动 |
| `createBar` | boolean | false | 显示滚动条 |
| `enableAreaDisplay` | boolean | false | 启用区域显示 |
| `keepNoteAlive` | boolean | false | 保持列表项存活 |
| `offset` | number | 0 | 偏移量 |
| `outScope` | number | 0 | 超出范围 |
| `useUserNoteDesign` | boolean | — | 使用自定义列表项设计 |
| `userNoteDesignFunc` | string | — | 自定义设计函数名 |

**列表 `style` 取值**:

| 取值 | 说明 |
|-------|-------------|
| `LIST_CLASSIC` | 经典纵向/横向列表 |
| `LIST_CIRCLE` | 圆形布局 |
| `LIST_ZOOM` | 缩放列表 |
| `LIST_CARD` | 卡片堆叠 |
| `LIST_FADE` | 淡入/淡出 |
| `LIST_FAN` | 扇形布局 |
| `LIST_HELIX` | 螺旋布局 |
| `LIST_CURL` | 卷曲效果 |

> **引擎说明（LVGL）：** 仅支持 `LIST_CLASSIC`。任何非经典 `style`
> （`LIST_CIRCLE`/`LIST_ZOOM`/`LIST_CARD`/`LIST_FADE`/`LIST_FAN`/`LIST_HELIX`/`LIST_CURL`）都会
> **降级为经典 `lv_list`**，并附带 `/* TODO(lvgl) */` 注释。为保证 HML 的可移植性，
> 除非项目面向 HoneyGUI，否则优先使用 `LIST_CLASSIC`。

- **默认尺寸**: 300×400
- **C API（HoneyGUI）**: `gui_list_create` · **C API（LVGL）**: `lv_list_create`

### 6.5 `hg_list_item` — 列表项

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

`hg_list` 的子元素。组件库中不提供——由列表自动管理。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `index` | number | auto-assigned | 列表项索引（按位置排序） |

### 6.6 `hg_menu_cellular` — 蜂窝菜单

引擎: 仅HoneyGUI（LVGL 暂未实现）
<!-- engine: honeygui=ready lvgl=unsupported -->

六边形滚动菜单。**LVGL 项目：请勿使用（unsupported）。**

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `iconFolder` | string | "" | 图标资源文件夹 |
| `iconSize` | number | 64 | 图标尺寸 |
| `offsetX` | number | 0 | X 偏移 |
| `offsetY` | number | 0 | Y 偏移 |

- **默认尺寸**: 动态（匹配项目分辨率）

### 6.7 `hg_canvas` — 画布（未实现）

引擎: 暂不支持，勿用
<!-- engine: honeygui=unsupported lvgl=unsupported -->

> ⚠️ **两个引擎均不支持——请勿使用。** 请改用 `hg_image` / `hg_rect` / `hg_arc` / `hg_svg` 进行绘制。

---

## 7. 基础控件

### 7.1 `hg_button` — 按钮

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

基于图像的按钮，有两种模式：**Normal**（瞬时按下）和 **Toggle**（自锁开关）。
由于 HoneyGUI SDK 没有原生按钮控件，两种模式在运行时都使用 `gui_img`。

#### 通用属性

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `toggleMode` | boolean | `false` | `false` = Normal 模式，`true` = Toggle 模式 |
| `imageOn` | string | — | Normal：按下/高亮图像；Toggle：ON 状态图像 |
| `imageOff` | string | — | Normal：默认图像；Toggle：OFF 状态图像 |
| `enabled` | boolean | `true` | 启用/禁用用户交互 |

#### 普通模式属性 (toggleMode=false)

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `clickCallback` | string | `""` | 松开（点击）时调用的 C 函数 |

**行为**：按下 → 显示 `imageOn`；松开 → 显示 `imageOff` + 调用 `clickCallback`。

**生成的 C 事件**：`GUI_EVENT_TOUCH_PRESSED` + `GUI_EVENT_TOUCH_RELEASED`。

#### 切换模式属性 (toggleMode=true)

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `initialState` | `"on"` \| `"off"` | `"off"` | 初始切换状态 |
| `onCallback` | string | `""` | 进入 ON 状态时调用的 C 函数 |
| `offCallback` | string | `""` | 进入 OFF 状态时调用的 C 函数 |

**行为**：点击 → 永久切换状态；相应显示 `imageOn`/`imageOff`。

**生成的 C 事件**：`GUI_EVENT_TOUCH_CLICKED`。

**状态管理函数**：`bool {id}_get_state(void)`、`void {id}_set_state(bool state)`。

#### 示例

```xml
<!-- Normal button: press highlight, release restore -->
<hg_button id="btn_ok" x="100" y="200" width="120" height="48"
  imageOn="assets/btn_ok_pressed.png" imageOff="assets/btn_ok_default.png"
  clickCallback="on_btn_ok_click" />

<!-- Toggle button: click to switch on/off -->
<hg_button id="btn_power" x="100" y="200" width="80" height="80"
  toggleMode="true" initialState="off"
  imageOn="assets/power_on.png" imageOff="assets/power_off.png"
  onCallback="power_on_handler" offCallback="power_off_handler" />
```



### 7.2 `hg_label` — 文本标签

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

带可选滚动和定时器功能的文本显示。

fallback：如果 assets 文件夹中没有字体文件，则将 fallback 文件夹中的字体文件复制到 assets 文件夹，并使用这些 fallback 字体文件。

#### 文本与布局

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `text` | string | "Label" | 显示文本 |
| `i18nKey` | string | — | 可选的项目字符串 key，从 `i18n/strings.json` 解析，同时用于 Designer 多语言预览和代码生成（取 `catalog.activeLocale`，缺失时回退 `defaultLocale`）。key/翻译都缺失时最终回退 `text`。 |
| `hAlign` | enum | LEFT | 水平对齐：`LEFT` / `CENTER` / `RIGHT` |
| `vAlign` | enum | TOP | 垂直对齐：`TOP` / `MID` / `BOTTOM`。`BOTTOM` 把最后一行贴到控件底边，文本高于控件时裁掉顶部；映射为 HoneyGUI 的 `BOT_*` / `MULTI_BOT_*`，LVGL 工程不提供该选项（回退为 `TOP`）。 |
| `color` | color | #ffffff | 文本颜色 |
| `letterSpacing` | number | 0 | 字间距 |
| `lineSpacing` | number | 0 | 行间距 |
| `wordWrap` | boolean | false | 自动换行 |
| `wordBreak` | boolean | false | 在单词内断行 |

#### 项目多语言预览

Designer 可从项目级 catalog `i18n/strings.json` 解析 `hg_label` 的预览文本：

```json
{
  "version": 1,
  "defaultLocale": "en-US",
  "locales": ["en-US", "zh-CN"],
  "activeLocale": "zh-CN",
  "strings": {
    "pairing.scan_code": {
      "en-US": "Scan code pairing",
      "zh-CN": "扫码配对"
    }
  }
}
```

`activeLocale` 是项目当前选中的语言，Designer 里的"预览语言"下拉框切换时会写入这个字段；它同时驱动画布预览和静态文本代码生成。取值必须在 `locales` 里，缺失或非法时回退 `defaultLocale`。

预览解析顺序：

1. `catalog.strings[i18nKey][catalog.activeLocale]`
2. `catalog.strings[i18nKey][catalog.defaultLocale]`
3. `text`
4. 组件名称

由于 catalog 优先于 `text`，一旦某 label 的 `i18nKey` 在 catalog 里解析到条目，改它的 `text` 属性就没有任何可见效果（预览和 codegen 都会忽略）。要改显示的文案，请改 catalog 里对应的翻译条目——或者清空/改指 `i18nKey`。

`i18nKey` 同时用于 Designer 编辑、PC 预览和静态文本代码生成，但本阶段仍不生成固件运行时语言切换逻辑，也不生成 C 语言表——codegen 每次仍然只按 `activeLocale` 生成一份固定语言的字符串常量，不是运行时可切换的多语言表。`text` 作为 catalog 缺失 key/翻译时的最终 fallback。

`i18nKey` 仅对 `hg_label` 生效。写在 `hg_time_label`、`hg_timer_label` 或其他任何组件上会被解析并保留，但永不本地化——codegen 不翻译，多语言管理器也不收录。

当一个 label 混排静态标签与动态数值（如 `Trip: 126.5 km`）时，不要把数值烤进单个翻译——`i18nKey` 没有占位符插值，数值会被当作固定字面量生成。请拆分：静态标签放在带 `i18nKey` 的 label 上，动态数值用另一个由 `characterSets` 驱动的 label 渲染（数字、单位、日期等运行时文本属于 `characterSets`，不进 catalog）。

对于多页面项目，请优先使用 Designer 多语言管理器，而不是逐个选中 label 编辑。管理器会扫描 `ui/*.hml`，列出所有 `i18nKey` 引用、每种语言的缺失翻译，以及尚未绑定 key 的 `hg_label text`。属性面板仍作为单个 label 的快速编辑入口。

字体转换会自动把 HML 中实际引用的 `i18nKey` 文本合并到对应字体组：同一个 `fontFile + fontSize + fontType + renderMode` 只收集使用该字体组的 label 翻译字符。不要把这份自动字符集写入每个组件的 `characterSets`。`characterSets` 仍用于补充运行时动态文本，例如日期、数字、单位、接口返回内容或用户输入。

代码生成会在生成静态 UI 文本时优先使用 `i18n/strings.json` 中 `activeLocale` 对应的翻译，缺失时回退 `defaultLocale`，两者都为空或 key 不存在时再回退到 HML `text`。本阶段仍不生成固件运行时语言切换逻辑，也不生成 C 语言表——每次生成仍然是某一种固定语言的静态字符串。

V202S 配对界面示例：

```xml
<hg_label id="asm_scan_text" x="40" y="110" width="280" height="40"
          text="Scan code pairing" i18nKey="pairing.scan_code"
          fontFile="/font/Arial.ttf" fontSize="22" hAlign="CENTER" vAlign="MID" />
```

#### 字体

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `fontFile` | string | — | 字体文件路径（相对于 assets） |
| `fontSize` | number | 16 | 字体大小（像素） |
| `fontType` | enum | bitmap | `bitmap` / `vector` |
| `renderMode` | enum | 4 | 抗锯齿位数：`1` / `2` / `4` / `8` |

#### 渐变填充

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `useGradient` | boolean | false | 启用线性渐变填充 |
| `gradientDirection` | enum | horizontal | `horizontal` / `vertical` / `diagonal_tl_br` / `diagonal_tr_bl` |
| `gradientBox` | enum | layout | 渐变铺满的参照框：`layout`（字宽 × 行高）/ `ink`（字形墨迹包围盒）/ `widget`（控件矩形） |
| `gradientStops` | JSON 数组 | — | 色标 `[{"position":0,"color":"#ff2020"},{"position":1,"color":"#4060ff"}]`，`position` 取 0–1，2–8 个 |

- 仅 HoneyGUI 引擎、`fontType="vector"` 时生效；点阵字体、LVGL 工程保持 `color` 纯色。
- 设备上缩放或旋转的文本、emoji 也回退为 `color`，因此 `color` 仍需设置。
- 渐变只替换文字 RGB，控件透明度仍然叠加。
- 滚动文本：`layout` / `ink` 渐变随文字移动，`widget` 渐变固定在控件上。
- `hg_time_label` 与 `hg_timer_label` 同样支持；推荐保持 `layout`，避免 `ink` 随数字字形宽度跳动。

```xml
<hg_label id="title" x="20" y="20" width="200" height="40" text="HoneyGUI"
          fontFile="/NotoSansSC-Medium.ttf" fontType="vector" fontSize="32"
          useGradient="true" gradientDirection="horizontal" gradientBox="layout"
          gradientStops='[{"position":0,"color":"#ff2020"},{"position":1,"color":"#4060ff"}]' />
```

#### 滚动文本

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `scrollDirection` | enum | horizontal | `horizontal` / `vertical` |
| `scrollReverse` | boolean | false | 反向滚动 |
| `scrollStartOffset` | number | 0 | 起始偏移 |
| `scrollEndOffset` | number | 0 | 结束偏移 |
| `scrollInterval` | number | 3000 | 滚动间隔（毫秒） |
| `scrollDuration` | number | 0 | 滚动持续时间（毫秒） |

#### 定时器标签模式

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `isTimerLabel` | boolean | false | 启用定时器标签模式 |
| `timerType` | enum | stopwatch | `stopwatch`（正计时）/ `countdown`（倒计时） |
| `timerInitialValue` | number | 0 | 初始值（秒） |
| `timerFormat` | enum | HH:MM:SS | `HH:MM:SS` / `MM:SS` / `MM:SS:MS` / `SS` |
| `timerAutoStart` | boolean | true | 自动启动定时器 |

- **默认尺寸**：100×24
- **C API**：`gui_text_create` / `gui_scroll_text_create`

### 7.3 `hg_time_label` — 实时时钟标签

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

显示当前系统时间。继承所有 `hg_label` 的字体和对齐属性。

fallback：如果 assets 文件夹中没有字体文件，则将 fallback 文件夹中的字体文件复制到 assets 文件夹，并使用这些 fallback 字体文件。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `text` | string | "" | 静态文本（被时间显示覆盖） |
| `timeFormat` | enum | HH:mm:ss | 时间格式（见下表） |

**`timeFormat` 取值**：

| 格式 | 输出示例 |
|--------|----------------|
| `HH:mm:ss` | 14:30:05 |
| `HH:mm` | 14:30 |
| `HH` | 14 |
| `mm` | 30 |
| `HH:mm-split` | 分别显示小时和分钟 |
| `YYYY-MM-DD` | 2026-04-03 |
| `YYYY-MM-DD HH:mm:ss` | 2026-04-03 14:30:05 |
| `MM-DD HH:mm` | 04-03 14:30 |

- **默认尺寸**：120×24

### 7.4 `hg_timer_label` — 定时器标签

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

类似带定时器模式的 `hg_label`，但默认**不**自动启动。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| *(继承所有 hg_label 定时器属性)* | | | |
| `timerAutoStart` | boolean | **false** | 不自动启动（与 hg_label 不同） |

- **默认尺寸**：120×24

### 7.5 `hg_image` — 图像

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

支持变换和混合模式的图像显示。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `src` | string | — | 图像文件路径（相对于 assets） |
| `blendMode` | string | — | 混合模式（见下文） |
| `fgColor` | string | — | A8 模式的前景重着色（格式：`0xFFRRGGBB`） |
| `bgColor` | string | — | A8 BGFG 模式的背景色 |
| `highQuality` | boolean | false | 高质量渲染 |
| `needClip` | boolean | false | 启用裁剪 |
| `assetFormat` | string | `A8` | A8 混合模式的 alpha 格式：`A8`（8 位，256 级）、`A4`（4 位，16 级）、`A2`（2 位，4 级）、`A1`（1 位，2 级）。仅当 `blendMode` 为 `IMG_2D_SW_FIX_A8_FG` 或 `IMG_2D_SW_FIX_A8_BGFG` 时生效 |
| `transform` | JSON | — | 变换对象（见下文） |

**`blendMode` 取值**：

| 取值 | 说明 |
|-------|-------------|
| `IMG_BYPASS_MODE` | 直接像素复制（绕过 alpha 混合，像素直接写入渲染缓冲区） |
| `IMG_FILTER_BLACK` | 黑色滤除（默认，渲染时跳过黑色像素） |
| `IMG_SRC_OVER_MODE` | source-over alpha 合成：S × Sa + D × (1 − Sa) |
| `IMG_COVER_MODE` | 完全覆盖混合模式 |
| `IMG_RECT` | 矩形渲染模式 |
| `IMG_2D_SW_RGB565_ONLY` | 仅软件 RGB565 渲染 |
| `IMG_2D_SW_SRC_OVER_MODE` | 软件 source-over alpha 合成 |
| `IMG_2D_SW_FIX_A8_FG` | 带前景色的 A8 格式（需要 `fgColor`） |
| `IMG_2D_SW_FIX_A8_BGFG` | 带前景 + 背景色的 A8 格式（需要 `fgColor` 和 `bgColor`） |

**`transform` 对象**（JSON）：

| 属性 | 类型 | 默认值 | 说明 |
|----------|------|---------|-------------|
| `scaleX` | number | 1.0 | X 轴缩放 |
| `scaleY` | number | 1.0 | Y 轴缩放 |
| `rotation` | number | 0 | 旋转角度（度） |
| `translateX` | number | 0 | X 平移 |
| `translateY` | number | 0 | Y 平移 |
| `skewX` | number | 0 | X 倾斜（度） |
| `skewY` | number | 0 | Y 倾斜（度） |
| `focusX` | number | — | 变换原点 X |
| `focusY` | number | — | 变换原点 Y |
| `opacity` | number | 255 | 不透明度（0–255） |

- **默认尺寸**：150×150
- **C API**：`gui_img_create_from_fs`

---

### 7.6 `hg_gif` — GIF 动画

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

直接显示动画 GIF 文件（无格式转换；原始 GIF 数据打包进 `.bin`）。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `src` | string | — | GIF 文件路径（相对于 assets，例如 `assets/anim.gif`） |

- **默认尺寸**：100×100
- **C API**：`gui_gif_create_from_fs`，头文件：`gui_gif.h`
- `.gif` 源文件在构建时原样打包进 `.bin` 文件。

---

### 7.7 `hg_video` — 视频

引擎: 仅HoneyGUI（LVGL 暂未实现）
<!-- engine: honeygui=ready lvgl=unsupported -->

使用 HoneyGUI 视频 API（标准或 Lite Video）播放视频文件。
**LVGL 项目：请勿使用（unsupported）。** `useMsv1` Lite Video 模式**仅限 HoneyGUI**。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `src` | string | — | 视频文件路径（相对于 assets，例如 `assets/clip.mp4`） |
| `frameRate` | number | 30 | 播放帧率（FPS） |
| `autoPlay` | boolean | true | 创建后自动开始播放 |
| `loop` | boolean | false | 无限循环播放 |
| `useMsv1` | boolean | false | 使用 `gui_lite_video` 控件播放 AVI（MSV1 或 Cinepak） |

**`useMsv1` 说明**（Lite Video 模式）：
- 为 `true` 时，生成 `gui_lite_video_create_from_fs()` 和 `gui_lite_video_*` setter；添加 `#include "gui_lite_video.h"`。
- 视频资源**必须**转换为 AVI-MSV1 或 AVI-Cinepak 格式（在 Assets 面板的视频格式下拉框中设置 `MSV1` 或 `Cinepak`）。
- `gui_lite_video` 控件从 AVI 头部自动检测编解码器（MSV1 或 Cinepak）——无需应用层选择编解码器。
- AVI-MSV1 约束：`msvideo1` 编解码器，`rgb555le` 像素格式，宽/高必须为 4 的倍数。
- AVI-Cinepak 约束：`cinepak` 编解码器，`rgb24` 像素格式，宽/高必须为 4 的倍数。

- **默认尺寸**：200×200
- **C API（标准）**：`gui_video_create_from_fs`，头文件：`gui_video.h`
- **C API（Lite Video）**：`gui_lite_video_create_from_fs`，头文件：`gui_lite_video.h`

---

## 8. 输入控件（仅 LVGL）

> ⚠️ **本节所有组件均为 `仅LVGL`。** 它们在 HoneyGUI 上属于 `unsupported` 状态 ——
> **HoneyGUI 项目不得使用**。仅当
> `project.json` → `targetEngine` 为 `lvgl` 时才可使用。

### 8.1 `hg_input` — 文本输入

引擎: 仅LVGL
<!-- engine: honeygui=unsupported lvgl=ready -->

单行文本输入框。**HoneyGUI 项目：请勿使用（unsupported）。**

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `placeholder` | string | — | 为空时显示的占位提示文本 |

- **默认尺寸**：200×32
- **C API (LVGL)**：`lv_textarea_create`

### 8.2 `hg_checkbox` — 复选框

引擎: 仅LVGL
<!-- engine: honeygui=unsupported lvgl=ready -->

带标签的复选框。**HoneyGUI 项目：请勿使用（unsupported）。** 继承自 `hg_label` 的文本/字体属性
（`text`、`color`、`fontFile`、`fontSize`、`fontType`、`renderMode`）。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `text` | string | "Checkbox" | 标签文本 |
| `value` | boolean | false | 勾选状态 |

- **默认尺寸**：120×24
- **C API (LVGL)**：`lv_checkbox_create`

### 8.3 `hg_radio` — 单选按钮

引擎: 仅LVGL
<!-- engine: honeygui=unsupported lvgl=ready -->

单选项（同组内互斥）。**HoneyGUI 项目：请勿使用（unsupported）。**
继承自 `hg_label` 的文本/字体属性。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `text` | string | "Option" | 标签文本 |
| `value` | boolean | false | 勾选状态 |

- **默认尺寸**：120×24
- **C API (LVGL)**：`lv_checkbox_create`（单选样式）

### 8.4 `hg_switch` — 开关

引擎: 仅LVGL
<!-- engine: honeygui=unsupported lvgl=ready -->

开/关切换开关。**HoneyGUI 项目：请勿使用（unsupported）。**

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `value` | boolean | false | 开/关状态 |

- **默认尺寸**：50×28
- **C API (LVGL)**：`lv_switch_create`

### 8.5 `hg_slider` — 滑块

引擎: 仅LVGL
<!-- engine: honeygui=unsupported lvgl=ready -->

可拖动的数值滑块。**HoneyGUI 项目：请勿使用（unsupported）。**

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `value` | number | 0 | 当前值 |
| `min` | number | 0 | 最小值 |
| `max` | number | 100 | 最大值 |

- **默认尺寸**：200×20
- **C API (LVGL)**：`lv_slider_create`

### 8.6 `hg_progressbar` — 进度条

引擎: 仅LVGL
<!-- engine: honeygui=unsupported lvgl=ready -->

进度指示条。**HoneyGUI 项目：请勿使用（unsupported）。**

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `value` | number | 0 | 当前值 |
| `min` | number | 0 | 最小值 |
| `max` | number | 100 | 最大值 |
| `color` | color | #00FF00 | 进度条（指示器）颜色 |
| `backgroundColor` | color | #333333 | 轨道颜色 |
| `orientation` | enum | horizontal | `horizontal` / `vertical` |

- **默认尺寸**：200×20
- **C API (LVGL)**：`lv_bar_create`

---

## 9. 图形控件

### 9.1 `hg_arc` — 弧形

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

| 属性 | 类型 | 默认值 | 范围 | 说明 |
|-----------|------|---------|-------|-------------|
| `radius` | number | 40 | ≥ 0 | 弧形半径 |
| `startAngle` | number | 0 | — | 起始角度（度） |
| `endAngle` | number | 270 | — | 结束角度（度） |
| `strokeWidth` | number | 8 | ≥ 0 | 描边宽度 |
| `color` | color | #007acc | — | 弧形颜色 |
| `opacity` | number | 255 | 0–255 | 不透明度 |
| `useGradient` | boolean | false | — | 启用渐变 |
| `arcGroup` | string | "" | — | 弧形组标识符（用于将多个弧形分组） |

- **默认尺寸**：96×96
- **C API**：`gui_arc_create`

### 9.2 `hg_circle` — 圆形

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `radius` | number | 40 | 圆形半径 |
| `fillColor` | color | #007acc | 填充颜色 |
| `opacity` | number | 255 | 不透明度（0–255） |
| `useGradient` | boolean | false | 启用渐变 |
| `gradientType` | enum | radial | `radial` / `angular` |


- **默认尺寸**：80×80
- **C API**：`gui_circle_create`

### 9.3 `hg_rect` — 矩形

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `borderRadius` | number | 0 | 圆角半径 |
| `fillColor` | color | #007acc | 填充颜色 |
| `opacity` | number | 255 | 不透明度（0–255） |
| `useGradient` | boolean | false | 启用渐变 |
| `gradientDirection` | enum | horizontal | `horizontal` / `vertical` / `diagonal_tl_br` / `diagonal_tr_bl` |

> `hg_rect` 同样支持与 `hg_circle` 相同的**按钮模式**属性。

- **默认尺寸**：120×80
- **C API**：`gui_rect_create`


### 9.4 `hg_qbcode` — 二维码/条形码

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->
> LVGL：`qrcode` → `lv_qrcode`，`barcode` → `lv_barcode`。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `codeType` | enum | qrcode | `qrcode` / `barcode` |
| `displayMode` | enum | section | `section`（实时绘制） / `image`（预渲染到 psRAM） |
| `encodeMode` | enum | text | `text` / `binary`（仅二维码；条形码始终使用 text） |
| `codeContent` | string | "" | 要编码的文本/数据 |
| `borderSize` | number | 2 | 码周围的白色边框留白（单位） |

- **默认尺寸**：200×200（二维码）；条形码请使用更宽的宽高比（如 300×100）
- **C API**：`gui_qbcode_create` + `gui_qbcode_config` — `gui_qbcode.h`
- **注意**：
  - `section` 模式每帧直接渲染到帧缓冲区；`image` 模式只预渲染一次到 psRAM（性能更好）
  - 二维码始终为黑底白字；无颜色配置
  - `gui_qbcode_config` 中的 `data_len` 会自动设置为 `strlen(codeContent)`

### 9.5 `hg_svg` — SVG 矢量图

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

渲染矢量 `.svg` 文件。运行时按文件路径加载（无需 C 数组转换）。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `src` | string | — | SVG 文件路径（相对于 assets，必须以 `/` 开头） |

- **默认尺寸**：100×100
- **C API (HoneyGUI)**：`gui_svg_create_from_file`
- **C API (LVGL)**：`lv_image_create` + `lv_image_set_src`（需要 `LV_USE_SVG` / ThorVG）

### 9.6 `hg_glass` — 玻璃效果

引擎: 仅HoneyGUI
<!-- engine: honeygui=ready lvgl=unsupported -->
> **LVGL 项目：请勿使用（unsupported）。**

由形状蒙版构建的折射“玻璃”叠加层。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `src` | string | — | 形状蒙版文件路径（相对于 assets） |
| `distortion` | number | 10 | 扭曲强度（%） |
| `region` | number | 50 | 效果范围（%） |
| `movable` | boolean | false | 允许拖动玻璃 |
| `click` | boolean | false | 启用点击交互 |

- **默认尺寸**：150×150
- **C API**：`gui_glass_create_from_fs`

### 9.7 `hg_particle` — 粒子效果

引擎: 仅HoneyGUI
<!-- engine: honeygui=ready lvgl=unsupported -->
> **LVGL 项目：请勿使用（unsupported）。**

预设的粒子动画（雪花等）。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `particleEffect` | enum | snow | 效果类型（预设名称，如 `snow`） |

- **默认尺寸**：200×200
- **C API**：`effect_{particleEffect}_create`（如 `effect_snow_create`）

---

## 10. 多媒体控件

> `hg_image`（§7.5）、`hg_gif`（§7.6）和 `hg_video`（§7.7）已在基础控件中说明。
> 下面的动画/3D 组件补全了多媒体控件集。

### 10.1 `hg_lottie` — Lottie 动画

引擎: ✓HoneyGUI ✓LVGL
<!-- engine: honeygui=ready lvgl=ready -->

播放 Lottie（矢量 JSON）动画。

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `src` | string | — | 动画文件路径（相对于 assets） |
| `autoplay` | boolean | true | 自动开始播放 |
| `loop` | boolean | true | 循环播放 |

- **默认尺寸**：150×150
- **C API (HoneyGUI)**: `gui_lottie_create_from_file`
- **C API (LVGL)**: `lv_lottie_create`

### 10.2 `hg_3d` — 3D 模型

引擎: 仅HoneyGUI（LVGL 暂未实现）
<!-- engine: honeygui=ready lvgl=unsupported -->

渲染带相机和变换控制的 3D 模型。
**LVGL 项目：请勿使用（unsupported）。**

| 属性 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `modelPath` | string | — | 模型文件路径（相对于 assets） |
| `drawType` | enum | L3_DRAW_FRONT_AND_SORT | `L3_DRAW_FRONT_ONLY` / `L3_DRAW_FRONT_AND_BACK` / `L3_DRAW_FRONT_AND_SORT` |
| `worldX` / `worldY` / `worldZ` | number | 0 / 0 / 30 | 世界坐标位置 |
| `rotationX` / `rotationY` / `rotationZ` | number | 0 | 旋转（角度） |
| `scale` | number | 5 | 模型缩放 |
| `cameraPosX` / `cameraPosY` / `cameraPosZ` | number | 0 | 相机位置 |
| `cameraLookX` / `cameraLookY` / `cameraLookZ` | number | 0 / 0 / 1 | 相机注视目标 |

- **默认尺寸**：400×400
- **C API (HoneyGUI)**: `gui_lite3d_create`
- **C API (LVGL)**: `lv_gltf_create`（unsupported——不生成）

---

## 11. 事件系统

HML 使用**事件 → 动作**模型。事件声明在任意组件的 `<events>` 子节点内。

### 12.1 XML 语法

```xml
<hg_xxx id="btn1" x="0" y="0" width="100" height="40" text="Go">
    <events>
        <event type="onClick">
            <action type="switchView" target="view2"
                    switchOutStyle="SWITCH_OUT_TO_LEFT_USE_TRANSLATION"
                    switchInStyle="SWITCH_IN_FROM_RIGHT_USE_TRANSLATION" />
        </event>
    </events>
</hg_xxx>
```

支持每个事件包含多个动作，以及每个组件包含多个事件：

```xml
<events>
    <event type="onClick">
        <action type="sendMessage" message="refresh" />
        <action type="callFunction" functionName="on_click_handler" />
    </event>
    <event type="onLongPress">
        <action type="switchView" target="view_settings" />
    </event>
</events>
```

### 12.2 事件类型

| 事件 | 说明 | 额外属性 |
|-------|-------------|------------------|
| `onClick` | 触摸点击 | — |
| `onLongPress` | 触摸长按 | — |
| `onTouchDown` | 触摸按下 | — |
| `onTouchUp` | 触摸释放 | `checkReleaseArea`（可选） |
| `onKeyShortPress` | 按键短按 | `keyName`: `Home`/`Back`/`Menu`/`Power` |
| `onKeyLongPress` | 按键长按 | `keyName`: `Home`/`Back`/`Menu`/`Power` |
| `onSwipeLeft` | 向左滑动 | — |
| `onSwipeRight` | 向右滑动 | — |
| `onSwipeUp` | 向上滑动 | — |
| `onSwipeDown` | 向下滑动 | — |
| `onShow` | 视图显示 | 仅 `hg_view` |
| `onHide` | 视图隐藏 | 仅 `hg_view` |
| `onMessage` | 收到消息 | `message`（消息名称） |

### 12.3 动作类型

| 动作 | 属性 | 说明 |
|--------|------------|-------------|
| `switchView` | `target`, `switchOutStyle`, `switchInStyle` | 带转场切换到目标视图 |
| `sendMessage` | `message` | 向其他组件广播消息 |
| `callFunction` | `functionName` | 调用 C 回调函数 |
| `controlTimer` | `timerTargets` | 控制定时器（JSON 数组） |

**`controlTimer` — `timerTargets` 格式**：

```json
[
    { "componentId": "img1", "timerIndex": 0, "action": "start" },
    { "componentId": "img2", "action": "stop" }
]
```

### 12.4 组件事件支持矩阵

| 组件 | 支持的事件 |
|-----------|-----------------|
| `hg_view` | 全部（click、longPress、touch、key、swipe、lifecycle、message） |
| `hg_button` | click（Normal：通过 press/release；Toggle：通过 clicked） |
| `hg_label` | click、longPress、message |
| `hg_image` | click、longPress、touchDown、touchUp、key、message |


---

## 12. 定时器与动画系统

组件可通过 `timers` 属性（以 JSON 数组字符串存储）拥有由定时器驱动的动画。

**引擎支持：** 两个引擎均消费相同的 `timers` 数据。

- **HoneyGUI** 生成的定时器回调（`gui_obj_create_timer`）在每次回调时按真实经过时间（`gui_ms_get()`）采样动画状态（仅限线性）。
- **LVGL** 将可插值动作转换为原生 `lv_anim` 引擎（多段 → `lv_anim_timeline`），将离散动作转换为帧驱动的 `lv_timer` 回调。参见 §12.4 了解各动作的路由。

缓动在两个引擎上**均仅支持线性** —— 没有每动作缓动属性。

**时间语义（两个引擎一致）：** `duration` 表示真实经过的 wall-clock 时间，`interval`
只是期望的采样频率。HoneyGUI 的对象定时器在 GUI 帧遍历阶段被检查，因此配置为
`interval: 10` 的回调实际可能每帧才执行一次。动画进度是经过时间的纯函数：帧率偏低时
动画会跳过中间视觉帧，但仍在配置的 `duration` 时刻到达终点，不会随渲染开销被拉长。
离散动作在时间轴进入其所属段时触发一次，既不会每帧重复产生副作用，也不会因为一帧
跨过某个短段而被静默丢失。

### 12.1 XML 表示

```xml
<hg_image id="img1" x="0" y="0" width="100" height="100" src="icon.png"
          timers='[{"id":"t1","name":"Rotate","enabled":true,"interval":16,"reload":true,"mode":"preset","segments":[{"duration":3000,"actions":[{"type":"rotation","from":0,"to":360}]}]}]' />
```

### 12.2 TimerConfig 字段

| 字段 | 类型 | 说明 |
|-------|------|-------------|
| `id` | string | 唯一定时器标识符 |
| `name` | string | 显示名称 |
| `enabled` | boolean | 创建时绑定到组件 |
| `runImmediately` | boolean | 在下一轮 GUI 遍历即请求第一次回调，而不是先等一个 `interval` |
| `interval` | number | 期望的采样间隔（毫秒）；只是回调频率的上界，不是动画的时间单位 |
| `reload` | boolean | 循环执行（仅 `custom` 模式有效；`preset` 动画的底层定时器始终重载，由 `stopOnComplete` 决定播放一次还是循环） |
| `mode` | enum | `preset`（内置动作）/ `custom`（C 回调） |
| `actions` | TimerAction[] | 单段动画动作 |
| `segments` | AnimationSegment[] | 多段动画；每段 `duration` 均为真实经过的毫秒数 |
| `callback` | string | 自定义回调函数名（`custom` 模式） |
| `duration` | number | 总时长（真实经过的毫秒数） |
| `stopOnComplete` | boolean | 到达总时长后停在精确终点；为 `false` 时基于最初的时间原点循环 |
| `enableLog` | boolean | 启用调试日志 |

### 12.3 TimerAction 类型

| 类型 | 说明 | LVGL 路由 |
| ------ | ------------- | -------------- |
| `size` | 尺寸动画 | `lv_anim`（插值） |
| `position` | 位置动画 | `lv_anim`（插值） |
| `opacity` | 不透明度动画 | `lv_anim`（插值） |
| `rotation` | 旋转动画 | `lv_anim`（插值，以中心为轴） |
| `scale` | 缩放动画 | `lv_anim`（插值，以中心为轴） |
| `value` | 控件数值动画（`hg_progressbar` / `hg_slider`，**仅 LVGL**）——字段：`fromValue`（默认 0）、`toValue`（默认 100）。映射到 `lv_bar_set_value` / `lv_slider_set_value`，超出控件 `min`/`max` 范围的值会被 LVGL 截断。 | `lv_anim`（插值） |
| `switchView` | 切换到另一个视图 | `lv_screen_load_anim`（参见 §13） |
| `changeImage` | 更换图片源 | `lv_timer`（离散） |
| `imageSequence` | 播放图片序列 | `lv_timer`（离散） |
| `visibility` | 切换可见性 | `lv_timer`（离散） |
| `switchTimer` | 启动/停止另一个定时器 | `lv_timer`（离散） |
| `setFocus` | 设置焦点 | `lv_timer`（离散） |
| `fgColor` | 前景色动画 | `lv_timer`（离散，ARGB 插值） |
| `bgColor` | 背景色动画 | `lv_timer`（离散，ARGB 插值） |

### 12.4 LVGL 动画路由

当 `targetEngine` 为 `lvgl` 时，动作被分为两类：

- **可插值类型**（`position` / `size` / `opacity` / `rotation` / `scale` / `value`）：
  由原生 `lv_anim` 引擎驱动。单段定时器输出自启动的 `lv_anim_t` 块；多段定时器变为
  `lv_anim_timeline`，各段从累计偏移处开始。`position` /
  `size` / `scale` 各自展开为两个标量动画（x+y / w+h / scale_x+scale_y）。
  单位转换：旋转角度 → 0.1°（×10），缩放 `1.0` → `256`，不透明度已为
  0–255。旋转/缩放将 `transform_pivot` 设置为对象中心。
- **离散类型**（`visibility` / `setFocus` / `changeImage` / `imageSequence` /
  `fgColor` / `bgColor` / `switchTimer`）：由帧驱动的 `lv_timer`
  回调驱动，镜像 HoneyGUI 的段计数模型。回调体输出到
  `{design}_lvgl_callbacks.c` 的受保护区域（用户可编辑）。

`reload: false` 让动画运行一次（重复次数 = 1，或离散定时器在完成后暂停）；否则无限重复
（`LV_ANIM_REPEAT_INFINITE`）。LVGL 可插值路径上忽略 `interval` 字段（LVGL 由 `duration`
驱动）；它仍作为离散 `lv_timer` 回调的滴答周期使用。

---

## 13. 视图切换动画

与 `switchView` 动作配合使用的过渡动画。

### 13.1 切出样式

| Style | 说明 |
|-------|-------------|
| `SWITCH_INIT_STATE` | 初始状态 |
| `SWITCH_OUT_NONE_ANIMATION` | 无动画 |
| `SWITCH_OUT_TO_LEFT_USE_TRANSLATION` | 向左滑出 |
| `SWITCH_OUT_TO_RIGHT_USE_TRANSLATION` | 向右滑出 |
| `SWITCH_OUT_TO_TOP_USE_TRANSLATION` | 向上滑出 |
| `SWITCH_OUT_TO_BOTTOM_USE_TRANSLATION` | 向下滑出 |
| `SWITCH_OUT_TO_LEFT_USE_CUBE` | 立方体向左旋出 |
| `SWITCH_OUT_TO_RIGHT_USE_CUBE` | 立方体向右旋出 |
| `SWITCH_OUT_TO_TOP_USE_CUBE` | 立方体向上旋出 |
| `SWITCH_OUT_TO_BOTTOM_USE_CUBE` | 立方体向下旋出 |
| `SWITCH_OUT_TO_LEFT_USE_ROTATE` | 向左旋转 |
| `SWITCH_OUT_TO_RIGHT_USE_ROTATE` | 向右旋转 |
| `SWITCH_OUT_TO_LEFT_USE_REDUCTION` | 向左收缩 |
| `SWITCH_OUT_TO_RIGHT_USE_REDUCTION` | 向右收缩 |
| `SWITCH_OUT_STILL_USE_BLUR` | 静态模糊 |
| `SWITCH_OUT_ANIMATION_FADE` | 淡出 |

### 13.2 切入样式

| Style | 说明 |
|-------|-------------|
| `SWITCH_INIT_STATE` | 初始状态 |
| `SWITCH_IN_NONE_ANIMATION` | 无动画 |
| `SWITCH_IN_FROM_LEFT_USE_TRANSLATION` | 从左滑入 |
| `SWITCH_IN_FROM_RIGHT_USE_TRANSLATION` | 从右滑入 |
| `SWITCH_IN_FROM_TOP_USE_TRANSLATION` | 从上滑入 |
| `SWITCH_IN_FROM_BOTTOM_USE_TRANSLATION` | 从下滑入 |
| `SWITCH_IN_FROM_LEFT_USE_CUBE` | 立方体从左进入 |
| `SWITCH_IN_FROM_RIGHT_USE_CUBE` | 立方体从右进入 |
| `SWITCH_IN_FROM_LEFT_USE_ROTATE` | 从左旋转进入 |
| `SWITCH_IN_FROM_RIGHT_USE_ROTATE` | 从右旋转进入 |
| `SWITCH_IN_FROM_LEFT_USE_REDUCTION` | 从左展开 |
| `SWITCH_IN_FROM_RIGHT_USE_REDUCTION` | 从右展开 |
| `SWITCH_IN_STILL_USE_BLUR` | 静态模糊 |
| `SWITCH_IN_ANIMATION_ZOOM` | 放大进入 |
| `SWITCH_IN_ANIMATION_FADE` | 淡入 |
| `SWITCH_IN_ANIMATION_MOVE_FADE` | 移动 + 淡入 |
| `SWITCH_IN_ANIMATION_MOVE_FROM_RIGHT` | 从右移动进入 |
| `SWITCH_IN_ANIMATION_MOVE_FROM_LEFT` | 从左移动进入 |
| `SWITCH_IN_ANIMATION_BOUNCE_FROM_RIGHT` | 从右弹入 |
| `SWITCH_IN_ANIMATION_ZOOM_FROM_TOP_LEFT` | 从左上角缩放进入 |
| `SWITCH_IN_ANIMATION_ZOOM_FROM_TOP_RIGHT` | 从右上角缩放进入 |
| `SWITCH_IN_ANIMATION_CENTER_ZOOM_FADE` | 居中缩放 + 淡入 |

---

## 14. 代码生成映射

设计器从 HML 生成 C 源代码。创建函数取决于项目的 `targetEngine`。`—` = 该引擎不生成（不支持；请勿使用）。

| HML Tag | HoneyGUI Create Function | LVGL Create Function |
|---------|--------------------------|----------------------|
| `hg_view` | `GUI_VIEW_INSTANCE` macro | (view container) |
| `hg_window` | `gui_win_create` | (window container) |
| `hg_button` | `gui_img_create_from_fs` (image-based) | `lv_button_create` |
| `hg_label` | `gui_text_create` / `gui_scroll_text_create` | `lv_label_create` |
| `hg_time_label` | `gui_text_create` (clock) | `lv_label_create` (clock) |
| `hg_timer_label` | `gui_text_create` (timer) | `lv_label_create` (timer) |
| `hg_image` | `gui_img_create_from_fs` | `lv_image_create` |
| `hg_gif` | `gui_gif_create_from_fs` | `lv_gif_create` |
| `hg_video` | `gui_video_create_from_fs` (or `gui_lite_video_create_from_fs` when `useMsv1=true`) | — (unsupported) |
| `hg_lottie` | `gui_lottie_create_from_file` | `lv_lottie_create` |
| `hg_3d` | `gui_lite3d_create` | — (unsupported) |
| `hg_arc` | `gui_arc_create` | `lv_arc_create` |
| `hg_circle` | `gui_circle_create` | `lv_obj_create` (circle) |
| `hg_rect` | `gui_rect_create` | `lv_obj_create` (rect) |
| `hg_svg` | `gui_svg_create_from_file` | `lv_image_create` (ThorVG) |
| `hg_list` | `gui_list_create` | `lv_list_create` |
| `hg_glass` | `gui_glass_create_from_fs` | — (unsupported) |
| `hg_particle` | `effect_{type}_create` | — (unsupported) |
| `hg_menu_cellular` | custom generator (`gui_menu_cellular.h`) | — (unsupported) |
| `hg_qbcode` | `gui_qbcode_create` + `gui_qbcode_config` | `lv_qrcode_create` / `lv_barcode_create` |
| `hg_input` | — (unsupported) | `lv_textarea_create` |
| `hg_checkbox` | — (unsupported) | `lv_checkbox_create` |
| `hg_radio` | — (unsupported) | `lv_checkbox_create` (radio) |
| `hg_switch` | — (unsupported) | `lv_switch_create` |
| `hg_slider` | — (unsupported) | `lv_slider_create` |
| `hg_progressbar` | — (unsupported) | `lv_bar_create` |
| `hg_canvas` | — (unsupported) | — (unsupported) |

### 生成的文件结构

```
src/
├── ui/
│   ├── {name}_ui.h          # Overwritten on each code generation
│   └── {name}_ui.c          # Overwritten on each code generation
├── callbacks/
│   ├── {name}_callbacks.h    # Auto-extracted declarations
│   └── {name}_callbacks.c    # Protected regions — user code preserved
├── user/
│   ├── {name}_user.h         # Generated once only — never overwritten
│   └── {name}_user.c         # Generated once only — never overwritten
└── SConscript                # Build script (auto-generated)
```

**受保护区域语法**（位于 `*_callbacks.c` 中）：

```c
/* USER CODE BEGIN callback_name */
// User code here is preserved across regeneration
/* USER CODE END callback_name */
```

---

## 15. 示例

### 15.1 智能手表主屏幕

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hml>
    <meta>
        <project name="SmartWatch" appId="com.example.smartwatch"
                 resolution="454x454" pixelMode="RGB565" />
        <author name="Developer" email="dev@example.com" />
    </meta>
    <view>
        <!-- Home screen -->
        <hg_view id="view_home" x="0" y="0" width="454" height="454"
                 entry="true" backgroundColor="#000000" zIndex="0">

            <!-- Background image -->
            <hg_image id="img_bg" x="0" y="0" width="454" height="454"
                      src="assets/watchface_bg.png" zIndex="0" />

            <!-- Time display -->
            <hg_time_label id="lbl_time" x="127" y="160" width="200" height="70"
                           timeFormat="HH:mm" fontSize="56" color="#FFFFFF"
                           hAlign="CENTER" fontFile="roboto_56.bin" zIndex="1" />

            <!-- Date display -->
            <hg_time_label id="lbl_date" x="152" y="230" width="150" height="30"
                           timeFormat="MM-DD HH:mm" fontSize="18" color="#AAAAAA"
                           hAlign="CENTER" fontFile="roboto_18.bin" zIndex="2" />

            <!-- Steps arc -->
            <hg_arc id="arc_steps" x="179" y="300" width="96" height="96"
                    radius="40" startAngle="0" endAngle="270"
                    strokeWidth="8" color="#4CAF50" zIndex="3" />


        </hg_view>

        <!-- Menu screen -->
        <hg_view id="view_menu" x="0" y="0" width="454" height="454"
                 backgroundColor="#1a1a1a" zIndex="1">



            <hg_list id="list_menu" x="20" y="60" width="414" height="380"
                     direction="VERTICAL" style="LIST_CLASSIC"
                     itemWidth="414" itemHeight="80" space="10"
                     noteNum="4" autoAlign="true" inertia="true" zIndex="1">
                <hg_list_item id="item_0" x="0" y="0" width="414" height="80">
                    <hg_image id="icon_settings" x="20" y="15" width="50" height="50"
                              src="assets/icon_settings.png" zIndex="0" />
                    <hg_label id="lbl_settings" x="90" y="25" width="200" height="30"
                              text="Settings" fontSize="20" color="#FFFFFF" zIndex="1" />
                </hg_list_item>
                <hg_list_item id="item_1" x="0" y="0" width="414" height="80">
                    <hg_image id="icon_health" x="20" y="15" width="50" height="50"
                              src="assets/icon_health.png" zIndex="0" />
                    <hg_label id="lbl_health" x="90" y="25" width="200" height="30"
                              text="Health" fontSize="20" color="#FFFFFF" zIndex="1" />
                </hg_list_item>
            </hg_list>
        </hg_view>
    </view>
</hml>
```

### 15.2 带动画的图像

```xml
<hg_image id="img_logo" x="177" y="177" width="100" height="100"
          src="assets/logo.png" zIndex="10"
          timers='[{
              "id": "timer_rotate",
              "name": "Spin",
              "enabled": true,
              "interval": 16,
              "reload": true,
              "mode": "preset",
              "segments": [{
                  "duration": 3000,
                  "actions": [{ "type": "rotation", "from": 0, "to": 360 }]
              }]
          }]' />
```



### 15.4 视图间滑动导航

```xml
<hg_view id="view_page1" x="0" y="0" width="454" height="454" entry="true">
    <events>
        <event type="onSwipeLeft">
            <action type="switchView" target="view_page2"
                    switchOutStyle="SWITCH_OUT_TO_LEFT_USE_TRANSLATION"
                    switchInStyle="SWITCH_IN_FROM_RIGHT_USE_TRANSLATION" />
        </event>
    </events>
    <hg_label id="lbl_p1" x="150" y="210" width="154" height="34"
              text="Page 1 - Swipe Left" fontSize="20" color="#FFFFFF" hAlign="CENTER" />
</hg_view>

<hg_view id="view_page2" x="0" y="0" width="454" height="454">
    <events>
        <event type="onSwipeRight">
            <action type="switchView" target="view_page1"
                    switchOutStyle="SWITCH_OUT_TO_RIGHT_USE_TRANSLATION"
                    switchInStyle="SWITCH_IN_FROM_LEFT_USE_TRANSLATION" />
        </event>
    </events>
    <hg_label id="lbl_p2" x="150" y="210" width="154" height="34"
              text="Page 2 - Swipe Right" fontSize="20" color="#FFFFFF" hAlign="CENTER" />
</hg_view>
```

---

### `hg_progress` - 进度条（仅 HoneyGUI）

引擎：HoneyGUI 就绪；LVGL 不支持。它是叶子控件，不是容器，也不能包含 HML 子控件。
内部生成一个窗口；线性模式生成轨道与填充矩形，直线分段模式生成最多 64 个矩形段，圆弧及逆时针仪表盘模式生成轨道与填充弧，圆弧分段模式生成最多 64 个弧段，圆点刻度环模式生成最多 64 个圆点；`loading` 模式生成旋转弧，`loading-slide` 模式生成横向往返滑动的短条。
这是只显示数值的进度条，不是可拖动滑块。
数值模式的初始值在创建时显示，运行时更新必须调用生成的 C 接口；两种加载模式都没有数值。

```xml
<hg_progress id="volume_level" x="20" y="40" width="220" height="24"
             progressMode="linear" orientation="horizontal" fillStart="left" borderRadius="12"
             min="0" max="100" value="50"
             activeColor="#3edb88" activeOpacity="255"
             inactiveColor="#343b42" inactiveOpacity="255" />
<hg_progress id="level_steps" x="20" y="80" width="220" height="24"
             progressMode="segmented" segmentCount="12" segmentGap="3" fillStart="left"
             borderRadius="4" min="0" max="100" value="50"
             activeColor="#3edb88" activeOpacity="255"
             inactiveColor="#343b42" inactiveOpacity="255" />
<hg_progress id="battery" x="20" y="110" width="220" height="24"
             progressMode="segmented" segmentCount="12" value="15"
             colorMode="state" thresholdLow="20" thresholdHigh="50"
             zoneLowColor="#e8564a" zoneMidColor="#f2b33d" zoneHighColor="#3edb88"
             inactiveColor="#343b42" />
<hg_progress id="dial_level" x="20" y="120" width="100" height="100"
             progressMode="arc" arcStartAngle="-90" arcSweepAngle="360"
             arcStrokeWidth="8" min="0" max="100" value="50"
             showValueLabel="true" valueLabelFormat="percent" valueLabelColor="#ffffff"
             fontSize="16" fontFile="/NotoSansSC-Medium.ttf" fontType="bitmap"
             activeColor="#4945b5" inactiveColor="#dcd9ff" />
<hg_progress id="dial_steps" x="140" y="120" width="100" height="100"
             progressMode="arc-segmented" segmentCount="8" arcSegmentGap="8"
             arcStartAngle="-90" arcSweepAngle="360" arcDirection="counterclockwise" arcStrokeWidth="8"
             min="0" max="100" value="50"
             activeColor="#4945b5" inactiveColor="#dcd9ff" />
<hg_progress id="dial_gauge" x="20" y="240" width="100" height="100"
             progressMode="arc-gauge" arcStartAngle="-45" arcSweepAngle="270"
             arcDirection="counterclockwise" arcStrokeWidth="8" value="58"
             showValueLabel="true" activeColor="#3edb88" inactiveColor="#343b42" />
<hg_progress id="dial_dots" x="140" y="240" width="100" height="100"
             progressMode="arc-dots" segmentCount="24" arcStrokeWidth="6"
             arcStartAngle="-90" arcSweepAngle="360" value="62"
             showValueLabel="true" colorMode="positional"
             thresholdLow="30" thresholdHigh="70"
             zoneLowColor="#3edb88" zoneMidColor="#f2b33d" zoneHighColor="#e8564a"
             inactiveColor="#343b42" />
<hg_progress id="busy" x="260" y="240" width="64" height="64"
             progressMode="loading" spinArcLen="90" spinPeriod="1600"
             spinAutostart="true" showTrack="true" arcStartAngle="-90"
             arcDirection="clockwise" arcStrokeWidth="8"
             activeColor="#3edb88" inactiveColor="#343b42" />
<hg_progress id="busy_bar" x="20" y="350" width="220" height="24"
             progressMode="loading-slide" spinPeriod="1600"
             spinAutostart="true" slideLengthPercent="25" borderRadius="12"
             activeColor="#3edb88" inactiveColor="#343b42" />
```

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `progressMode` | 枚举 | linear | `linear`、`segmented`、`arc`、`arc-segmented`、`arc-gauge`（逆时针 270° 仪表盘）、`arc-dots`（圆点刻度环）、`loading`（旋转弧）或 `loading-slide`（横向滑动加载） |
| `segmentCount` | 整数 (1-64) | 12；`arc-dots` 为 24 | 分段数或圆点数，仅分段和圆点模式适用 |
| `segmentGap` | 非负整数 | 3 | 段间距（像素），仅直线分段模式 |
| `arcStartAngle` | 数字 (-360 至 360) | -90；`arc-gauge` 为 -45 | 弧形/圆点起始角度（度；右侧为 0，顺时针为正） |
| `arcSweepAngle` | 数字 (1-360) | 360；`arc-gauge` 为 270 | 弧形/圆点扫过角度（度） |
| `arcDirection` | 枚举 | clockwise；`arc-gauge` 为 counterclockwise | `clockwise` 顺时针或 `counterclockwise` 逆时针，均从 `arcStartAngle` 开始 |
| `arcStrokeWidth` | 正整数 | 8；`arc-dots` 为 6 | 弧线宽度或圆点直径（像素），受控件尺寸限制 |
| `spinArcLen` | 整数 (10-180) | 90 | 仅 `loading`：旋转弧长（度） |
| `spinPeriod` | 整数 (400-10000) | 1600 | `loading` 为转一圈所需毫秒数；`loading-slide` 为完整往返周期，均按真实经过时间计算 |
| `slideLengthPercent` | 整数 (5-90) | 25 | 仅 `loading-slide`：短条宽度占轨道宽度的百分比，短条始终位于轨道内 |
| `spinAutostart` | 布尔值 | true | 两种加载模式：创建后自动开始运动 |
| `showTrack` | 布尔值 | true | 仅 `loading`：显示固定的完整 360° 底环，底环不会旋转 |
| `arcSegmentGap` | 非负数字 | 8 | 弧段之间的角度间隙（度），每段至少保留 1 度 |
| `orientation` | 枚举 | horizontal | 仅直线模式：`horizontal` 或 `vertical`（从下到上填充）；在设计器中切换方向会交换宽高 |
| `fillStart` | 枚举 | 水平 left，垂直 bottom | 仅直线模式：水平 `left` / `right`，垂直 `bottom` / `top` |
| `borderRadius` | 非负整数 | 12 | 直线与 `loading-slide` 模式：轨道/填充或每段的圆角半径，上限为较短边的一半 |
| `min`、`max`、`value` | int32 | 0、100、50 | 范围及初始值，超出范围时截断 |
| `activeColor`、`inactiveColor` | #RRGGBB | #3edb88、#343b42 | 已填充及未填充颜色 |
| `activeOpacity`、`inactiveOpacity` | 整数 (0-255) | 255 | 已填充及未填充透明度（0 完全透明、255 不透明） |
| `colorMode` | 枚举 | single | 仅分段与圆点模式：`single` 使用原有 `activeColor`；`positional` 按已点亮段的位置分区配色；`state` 按当前数值给所有已点亮段统一配色。连续模式忽略此项。 |
| `thresholdLow`、`thresholdHigh` | 整数 (0-100) | 固定分区：30、70；状态阈值：20、50 | 按 `min`-`max` 区间的百分比计算，高阈值不能低于低阈值；等于阈值时进入下一档。固定分区按填充方向的每段起始位置判定。 |
| `zoneLowColor`、`zoneMidColor`、`zoneHighColor` | #RRGGBB | 固定分区：#3edb88、#f2b33d、#e8564a；状态阈值：#e8564a、#f2b33d、#3edb88 | 三档已点亮颜色；未点亮段始终使用 `inactiveColor` / `inactiveOpacity`，已点亮段使用 `activeOpacity`。 |
| `showValueLabel` | 布尔值 | false | 四种模式均可创建居中的数值标签 |
| `valueLabelFormat` | 枚举 | percent | `percent` 显示四舍五入的区间百分比（如 `72%`）；`value` 显示当前整数值 |
| `valueLabelColor` | #RRGGBB | #ffffff | 数值标签颜色 |
| `fontSize`、`fontFile`、`fontType`、`renderMode` | 字体配置 | 16、空、bitmap、4 | 数值标签字体；固件显示需要指定 `assets/` 中的字体，如 `fontFile="/name.ttf"`；点阵字体按字号转换 |
| `valueLabelOffsetX`、`valueLabelOffsetY` | 整数 | 0 | 相对于中心的标签位置偏移（像素） |

生成的 `<design>_ui.h` 声明 `void volume_level_set_value(int32_t value);`。
请在视图创建后（例如用户回调中）调用它更新直线填充、圆弧扫过角度、分段颜色及可选数值标签。`loading` 和 `loading-slide` 均没有数值、数值标签和 `set_value`，仅生成 `<id>_start(void)` 与 `<id>_stop(void)` 来继续或暂停运动。两种模式都使用 33ms 循环定时器，但相位由实际经过时间决定；旋转模式的 `arcStartAngle` 是初始相位，`arcDirection` 控制旋转方向；滑动模式在横向轨道内平滑往返，忽略 `orientation`、`fillStart` 和 `showTrack`。生成的接口不会修改 HML 文件。
设计器中选中控件后，可拖动四角或四边的手柄缩放。

---

## 属性分类参考

HML 解析器将 XML 属性归类到以下几组：

### 样式属性
`color`, `backgroundColor`, `fontWeight`, `border`, `borderRadius`, `padding`, `margin`, `overflow`, `title`, `titleBarHeight`, `titleBarColor`, `radius`, `startAngle`, `endAngle`, `strokeWidth`, `fillColor`, `showBackground`, `itemWidth`, `itemHeight`, `direction`, `style`, `space`, `cardStackLocation`, `circleRadius`, `transform`, `align`, `hAlign`, `vAlign`, `letterSpacing`, `lineSpacing`, `wordWrap`, `wordBreak`, `useGradient`, `gradientType`, `gradientDirection`, `gradientBox`, `opacity`

### 数据属性
`text`, `i18nKey`, `src`, `value`, `placeholder`, `options`, `min`, `max`, `step`, `checked`, `selected`, `noteNum`, `autoAlign`, `inertia`, `loop`, `createBar`, `enableAreaDisplay`, `keepNoteAlive`, `offset`, `outScope`, `fontFile`, `timeFormat`, `enableScroll`, `scrollDirection`, `scrollReverse`, `scrollStartOffset`, `scrollEndOffset`, `scrollInterval`, `scrollDuration`, `fontType`, `renderMode`, `fontSize`, `characterSets`, `residentMemory`, `animateStep`, `toggleMode`, `imageOn`, `imageOff`, `initialState`, `onCallback`, `offCallback`, `movable`, `click`,   `blendMode`, `fgColor`, `bgColor`, `highQuality`, `needClip`, `isTimerLabel`, `timerType`, `timerFormat`, `timerInitialValue`, `timerAutoStart`, `timers`, `progressMode`, `fillStart`, `segmentCount`, `segmentGap`, `arcStartAngle`, `arcSweepAngle`, `arcDirection`, `arcStrokeWidth`, `arcSegmentGap`, `spinArcLen`, `spinPeriod`, `slideLengthPercent`, `spinAutostart`, `showTrack`, `activeColor`, `inactiveColor`, `activeOpacity`, `inactiveOpacity`, `colorMode`, `thresholdLow`, `thresholdHigh`, `zoneLowColor`, `zoneMidColor`, `zoneHighColor`, `showValueLabel`, `valueLabelFormat`, `valueLabelColor`, `valueLabelOffsetX`, `valueLabelOffsetY`

### 元属性
`id`, `name`, `x`, `y`, `width`, `height`, `visible`, `enabled`, `locked`, `zIndex`, `parent`

### 事件属性
任何以 `on` 为前缀的属性（数据白名单中的属性除外，如 `onCallback`、`offCallback`）。

