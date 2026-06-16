# HML 常见错误和修复方法

生成 HML 时最高频的错误。**完整规范以 `HML-Spec.md` 为准**——本文件只覆盖最常被写错的点。

## 目录

- [1. 方言错误（最高频）](#1-方言错误最高频)
- [2. 组件可用性错误（引擎相关）](#2-组件可用性错误引擎相关)
- [3. 结构与约束错误](#3-结构与约束错误)
- [4. 语法与属性错误](#4-语法与属性错误)
- [5. 验证流程错误](#5-验证流程错误)

---

## 1. 方言错误（最高频）

AI 最常凭其他 UI 框架的习惯写 HML，导致方言不对。务必照下表。

### ❌ 错误 1.1：用 `w` / `h` 而非 `width` / `height`

```xml
<!-- ❌ 错误 -->
<hg_button id="btn1" x="100" y="200" w="120" h="48" ... />
<!-- ✅ 正确 -->
<hg_button id="btn1" x="100" y="200" width="120" height="48" ... />
```

### ❌ 错误 1.2：用 `textAlign` 而非 `hAlign`

```xml
<!-- ❌ 错误 -->
<hg_label id="lbl1" text="Hi" textAlign="center" fontFile="/font.ttf" />
<!-- ✅ 正确：hAlign 取 LEFT / CENTER / RIGHT（大写）；垂直用 vAlign（TOP / MID） -->
<hg_label id="lbl1" text="Hi" hAlign="CENTER" fontFile="/font.ttf" />
```

### ❌ 错误 1.3：meta 写成嵌套 `<title>` / `<resolution>`

```xml
<!-- ❌ 错误 -->
<meta>
  <title>My App</title>
  <project><resolution>454x454</resolution></project>
</meta>
<!-- ✅ 正确：project 是带属性的自闭合标签，可选 author -->
<meta>
  <project name="My App" appId="com.example.myapp"
           resolution="454x454" pixelMode="RGB565" />
  <author name="Developer" email="dev@example.com" />
</meta>
```

### ❌ 错误 1.4：内联事件属性（`onClick="fn"`）

HML 没有内联事件属性，所有交互必须用 `<events>` 结构。

```xml
<!-- ❌ 错误 -->
<hg_button id="btn_go" ... onClick="goSettings" />

<!-- ✅ 正确 -->
<hg_button id="btn_go" x="177" y="380" width="100" height="48"
           imageOn="/btn_go_on.bin" imageOff="/btn_go_off.bin">
  <events>
    <event type="onClick">
      <action type="switchView" target="view_settings"
              switchOutStyle="SWITCH_OUT_TO_LEFT_USE_TRANSLATION"
              switchInStyle="SWITCH_IN_FROM_RIGHT_USE_TRANSLATION" />
    </event>
  </events>
</hg_button>
```

- 调 C 回调用 `<action type="callFunction" functionName="my_handler" />`。
- `callFunction` 引用的函数需先在 `src/user/...` 写空实现，否则仿真编译失败。

### ❌ 错误 1.5：`hg_button` 当成带文字 / 带子组件的容器

`hg_button` 是**图片按钮**（非容器），用 `imageOn`/`imageOff`，**没有 `src` / `text`，不能嵌子组件**。

```xml
<!-- ❌ 错误：src + text + 内嵌 image -->
<hg_button id="btn1" src="/btn.bin" text="OK">
  <hg_image id="ic" src="/icon.bin" />
</hg_button>

<!-- ✅ 正确：普通按钮 -->
<hg_button id="btn_ok" x="100" y="200" width="120" height="48"
           imageOn="/btn_ok_pressed.bin" imageOff="/btn_ok_default.bin"
           clickCallback="on_btn_ok_click" />

<!-- ✅ 正确：toggle 按钮 -->
<hg_button id="btn_power" x="100" y="200" width="80" height="80"
           toggleMode="true" initialState="off"
           imageOn="/power_on.bin" imageOff="/power_off.bin"
           onCallback="power_on_handler" offCallback="power_off_handler" />
```

> 若需要"图标 + 文字"的按钮外观，把 `hg_image` + `hg_label` 放在一个 `hg_view` 里，
> 并把点击事件挂在该 `hg_view` 上。

---

## 2. 组件可用性错误（引擎相关）

每个项目在 `project.json` 的 `targetEngine` 锁定一个引擎。**只用 `HML-Spec.md` 中标注当前引擎
可用（✓ / ready）的组件。** 用错会在 codegen / 仿真编译阶段失败。

### ❌ 错误 2.1：使用不存在的虚构组件

`hg_container`、`hg_grid`、`hg_tab` **在任何引擎都不存在**，永远勿用。

```xml
<!-- ❌ 错误 -->
<hg_container ...>...</hg_container>
<hg_grid rows="3" columns="3">...</hg_grid>

<!-- ✅ 正确：用 hg_view 做布局容器，用坐标摆放实现网格效果 -->
<hg_view id="view_grid" x="0" y="0" width="454" height="454">
  <hg_image id="app_1" x="57"  y="77"  width="100" height="100" src="/app1.bin" />
  <hg_image id="app_2" x="177" y="77"  width="100" height="100" src="/app2.bin" />
  <hg_image id="app_3" x="297" y="77"  width="100" height="100" src="/app3.bin" />
</hg_view>
<!-- 可滚动列表用 hg_list + hg_list_item -->
```

### ❌ 错误 2.2：在 HoneyGUI 项目用 LVGL-only 输入控件

`hg_input` / `hg_checkbox` / `hg_radio` / `hg_switch` / `hg_slider` / `hg_progressbar` 是
**仅 LVGL** 可用（HoneyGUI 上是 planned，codegen 出 stub）。HoneyGUI 项目勿用。

```xml
<!-- ❌ 错误（HoneyGUI 项目里）：开关 / 滑块 / 进度条 -->
<hg_switch id="sw_wifi" value="true" />
<hg_slider id="sl_bright" min="0" max="100" value="70" />

<!-- ✅ 替代：用图片 toggle 按钮表达开关；用 hg_arc / hg_rect 表达进度 -->
<hg_button id="btn_wifi" x="334" y="15" width="60" height="30"
           toggleMode="true" initialState="on"
           imageOn="/switch_on.bin" imageOff="/switch_off.bin"
           onCallback="wifi_on" offCallback="wifi_off" />
```

> 反之，LVGL 项目勿用 `hg_video` / `hg_3d`（planned）与 `hg_glass` / `hg_particle` / `hg_map` /
> `hg_openclaw` / `hg_claw_face` / `hg_menu_cellular`（unsupported / planned）。
> `hg_canvas` 两端都未实现，一律勿用——绘图改用 `hg_image` / `hg_rect` / `hg_arc` / `hg_svg`。

---

## 3. 结构与约束错误

### ❌ 错误 3.1：`hg_view` 嵌套 `hg_view`

```xml
<!-- ❌ 错误 -->
<hg_view id="view_main" entry="true">
  <hg_view id="view_inner">...</hg_view>
</hg_view>

<!-- ✅ 正确：用多个平级 hg_view 代表不同屏幕，靠 x 偏移区分 -->
<view>
  <hg_view id="view_main" entry="true" x="0" y="0" width="454" height="454">...</hg_view>
  <hg_view id="view_settings" x="0" y="0" width="454" height="454">...</hg_view>
</view>
```

> 可嵌套的容器是 `hg_window` / `hg_list`：`hg_view` 内可放 `hg_window`，但不可放 `hg_view`。

### ❌ 错误 3.2：非容器组件包含子元素

只有 `hg_view` / `hg_window` / `hg_list` / `hg_list_item` 可含子组件；`hg_label` / `hg_image` /
`hg_button` 等非容器控件不可嵌任何元素，且必须放在容器内（不能直接作 `<view>` 子节点）。

### ❌ 错误 3.3：缺少 / 多个 Entry View

必须有且**仅有一个** `hg_view` 设 `entry="true"`。

```xml
<view>
  <hg_view id="view_home" entry="true" ...>...</hg_view>
  <hg_view id="view_settings" ...>...</hg_view>
</view>
```

### ❌ 错误 3.4：资源路径缺 `/` 前缀 / 带 `assets/` 前缀

资源路径 = `/` + "从 assets 文件夹起的相对路径"。文件在 `assets/icon.bin` 则路径写 `/icon.bin`。

```xml
<!-- ❌ icon.bin（缺 /）、assets/icon.bin（多余前缀） -->
<!-- ✅ -->
<hg_image id="img1" src="/icon.bin" />
<hg_label id="lbl1" text="Hi" fontFile="/NotoSansSC-Bold.ttf" />
```

### ❌ 错误 3.5：`hg_label` 缺 `fontFile`

`hg_label` / `hg_time_label` / `hg_timer_label` 必须设 `fontFile`，且该字体文件须存在于 assets 中。

```xml
<hg_label id="lbl_title" text="Dashboard" fontSize="26" color="#FFFFFF"
          fontFile="/NotoSansSC-Bold.ttf" />
```

> 回退：assets 中无字体时，从 fallback 字体目录复制一份到 assets 再引用。

### ❌ 错误 3.6：组件 ID 格式 / 重复

ID 须符合 C 标识符规则（小写字母开头，仅含 `a-z` `0-9` `_`），且全局唯一。
推荐前缀：`btn_*` `lbl_*` `img_*` `view_*`。

```xml
<!-- ❌ 1btn（数字开头）、btn-confirm（连字符）、重复 id -->
<!-- ✅ -->
<hg_button id="btn_confirm" .../>
<hg_button id="btn_cancel" .../>
```

---

## 4. 语法与属性错误

### ❌ 错误 4.1：XML 未闭合 / 属性值缺引号

```xml
<!-- ❌ --> <hg_button id="btn1" width="100" height="50"
<!-- ❌ --> <hg_label id=lbl1 text="Hi" fontFile="/font.ttf" />
<!-- ✅ --> <hg_button id="btn1" width="100" height="50" imageOff="/b.bin" />
```

### ❌ 错误 4.2：特殊字符未转义

`&`→`&amp;`，`<`→`&lt;`，`>`→`&gt;`，`"`→`&quot;`，`'`→`&apos;`。

```xml
<hg_label id="lbl1" text="A &amp; B" fontFile="/font.ttf" />
```

### ❌ 错误 4.3：颜色用名称而非十六进制

```xml
<!-- ❌ color="red"  ✅ -->
<hg_label id="lbl1" text="T" color="#FF0000" fontFile="/font.ttf" />
```

支持 `#RRGGBB` 或 `#RRGGBBAA`（含透明度）。

### ❌ 错误 4.4：坐标 / 尺寸越界或为负

坐标与尺寸应为非负整数，且组件应在屏幕范围内（如 454x454 屏，`x + width ≤ 454`）。

---

## 5. 验证流程错误

### ❌ 错误 5.1：生成后未验证

生成 HML 后**必须**调用 `POST http://localhost:38912/api/validate-hml`，修复所有 errors 后重验。

### ❌ 错误 5.2：误以为 "valid:true" = 完全正确

验证器只查 8 条结构规则，**不查组件白名单、不查属性名**。
用了不存在/不可用的组件，或写错属性名（如把 `width` 写成 `w`），也可能 `valid:true`。

➡️ `valid:true` 后仍须对照 `HML-Spec.md` 人工核对：① 组件在当前引擎可用；② 属性名正确（见第 1、2 节）。

---

## 相关文档

- **唯一真相源（组件 / 属性 / 事件 / 引擎矩阵）**：`HML-Spec.md`
- **HTTP API 文档**：`references/http-api.md`
- **布局模式**：`references/layout-patterns.md`
- **设计原则**：`references/design-principles.md`
