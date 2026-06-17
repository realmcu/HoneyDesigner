# HML (HoneyGUI 标记语言) 规范

> 版本: 1.0 | 最后更新: 2026-04-03

HML 是一种基于 XML 的标记语言，由 HoneyGUI Design 用于描述嵌入式 GUI 布局。本文档作为 AI 代理生成 HML 文件的权威参考。


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
9. [图形控件](#9-图形控件)
10. [多媒体控件](#10-多媒体控件)
11. [小程序控件](#11-小程序控件)
12. [事件系统](#12-事件系统)
13. [定时器与动画系统](#13-定时器与动画系统)
14. [视图切换动画](#14-视图切换动画)
15. [代码生成映射](#15-代码生成映射)
16. [示例](#16-示例)

---




## 1. 文档结构

每个 HML 文件都是一个 UTF-8 编码的 XML 文档，具有以下骨架结构：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hml>
    <meta>
        <!-- 项目元数据 -->
    </meta>
    <view>
        <!-- 组件树 -->
    </view>
</hml>
```

### 规则

| 项目 | 要求 |
|------|------|
| 根元素 | `<hml>` — 必需 |
| 子元素 | 恰好两个子元素：`<meta>` 然后是 `<view>`，按此顺序 |
| 编码 | UTF-8 |
| 标签前缀 | 所有组件标签必须以 `hg_` 或 `custom_` 开头 |

### 标签约定

- **叶节点**（无子元素，无事件）：使用自闭合标签 — `<hg_image id="img1" ... />`
- **容器**或**有事件的节点**：使用开闭标签 — `<hg_view ...>...</hg_view>`

---

## 2. 元数据部分

`<meta>` 节点包含项目级别的配置：

```xml
<meta>
    <project name="MyApp" appId="com.example.myapp"
             resolution="454x454" minSdk="1.0" pixelMode="RGB565" />
    <author name="Developer" email="dev@example.com" />
</meta>
```

### `<project>` 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `name` | string | 项目名称 |
| `appId` | string | 应用程序标识符 |
| `resolution` | string | 屏幕分辨率，格式为 `宽x高`（例如 `454x454`, `480x272`）|
| `minSdk` | string | 最低 SDK 版本 |
| `pixelMode` | string | 像素格式：`RGB565`、`ARGB8888` 等 |

### `<author>` 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `name` | string | 作者名称 |
| `email` | string | 作者邮箱 |

---

## 3. 视图部分

`<view>` 节点包含 UI 组件树。顶层子元素通常是代表不同屏幕/页面的 `hg_view` 容器。

```xml
<view>
    <hg_view id="view_home" x="0" y="0" width="454" height="454" entry="true">
        <hg_label id="lbl1" x="10" y="10" width="100" height="24" text="Hello" />
    </hg_view>
    <hg_view id="view_settings" x="0" y="0" width="454" height="454">
        <!-- 另一个屏幕 -->
    </hg_view>
</view>
```

`<view>` 内的组件在序列化时按 `zIndex` 排序。

---

## 4. 通用属性

所有组件都支持这些基础属性：

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | string | 自动生成 | 全局唯一的组件标识符 |
| `name` | string | 与 `id` 相同 | 显示名称（用于设计器 UI）|
| `x` | int | 0 | 相对于父元素的 X 位置 |
| `y` | int | 0 | 相对于父元素的 Y 位置 |
| `width` | int | 100 | 宽度（像素）|
| `height` | int | 40 | 高度（像素）|
| `visible` | boolean | true | 可见性标志 |
| `enabled` | boolean | true | 交互启用标志 |
| `locked` | boolean | false | 在设计器中锁定（防止拖动）|
| `zIndex` | int | 0 | 堆叠顺序 — 较高的值在上层渲染 |
| `showOverflow` | boolean | false | 在设计器中显示溢出内容 |

> **ID 命名约定**：使用小写加下划线，例如 `btn_menu`、`lbl_time`、`img_bg`。

---

## 5. 组件分类与嵌套规则

### 所有组件类型

| 类别 | 标签 |
|------|------|
| **容器** | `hg_view`, `hg_window`, `hg_list`, `hg_list_item`, `hg_menu_cellular` |
| **基础** | `hg_label`, `hg_time_label`, `hg_image` |
| **图形** | `hg_arc`, `hg_circle`, `hg_rect`|

### 嵌套规则（关键）

1. **只有容器**（`hg_view`、`hg_window`、`hg_list`、`hg_list_item`）**可以包含子组件**。
2. **非容器控件必须是容器的子元素** — 它们不能作为 `<view>` 的直接子元素出现。
3. **非容器控件不能有子组件**。
4. `hg_list` 的子元素应该是 `hg_list_item` 元素。
5. `hg_list_item` 可以包含任何非容器控件。

### 有效树示例

```
<view>
  └─ hg_view (容器)
       ├─ hg_label (叶节点)
       ├─ hg_image (叶节点)
       └─ hg_window (嵌套容器)
            └─ hg_label (叶节点)
```



---

## 6. 容器组件

### 6.1 `hg_view` — 视图容器

表示完整屏幕/页面的主要顶层容器。

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `entry` | boolean | false | 入口视图 — 应用启动时显示的第一个屏幕。应该恰好有一个视图设置 `entry="true"` |
| `backgroundColor` | color | #000000 | 背景颜色 |
| `borderRadius` | number | 20 | 边框圆角 |
| `padding` | number | 12 | 内边距 |
| `overflow` | enum | auto | `auto` / `hidden` / `scroll` |
| `residentMemory` | boolean | — | 切换时保留在内存中 |
| `animateStep` | number | height/10 | 动画步长值 |
| `opacity` | number | 255 | 不透明度（0–255）|

- **默认尺寸**：350×250
- **C API**：`GUI_VIEW_INSTANCE` 宏

### 6.2 `hg_window` — 窗口容器

带有可选背景和模糊效果的窗口容器。

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `showBackground` | boolean | false | 显示背景填充 |
| `backgroundColor` | color | #808080 | 背景颜色 |
| `enableBlur` | boolean | false | 启用模糊效果 |
| `blurDegree` | number | 225 | 模糊强度 |

- **默认尺寸**：450×350
- **C API**：`gui_win_create`



### 6.4 `hg_list` — 列表容器

具有多种布局样式的可滚动列表。

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `itemWidth` | number | 100 | 项目宽度 |
| `itemHeight` | number | 100 | 项目高度 |
| `space` | number | 5 | 项目间距 |
| `direction` | enum | VERTICAL | `VERTICAL` / `HORIZONTAL` |
| `style` | enum | LIST_CLASSIC | 列表样式（见下表）|
| `cardStackLocation` | number | 0 | 卡片堆叠位置 |
| `circleRadius` | number | — | 圆形布局半径（自动计算）|
| `noteNum` | number | 5 | 可见项目数量 |
| `autoAlign` | boolean | true | 自动对齐到最近的项目 |
| `inertia` | boolean | true | 惯性滚动 |
| `loop` | boolean | false | 循环滚动 |
| `createBar` | boolean | false | 显示滚动条 |
| `enableAreaDisplay` | boolean | false | 启用区域显示 |
| `keepNoteAlive` | boolean | false | 保持项目活动 |
| `offset` | number | 0 | 偏移量 |
| `outScope` | number | 0 | 超出范围 |
| `useUserNoteDesign` | boolean | — | 使用自定义项目设计 |
| `userNoteDesignFunc` | string | — | 自定义设计函数名称 |

**列表 `style` 值**：

| 值 | 说明 |
|----|------|
| `LIST_CLASSIC` | 经典垂直/水平列表 |
| `LIST_CIRCLE` | 圆形布局 |
| `LIST_ZOOM` | 缩放列表 |
| `LIST_CARD` | 卡片堆叠 |
| `LIST_FADE` | 淡入淡出 |
| `LIST_FAN` | 扇形布局 |
| `LIST_HELIX` | 螺旋布局 |
| `LIST_CURL` | 卷曲效果 |

- **默认尺寸**：300×400
- **C API**：`gui_list_create`

### 6.5 `hg_list_item` — 列表项

`hg_list` 的子元素。在组件库中不可用 — 由列表自动管理。

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `index` | number | 自动分配 | 项目索引（按位置排序）|

### 6.6 `hg_menu_cellular` — 蜂窝菜单

六边形滚动菜单。

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `iconFolder` | string | "" | 图标资源文件夹 |
| `iconSize` | number | 64 | 图标尺寸 |
| `offsetX` | number | 0 | X 偏移 |
| `offsetY` | number | 0 | Y 偏移 |

- **默认尺寸**：动态（匹配项目分辨率）

---

## 7. 基础控件



### 7.2 `hg_label` — 文本标签

带有可选滚动和定时器功能的文本显示。

回退方案：如果 assets 文件夹中没有字体文件，将 fallback 文件夹中的字体文件复制到 assets 文件夹，并使用这些回退字体文件。

#### 文本与布局

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | "Label" | 显示文本 |
| `hAlign` | enum | LEFT | 水平对齐：`LEFT` / `CENTER` / `RIGHT` |
| `vAlign` | enum | TOP | 垂直对齐：`TOP` / `MID` |
| `color` | color | #ffffff | 文本颜色 |
| `letterSpacing` | number | 0 | 字母间距 |
| `lineSpacing` | number | 0 | 行间距 |
| `wordWrap` | boolean | false | 自动换行 |
| `wordBreak` | boolean | false | 单词内换行 |

#### 字体

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `fontFile` | string | — | 字体文件路径（相对于 assets）|
| `fontSize` | number | 16 | 字体大小（像素）|
| `fontType` | enum | bitmap | `bitmap` / `vector` |
| `renderMode` | enum | 4 | 抗锯齿位数：`1` / `2` / `4` / `8` |

#### 滚动文本

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `scrollDirection` | enum | horizontal | `horizontal` / `vertical` |
| `scrollReverse` | boolean | false | 反向滚动 |
| `scrollStartOffset` | number | 0 | 起始偏移 |
| `scrollEndOffset` | number | 0 | 结束偏移 |
| `scrollInterval` | number | 3000 | 滚动间隔（毫秒）|
| `scrollDuration` | number | 0 | 滚动持续时间（毫秒）|

#### 定时器标签模式

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `isTimerLabel` | boolean | false | 启用定时器标签模式 |
| `timerType` | enum | stopwatch | `stopwatch`（计数）/ `countdown`（倒计时）|
| `timerInitialValue` | number | 0 | 初始值（秒）|
| `timerFormat` | enum | HH:MM:SS | `HH:MM:SS` / `MM:SS` / `MM:SS:MS` / `SS` |
| `timerAutoStart` | boolean | true | 自动启动定时器 |

- **默认尺寸**：100×24
- **C API**：`gui_text_create` / `gui_scroll_text_create`

### 7.3 `hg_time_label` — 实时时钟标签

显示当前系统时间。继承所有 `hg_label` 的字体和对齐属性。

回退方案：如果 assets 文件夹中没有字体文件，将 fallback 文件夹中的字体文件复制到 assets 文件夹，并使用这些回退字体文件。

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | string | "" | 静态文本（被时间显示覆盖）|
| `timeFormat` | enum | HH:mm:ss | 时间格式（见下表）|

**`timeFormat` 值**：

| 格式 | 示例输出 |
|------|----------|
| `HH:mm:ss` | 14:30:05 |
| `HH:mm` | 14:30 |
| `HH` | 14 |
| `mm` | 30 |
| `HH:mm-split` | 分离的小时和分钟显示 |
| `YYYY-MM-DD` | 2026-04-03 |
| `YYYY-MM-DD HH:mm:ss` | 2026-04-03 14:30:05 |
| `MM-DD HH:mm` | 04-03 14:30 |

- **默认尺寸**：120×24

### 7.4 `hg_timer_label` — 定时器标签

类似于带定时器模式的 `hg_label`，但默认不自动启动。

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| *（继承所有 hg_label 定时器属性）* | | | |
| `timerAutoStart` | boolean | **false** | 不自动启动（与 hg_label 不同）|

- **默认尺寸**：120×24

### 7.5 `hg_image` — 图像

带有变换和混合模式支持的图像显示。

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `src` | string | — | 图像文件路径（相对于 assets）|
| `blendMode` | string | — | 混合模式（见下文）|
| `fgColor` | string | — | A8 模式的前景重新着色（格式：`0xFFRRGGBB`）|
| `bgColor` | string | — | A8 BGFG 模式的背景颜色 |
| `highQuality` | boolean | false | 高质量渲染 |
| `needClip` | boolean | false | 启用裁剪 |
| `assetFormat` | string | `A8` | A8 混合模式的 Alpha 格式：`A8`（8位，256级）、`A4`（4位，16级）、`A2`（2位，4级）、`A1`（1位，2级）。仅在 `blendMode` 为 `IMG_2D_SW_FIX_A8_FG` 或 `IMG_2D_SW_FIX_A8_BGFG` 时有效 |
| `transform` | JSON | — | 变换对象（见下文）|

**`blendMode` 值**：

| 值 | 说明 |
|----|------|
| `IMG_BYPASS_MODE` | 直接像素复制（绕过 alpha 混合，像素直接写入渲染缓冲区）|
| `IMG_FILTER_BLACK` | 黑色滤镜（默认，渲染时跳过黑色像素）|
| `IMG_SRC_OVER_MODE` | 源覆盖 alpha 合成：S × Sa + D × (1 − Sa) |
| `IMG_COVER_MODE` | 完全覆盖混合模式 |
| `IMG_RECT` | 矩形渲染模式 |
| `IMG_2D_SW_RGB565_ONLY` | 仅软件 RGB565 渲染 |
| `IMG_2D_SW_SRC_OVER_MODE` | 软件源覆盖 alpha 合成 |
| `IMG_2D_SW_FIX_A8_FG` | A8 格式带前景色（需要 `fgColor`）|
| `IMG_2D_SW_FIX_A8_BGFG` | A8 格式带前景+背景色（需要 `fgColor` 和 `bgColor`）|

**`transform` 对象**（JSON）：

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `scaleX` | number | 1.0 | X 轴缩放 |
| `scaleY` | number | 1.0 | Y 轴缩放 |
| `rotation` | number | 0 | 旋转角度（度）|
| `translateX` | number | 0 | X 平移 |
| `translateY` | number | 0 | Y 平移 |
| `skewX` | number | 0 | X 倾斜（度）|
| `skewY` | number | 0 | Y 倾斜（度）|
| `focusX` | number | — | 变换原点 X |
| `focusY` | number | — | 变换原点 Y |
| `opacity` | number | 255 | 不透明度（0–255）|

- **默认尺寸**：150×150
- **C API**：`gui_img_create_from_fs`

---



## 9. 图形控件

### 9.1 `hg_arc` — 弧形

| 属性 | 类型 | 默认值 | 范围 | 说明 |
|------|------|--------|------|------|
| `radius` | number | 40 | ≥ 0 | 弧形半径 |
| `startAngle` | number | 0 | — | 起始角度（度）|
| `endAngle` | number | 270 | — | 结束角度（度）|
| `strokeWidth` | number | 8 | ≥ 0 | 描边宽度 |
| `color` | color | #007acc | — | 弧形颜色 |
| `opacity` | number | 255 | 0–255 | 不透明度 |
| `useGradient` | boolean | false | — | 启用渐变 |
| `arcGroup` | string | "" | — | 弧形组标识符（用于分组多个弧形）|

- **默认尺寸**：96×96
- **C API**：`gui_arc_create`

### 9.2 `hg_circle` — 圆形

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `radius` | number | 40 | 圆形半径 |
| `fillColor` | color | #007acc | 填充颜色 |
| `opacity` | number | 255 | 不透明度（0–255）|
| `useGradient` | boolean | false | 启用渐变 |
| `gradientType` | enum | radial | `radial` / `angular` |


- **默认尺寸**：80×80
- **C API**：`gui_circle_create`

### 9.3 `hg_rect` — 矩形

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `borderRadius` | number | 0 | 圆角半径 |
| `fillColor` | color | #007acc | 填充颜色 |
| `opacity` | number | 255 | 不透明度（0–255）|
| `useGradient` | boolean | false | 启用渐变 |
| `gradientDirection` | enum | horizontal | `horizontal` / `vertical` / `diagonal_tl_br` / `diagonal_tr_bl` |

> `hg_rect` 也支持与 `hg_circle` 相同的**按钮模式**属性。

- **默认尺寸**：120×80
- **C API**：`gui_rect_create`




## 11. 事件系统

HML 使用**事件 → 动作**模型。事件在任何组件的 `<events>` 子节点内声明。

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

支持每个事件多个动作和每个组件多个事件：

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
|------|------|----------|
| `onClick` | 触摸点击 | — |
| `onLongPress` | 触摸长按 | — |
| `onTouchDown` | 触摸按下 | — |
| `onTouchUp` | 触摸释放 | `checkReleaseArea`（可选）|
| `onKeyShortPress` | 按键短按 | `keyName`：`Home`/`Back`/`Menu`/`Power` |
| `onKeyLongPress` | 按键长按 | `keyName`：`Home`/`Back`/`Menu`/`Power` |
| `onSwipeLeft` | 左滑 | — |
| `onSwipeRight` | 右滑 | — |
| `onSwipeUp` | 上滑 | — |
| `onSwipeDown` | 下滑 | — |
| `onShow` | 视图显示 | 仅 `hg_view` |
| `onHide` | 视图隐藏 | 仅 `hg_view` |
| `onMessage` | 接收消息 | `message`（消息名称）|

### 12.3 动作类型

| 动作 | 属性 | 说明 |
|------|------|------|
| `switchView` | `target`, `switchOutStyle`, `switchInStyle` | 导航到目标视图并带过渡动画 |
| `sendMessage` | `message` | 向其他组件广播消息 |
| `callFunction` | `functionName` | 调用 C 回调函数 |
| `controlTimer` | `timerTargets` | 控制定时器（JSON 数组）|

**`controlTimer` — `timerTargets` 格式**：

```json
[
    { "componentId": "img1", "timerIndex": 0, "action": "start" },
    { "componentId": "img2", "action": "stop" }
]
```

### 12.4 组件事件支持矩阵

| 组件 | 支持的事件 |
|------|-----------|
| `hg_view` | 全部（点击、长按、触摸、按键、滑动、生命周期、消息）|
| `hg_label` | 点击、长按、消息 |
| `hg_image` | 点击、长按、触摸按下、触摸释放、按键、消息 |


---

## 13. 定时器与动画系统

组件可以通过 `timers` 属性（存储为 JSON 数组字符串）拥有定时器驱动的动画。

### 13.1 XML 表示

```xml
<hg_image id="img1" x="0" y="0" width="100" height="100" src="icon.png"
          timers='[{"id":"t1","name":"Rotate","enabled":true,"interval":16,"reload":true,"mode":"preset","segments":[{"duration":3000,"actions":[{"type":"rotation","from":0,"to":360}]}]}]' />
```

### 13.2 TimerConfig 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一定时器标识符 |
| `name` | string | 显示名称 |
| `enabled` | boolean | 创建时绑定到组件 |
| `runImmediately` | boolean | 立即执行第一帧 |
| `interval` | number | 定时器间隔（毫秒）|
| `reload` | boolean | 循环执行 |
| `mode` | enum | `preset`（内置动作）/ `custom`（C 回调）|
| `actions` | TimerAction[] | 单段动画动作 |
| `segments` | AnimationSegment[] | 多段动画 |
| `callback` | string | 自定义回调函数名称（`custom` 模式）|
| `duration` | number | 总持续时间（毫秒）|
| `stopOnComplete` | boolean | 总持续时间后停止 |
| `enableLog` | boolean | 启用调试日志 |

### 13.3 TimerAction 类型

| 类型 | 说明 |
|------|------|
| `size` | 动画尺寸 |
| `position` | 动画位置 |
| `opacity` | 动画不透明度 |
| `rotation` | 动画旋转 |
| `scale` | 动画缩放 |
| `switchView` | 切换到另一个视图 |
| `changeImage` | 更改图像源 |
| `imageSequence` | 播放图像序列 |
| `visibility` | 切换可见性 |
| `switchTimer` | 启动/停止另一个定时器 |
| `setFocus` | 设置焦点 |
| `fgColor` | 动画前景色 |
| `bgColor` | 动画背景色 |

---

## 14. 视图切换动画

用于 `switchView` 动作的过渡动画。

### 14.1 切出样式

| 样式 | 说明 |
|------|------|
| `SWITCH_INIT_STATE` | 初始状态 |
| `SWITCH_OUT_NONE_ANIMATION` | 无动画 |
| `SWITCH_OUT_TO_LEFT_USE_TRANSLATION` | 向左滑动 |
| `SWITCH_OUT_TO_RIGHT_USE_TRANSLATION` | 向右滑动 |
| `SWITCH_OUT_TO_TOP_USE_TRANSLATION` | 向上滑动 |
| `SWITCH_OUT_TO_BOTTOM_USE_TRANSLATION` | 向下滑动 |
| `SWITCH_OUT_TO_LEFT_USE_CUBE` | 立方体向左旋转 |
| `SWITCH_OUT_TO_RIGHT_USE_CUBE` | 立方体向右旋转 |
| `SWITCH_OUT_TO_TOP_USE_CUBE` | 立方体向上旋转 |
| `SWITCH_OUT_TO_BOTTOM_USE_CUBE` | 立方体向下旋转 |
| `SWITCH_OUT_TO_LEFT_USE_ROTATE` | 向左旋转 |
| `SWITCH_OUT_TO_RIGHT_USE_ROTATE` | 向右旋转 |
| `SWITCH_OUT_TO_LEFT_USE_REDUCTION` | 向左缩小 |
| `SWITCH_OUT_TO_RIGHT_USE_REDUCTION` | 向右缩小 |
| `SWITCH_OUT_STILL_USE_BLUR` | 静态模糊 |
| `SWITCH_OUT_ANIMATION_FADE` | 淡出 |

### 14.2 切入样式

| 样式 | 说明 |
|------|------|
| `SWITCH_INIT_STATE` | 初始状态 |
| `SWITCH_IN_NONE_ANIMATION` | 无动画 |
| `SWITCH_IN_FROM_LEFT_USE_TRANSLATION` | 从左侧滑入 |
| `SWITCH_IN_FROM_RIGHT_USE_TRANSLATION` | 从右侧滑入 |
| `SWITCH_IN_FROM_TOP_USE_TRANSLATION` | 从顶部滑入 |
| `SWITCH_IN_FROM_BOTTOM_USE_TRANSLATION` | 从底部滑入 |
| `SWITCH_IN_FROM_LEFT_USE_CUBE` | 立方体从左侧 |
| `SWITCH_IN_FROM_RIGHT_USE_CUBE` | 立方体从右侧 |
| `SWITCH_IN_FROM_LEFT_USE_ROTATE` | 从左侧旋转 |
| `SWITCH_IN_FROM_RIGHT_USE_ROTATE` | 从右侧旋转 |
| `SWITCH_IN_FROM_LEFT_USE_REDUCTION` | 从左侧展开 |
| `SWITCH_IN_FROM_RIGHT_USE_REDUCTION` | 从右侧展开 |
| `SWITCH_IN_STILL_USE_BLUR` | 静态模糊 |
| `SWITCH_IN_ANIMATION_ZOOM` | 放大 |
| `SWITCH_IN_ANIMATION_FADE` | 淡入 |
| `SWITCH_IN_ANIMATION_MOVE_FADE` | 移动 + 淡入 |
| `SWITCH_IN_ANIMATION_MOVE_FROM_RIGHT` | 从右侧移动 |
| `SWITCH_IN_ANIMATION_MOVE_FROM_LEFT` | 从左侧移动 |
| `SWITCH_IN_ANIMATION_BOUNCE_FROM_RIGHT` | 从右侧弹跳 |
| `SWITCH_IN_ANIMATION_ZOOM_FROM_TOP_LEFT` | 从左上角放大 |
| `SWITCH_IN_ANIMATION_ZOOM_FROM_TOP_RIGHT` | 从右上角放大 |
| `SWITCH_IN_ANIMATION_CENTER_ZOOM_FADE` | 中心放大 + 淡入 |

---

## 15. 代码生成映射

设计器从 HML 生成 C 源代码。以下是组件到 API 的映射：

| HML 标签 | C 创建函数 | 头文件 |
|----------|-----------|--------|
| `hg_view` | `GUI_VIEW_INSTANCE` 宏 | `gui_view.h` |
| `hg_window` | `gui_win_create` | `gui_win.h` |
| `hg_label` | `gui_text_create` / `gui_scroll_text_create` | `gui_text.h` |
| `hg_image` | `gui_img_create_from_fs` | `gui_img.h` |
| `hg_arc` | `gui_arc_create` | `gui_arc.h` |
| `hg_circle` | `gui_circle_create` | `gui_circle.h` |
| `hg_rect` | `gui_rect_create` | `gui_rect.h` |
| `hg_list` | `gui_list_create` | `gui_list.h` |
| `hg_menu_cellular` | 自定义生成器 | `gui_menu_cellular.h` |

### 生成的文件结构

```
src/
├── ui/
│   ├── {name}_ui.h          # 每次代码生成时覆盖
│   └── {name}_ui.c          # 每次代码生成时覆盖
├── callbacks/
│   ├── {name}_callbacks.h    # 自动提取的声明
│   └── {name}_callbacks.c    # 保护区 — 用户代码被保留
├── user/
│   ├── {name}_user.h         # 只生成一次 — 永不覆盖
│   └── {name}_user.c         # 只生成一次 — 永不覆盖
└── SConscript                # 构建脚本（自动生成）
```

**保护区语法**（在 `*_callbacks.c` 中）：

```c
/* USER CODE BEGIN callback_name */
// 此处的用户代码在重新生成时被保留
/* USER CODE END callback_name */
```

---

## 16. 示例

### 16.1 智能手表主屏幕

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hml>
    <meta>
        <project name="SmartWatch" appId="com.example.smartwatch"
                 resolution="454x454" pixelMode="RGB565" />
        <author name="Developer" email="dev@example.com" />
    </meta>
    <view>
        <!-- 主屏幕 -->
        <hg_view id="view_home" x="0" y="0" width="454" height="454"
                 entry="true" backgroundColor="#000000" zIndex="0">

            <!-- 背景图像 -->
            <hg_image id="img_bg" x="0" y="0" width="454" height="454"
                      src="assets/watchface_bg.png" zIndex="0" />

            <!-- 时间显示 -->
            <hg_time_label id="lbl_time" x="127" y="160" width="200" height="70"
                           timeFormat="HH:mm" fontSize="56" color="#FFFFFF"
                           hAlign="CENTER" fontFile="roboto_56.bin" zIndex="1" />

            <!-- 日期显示 -->
            <hg_time_label id="lbl_date" x="152" y="230" width="150" height="30"
                           timeFormat="MM-DD HH:mm" fontSize="18" color="#AAAAAA"
                           hAlign="CENTER" fontFile="roboto_18.bin" zIndex="2" />

            <!-- 步数弧形 -->
            <hg_arc id="arc_steps" x="179" y="300" width="96" height="96"
                    radius="40" startAngle="0" endAngle="270"
                    strokeWidth="8" color="#4CAF50" zIndex="3" />

            
        </hg_view>

        <!-- 菜单屏幕 -->
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

### 16.2 带动画的图像

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



### 16.4 视图间滑动导航

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

## 属性分类参考

HML 解析器将 XML 属性分类为以下几类：

### 样式属性
`color`、`backgroundColor`、`fontWeight`、`border`、`borderRadius`、`padding`、`margin`、`overflow`、`title`、`titleBarHeight`、`titleBarColor`、`radius`、`startAngle`、`endAngle`、`strokeWidth`、`fillColor`、`showBackground`、`itemWidth`、`itemHeight`、`direction`、`style`、`space`、`cardStackLocation`、`circleRadius`、`transform`、`align`、`hAlign`、`vAlign`、`letterSpacing`、`lineSpacing`、`wordWrap`、`wordBreak`、`useGradient`、`gradientType`、`gradientDirection`、`opacity`

### 数据属性
`text`、`src`、`value`、`placeholder`、`options`、`min`、`max`、`step`、`checked`、`selected`、`noteNum`、`autoAlign`、`inertia`、`loop`、`createBar`、`enableAreaDisplay`、`keepNoteAlive`、`offset`、`outScope`、`fontFile`、`timeFormat`、`enableScroll`、`scrollDirection`、`scrollReverse`、`scrollStartOffset`、`scrollEndOffset`、`scrollInterval`、`scrollDuration`、`fontType`、`renderMode`、`fontSize`、`characterSets`、`residentMemory`、`animateStep`、`toggleMode`、`imageOn`、`imageOff`、`initialState`、`onCallback`、`offCallback`、`movable`、`click`、`blendMode`、`fgColor`、`bgColor`、`highQuality`、`needClip`、`isTimerLabel`、`timerType`、`timerFormat`、`timerInitialValue`、`timerAutoStart`、`timers`

### 元属性
`id`、`name`、`x`、`y`、`width`、`height`、`visible`、`enabled`、`locked`、`zIndex`、`parent`

### 事件属性
任何以 `on` 为前缀的属性（除了数据白名单中的如 `onCallback`、`offCallback`）。
