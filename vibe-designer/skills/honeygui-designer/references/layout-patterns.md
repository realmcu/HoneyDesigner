# HML 布局模式

嵌入式设备常见 UI 布局模式与可用示例。**所有片段均用 HoneyGUI 引擎方言**（`width`/`height`、
`hAlign`、`<events>` 结构、仅 ready 组件）。组件/属性细节以 `HML-Spec.md` 为准。

> 方言铁律：用 `width`/`height` 不用 `w`/`h`；文本对齐用 `hAlign`（`LEFT`/`CENTER`/`RIGHT`）；
> 资源路径以 `/` 开头；事件用 `<events>` 而非内联 `onClick`；按钮用 `imageOn`/`imageOff` 且不可嵌子组件；
> 布局容器只有 `hg_view`/`hg_window`/`hg_list`/`hg_list_item`（**没有** `hg_container`/`hg_grid`/`hg_tab`）。

## 目录

- [Dashboard / 状态总览](#dashboard--状态总览)
- [设置列表](#设置列表)
- [媒体播放控制](#媒体播放控制)
- [导航 / 网格菜单](#导航--网格菜单)
- [通知中心](#通知中心)
- [活动圆环](#活动圆环)
- [计时器 / 秒表](#计时器--秒表)
- [可滚动列表（hg_list）](#可滚动列表hg_list)
- [多页滑动导航](#多页滑动导航)
- [输入表单（仅 LVGL）](#输入表单仅-lvgl)
- [模式选择指南](#模式选择指南)

---

## Dashboard / 状态总览

**用途**：一屏速览多个指标（健康、家居）。**布局**：用 `hg_view` 卡片按坐标摆成网格。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <project name="Dashboard" resolution="454x454" pixelMode="RGB565" />
  </meta>
  <view>
    <hg_view id="view_dashboard" entry="true" x="0" y="0" width="454" height="454"
             backgroundColor="#000000">
      <hg_image id="img_bg" x="0" y="0" width="454" height="454" src="/bg_dashboard.bin" />

      <hg_label id="lbl_title" x="127" y="30" width="200" height="40"
                text="Dashboard" fontSize="24" color="#FFFFFF"
                hAlign="CENTER" fontFile="/NotoSansSC-Medium.ttf" />

      <!-- 卡片 1：步数 -->
      <hg_window id="card_steps" x="40" y="100" width="167" height="147"
                 showBackground="true" backgroundColor="#1E1E1E">
        <hg_image id="icon_steps" x="59" y="20" width="50" height="50" src="/icon_steps.bin" />
        <hg_label id="lbl_steps_value" x="34" y="80" width="100" height="40"
                  text="8542" fontSize="28" color="#00FF88"
                  hAlign="CENTER" fontFile="/NotoSansSC-Medium.ttf" />
        <hg_label id="lbl_steps_label" x="34" y="115" width="100" height="20"
                  text="Steps" fontSize="14" color="#999999"
                  hAlign="CENTER" fontFile="/NotoSansSC-Regular.ttf" />
      </hg_window>

      <!-- 卡片 2：心率 -->
      <hg_window id="card_heart" x="247" y="100" width="167" height="147"
                 showBackground="true" backgroundColor="#1E1E1E">
        <hg_image id="icon_heart" x="59" y="20" width="50" height="50" src="/icon_heart.bin" />
        <hg_label id="lbl_heart_value" x="34" y="80" width="100" height="40"
                  text="72" fontSize="28" color="#FF0066"
                  hAlign="CENTER" fontFile="/NotoSansSC-Medium.ttf" />
        <hg_label id="lbl_heart_label" x="34" y="115" width="100" height="20"
                  text="BPM" fontSize="14" color="#999999"
                  hAlign="CENTER" fontFile="/NotoSansSC-Regular.ttf" />
      </hg_window>
    </hg_view>
  </view>
</hml>
```

> `hg_window` 是可嵌套子组件的容器，适合做卡片。`hg_view` 内不能再放 `hg_view`，但可放 `hg_window`。

---

## 设置列表

**用途**：垂直选项列表。**布局**：用 `hg_list` + `hg_list_item` 实现可滚动列表；开关用 toggle 按钮。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <project name="Settings" resolution="454x454" pixelMode="RGB565" />
  </meta>
  <view>
    <hg_view id="view_settings" entry="true" x="0" y="0" width="454" height="454"
             backgroundColor="#000000">
      <hg_label id="lbl_title" x="127" y="20" width="200" height="40"
                text="Settings" fontSize="24" color="#FFFFFF"
                hAlign="CENTER" fontFile="/NotoSansSC-Medium.ttf" />

      <hg_list id="list_settings" x="20" y="70" width="414" height="370"
               direction="VERTICAL" style="LIST_CLASSIC"
               itemWidth="414" itemHeight="80" space="8"
               noteNum="4" autoAlign="true" inertia="true">

        <hg_list_item id="item_wifi" x="0" y="0" width="414" height="80">
          <hg_image id="icon_wifi" x="10" y="15" width="50" height="50" src="/icon_wifi.bin" />
          <hg_label id="lbl_wifi" x="75" y="25" width="200" height="30"
                    text="WiFi" fontSize="18" color="#FFFFFF" fontFile="/NotoSansSC-Regular.ttf" />
          <hg_button id="btn_wifi" x="334" y="25" width="60" height="30"
                     toggleMode="true" initialState="on"
                     imageOn="/switch_on.bin" imageOff="/switch_off.bin"
                     onCallback="wifi_on" offCallback="wifi_off" />
        </hg_list_item>

        <hg_list_item id="item_bt" x="0" y="0" width="414" height="80">
          <hg_image id="icon_bt" x="10" y="15" width="50" height="50" src="/icon_bt.bin" />
          <hg_label id="lbl_bt" x="75" y="25" width="200" height="30"
                    text="Bluetooth" fontSize="18" color="#FFFFFF" fontFile="/NotoSansSC-Regular.ttf" />
          <hg_button id="btn_bt" x="334" y="25" width="60" height="30"
                     toggleMode="true" initialState="off"
                     imageOn="/switch_on.bin" imageOff="/switch_off.bin"
                     onCallback="bt_on" offCallback="bt_off" />
        </hg_list_item>
      </hg_list>
    </hg_view>
  </view>
</hml>
```

> HoneyGUI 没有原生 `hg_switch`/`hg_slider`（那是 LVGL-only）。开关用 toggle 按钮（两张图片），
> 数值调节用可拖动的图片或 `hg_arc` 表达。

---

## 媒体播放控制

**用途**：音乐播放界面。**布局**：居中封面 + 进度（用 `hg_rect` 轨道+填充）+ 图片控制按钮。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <project name="Music" resolution="454x454" pixelMode="RGB565" />
  </meta>
  <view>
    <hg_view id="view_player" entry="true" x="0" y="0" width="454" height="454"
             backgroundColor="#101018">
      <hg_image id="img_album" x="127" y="60" width="200" height="200" src="/album_cover.bin" />

      <hg_label id="lbl_song" x="77" y="280" width="300" height="30"
                text="Song Title" fontSize="20" color="#FFFFFF"
                hAlign="CENTER" fontFile="/NotoSansSC-Medium.ttf" />
      <hg_label id="lbl_artist" x="77" y="315" width="300" height="25"
                text="Artist" fontSize="16" color="#CCCCCC"
                hAlign="CENTER" fontFile="/NotoSansSC-Regular.ttf" />

      <!-- 进度条：轨道 + 已播放填充（用 hg_rect 代替 LVGL 的 progressbar） -->
      <hg_rect id="rect_track" x="77" y="360" width="300" height="4"
               borderRadius="2" fillColor="#333333" />
      <hg_rect id="rect_played" x="77" y="360" width="135" height="4"
               borderRadius="2" fillColor="#00FF88" />

      <!-- 控制按钮（图片按钮 + 事件回调） -->
      <hg_button id="btn_prev" x="107" y="400" width="50" height="50"
                 imageOn="/icon_prev_on.bin" imageOff="/icon_prev.bin"
                 clickCallback="on_prev" />
      <hg_button id="btn_play" x="202" y="395" width="60" height="60"
                 imageOn="/icon_play_on.bin" imageOff="/icon_play.bin"
                 clickCallback="on_play_pause" />
      <hg_button id="btn_next" x="297" y="400" width="50" height="50"
                 imageOn="/icon_next_on.bin" imageOff="/icon_next.bin"
                 clickCallback="on_next" />
    </hg_view>
  </view>
</hml>
```

---

## 导航 / 网格菜单

**用途**：主菜单 / 应用启动器。**布局**：用 `hg_view` 容器 + 按坐标摆放的可点击项实现网格
（HoneyGUI 没有 `hg_grid`）。按钮不能嵌子组件，"图标+文字"的项用 `hg_view` 包裹并在其上挂事件。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<hml>
  <meta>
    <project name="Menu" resolution="454x454" pixelMode="RGB565" />
  </meta>
  <view>
    <hg_view id="view_menu" entry="true" x="0" y="0" width="454" height="454"
             backgroundColor="#000000">
      <hg_label id="lbl_title" x="127" y="30" width="200" height="40"
                text="Menu" fontSize="26" color="#FFFFFF"
                hAlign="CENTER" fontFile="/NotoSansSC-Medium.ttf" />

      <!-- 纯图片按钮：直接用 hg_button -->
      <hg_button id="btn_health" x="57" y="100" width="120" height="120"
                 imageOn="/tile_health_on.bin" imageOff="/tile_health.bin">
        <events>
          <event type="onClick">
            <action type="switchView" target="view_health"
                    switchOutStyle="SWITCH_OUT_ANIMATION_FADE"
                    switchInStyle="SWITCH_IN_ANIMATION_ZOOM" />
          </event>
        </events>
      </hg_button>

      <!-- "图标 + 文字"的项：用 hg_view 包裹，事件挂在 view 上 -->
      <hg_view id="tile_music" x="277" y="100" width="120" height="120">
        <events>
          <event type="onClick">
            <action type="switchView" target="view_music" />
          </event>
        </events>
        <hg_image id="ic_music" x="35" y="20" width="50" height="50" src="/icon_music.bin" />
        <hg_label id="lbl_music" x="0" y="80" width="120" height="25"
                  text="Music" fontSize="16" color="#FFFFFF"
                  hAlign="CENTER" fontFile="/NotoSansSC-Regular.ttf" />
      </hg_view>
    </hg_view>
  </view>
</hml>
```

---

## 通知中心

**用途**：通知列表。**布局**：`hg_list` 承载通知卡片（每个 `hg_list_item` 内放图标 + 标题 + 正文）。

```xml
<hg_list id="list_notif" x="0" y="60" width="454" height="380"
         direction="VERTICAL" style="LIST_CLASSIC"
         itemWidth="414" itemHeight="100" space="10" noteNum="4" inertia="true">
  <hg_list_item id="notif_1" x="0" y="0" width="414" height="100">
    <hg_image id="ic_msg" x="15" y="15" width="40" height="40" src="/icon_message.bin" />
    <hg_label id="t_msg" x="65" y="15" width="329" height="25"
              text="New Message" fontSize="16" color="#FFFFFF" fontFile="/NotoSansSC-Medium.ttf" />
    <hg_label id="b_msg" x="65" y="45" width="329" height="35"
              text="You have a new message" fontSize="14" color="#CCCCCC"
              fontFile="/NotoSansSC-Regular.ttf" />
  </hg_list_item>
</hg_list>
```

---

## 活动圆环

**用途**：健身进度环（HoneyGUI 用 `hg_arc`，**不是** `hg_canvas`）。

```xml
<hg_view id="view_activity" entry="true" x="0" y="0" width="454" height="454"
         backgroundColor="#000000">
  <!-- 背景弧（整圈，深色） -->
  <hg_arc id="arc_bg" x="127" y="90" width="200" height="200"
          radius="95" startAngle="0" endAngle="360" strokeWidth="20" color="#3a171d" />
  <!-- 进度弧（从顶部 270° 起，带渐变） -->
  <hg_arc id="arc_steps" x="127" y="90" width="200" height="200"
          radius="95" startAngle="270" endAngle="90" strokeWidth="20"
          useGradient="true" color="#e9402e" />

  <hg_label id="lbl_steps" x="177" y="160" width="100" height="50"
            text="8542" fontSize="36" color="#00FF88"
            hAlign="CENTER" fontFile="/NotoSansSC-Medium.ttf" />
  <hg_label id="lbl_unit" x="177" y="210" width="100" height="25"
            text="steps" fontSize="16" color="#999999"
            hAlign="CENTER" fontFile="/NotoSansSC-Regular.ttf" />
</hg_view>
```

**要点**：`startAngle="270"` 从 12 点方向开始；`endAngle` = 270 + 进度% × 360；多个不同 `radius`
的弧叠成同心环；中心点 = `x + width/2`、`y + height/2`。

---

## 计时器 / 秒表

**用途**：倒计时 / 秒表。**布局**：大号 timer label + 图片控制按钮。`hg_label` 的 timer 模式可用。

```xml
<hg_view id="view_stopwatch" entry="true" x="0" y="0" width="454" height="454"
         backgroundColor="#000000">
  <hg_label id="lbl_title" x="127" y="50" width="200" height="40"
            text="Stopwatch" fontSize="24" color="#FFFFFF"
            hAlign="CENTER" fontFile="/NotoSansSC-Medium.ttf" />

  <!-- 秒表：用 hg_timer_label（默认不自动启动） -->
  <hg_timer_label id="lbl_timer" x="77" y="150" width="300" height="100"
                  isTimerLabel="true" timerType="stopwatch" timerFormat="MM:SS:MS"
                  timerAutoStart="false" fontSize="60" color="#00FF88"
                  hAlign="CENTER" fontFile="/NotoSansSC-Medium.ttf" />

  <hg_button id="btn_start" x="127" y="380" width="80" height="80"
             imageOn="/icon_play_on.bin" imageOff="/icon_play.bin"
             clickCallback="on_start_stop" />
  <hg_button id="btn_reset" x="247" y="380" width="80" height="80"
             imageOn="/icon_reset_on.bin" imageOff="/icon_reset.bin"
             clickCallback="on_reset" />
</hg_view>
```

---

## 可滚动列表（hg_list）

**用途**：垂直滚动的应用 / 选项列表。**关键组件**：`hg_list`（滚动容器）+ `hg_list_item`（条目）。

```xml
<hg_list id="list_menu" x="20" y="60" width="414" height="380"
         direction="VERTICAL" style="LIST_CLASSIC"
         itemWidth="414" itemHeight="100" space="5"
         noteNum="4" autoAlign="true" inertia="true">
  <hg_list_item id="item_0" x="0" y="0" width="414" height="100">
    <hg_image id="ic_0" x="20" y="25" width="50" height="50" src="/app0.bin" />
    <hg_label id="lb_0" x="90" y="35" width="200" height="30"
              text="App 0" fontSize="20" color="#FFFFFF" fontFile="/NotoSansSC-Regular.ttf" />
  </hg_list_item>
  <hg_list_item id="item_1" x="0" y="0" width="414" height="100">
    <hg_image id="ic_1" x="20" y="25" width="50" height="50" src="/app1.bin" />
    <hg_label id="lb_1" x="90" y="35" width="200" height="30"
              text="App 1" fontSize="20" color="#FFFFFF" fontFile="/NotoSansSC-Regular.ttf" />
  </hg_list_item>
</hg_list>
```

**要点**：`itemHeight` 应与条目高度一致；`space` 控制间距；`inertia="true"` 启用惯性滚动；
`style` 还支持 `LIST_CIRCLE`/`LIST_CARD` 等（仅 HoneyGUI；LVGL 只支持 `LIST_CLASSIC`）。

---

## 多页滑动导航

**用途**：左右滑动切换多个整屏页面。**HoneyGUI 方式**：多个**平级** `hg_view`（不嵌套！），
靠 `onSwipe` 事件 + `switchView` 切换。

```xml
<view>
  <hg_view id="view_page1" entry="true" x="0" y="0" width="454" height="454"
           backgroundColor="#FF0066">
    <events>
      <event type="onSwipeLeft">
        <action type="switchView" target="view_page2"
                switchOutStyle="SWITCH_OUT_TO_LEFT_USE_TRANSLATION"
                switchInStyle="SWITCH_IN_FROM_RIGHT_USE_TRANSLATION" />
      </event>
    </events>
    <hg_label id="lbl_p1" x="127" y="207" width="200" height="40"
              text="Page 1" fontSize="28" color="#FFFFFF"
              hAlign="CENTER" fontFile="/NotoSansSC-Medium.ttf" />
  </hg_view>

  <hg_view id="view_page2" x="0" y="0" width="454" height="454" backgroundColor="#00FF88">
    <events>
      <event type="onSwipeRight">
        <action type="switchView" target="view_page1"
                switchOutStyle="SWITCH_OUT_TO_RIGHT_USE_TRANSLATION"
                switchInStyle="SWITCH_IN_FROM_LEFT_USE_TRANSLATION" />
      </event>
    </events>
    <hg_label id="lbl_p2" x="127" y="207" width="200" height="40"
              text="Page 2" fontSize="28" color="#FFFFFF"
              hAlign="CENTER" fontFile="/NotoSansSC-Medium.ttf" />
  </hg_view>
</view>
```

> 不要用一个超宽 `hg_view` 把多个页面 `hg_view` 装进去——那会触发 `hg_view` 嵌套。
> 多页用"平级 view + switchView"实现。

**坐标平铺（前端画布预览）**：多个 view 默认都放在 (0,0) 会在画布上完全堆叠，不便预览。
按滑动方向平铺 x/y 坐标（不影响 C 代码生成——codegen 忽略 hg_view 的 x/y）：

- 左右（onSwipeLeft/Right）：view_n 的 `x = n × round(屏幕宽度 × 1.2)`，y = 0
- 上下（onSwipeUp/Down）：view_n 的 x = 0，`y = n × round(屏幕高度 × 1.2)`

步长 = 屏幕尺寸 × 1.2，即留 20% 间距，在任意分辨率下视觉比例一致。

```xml
<!-- 屏幕 454x454，步长 545 = round(454 × 1.2) -->
<hg_view id="view_page1" entry="true" x="0"    y="0" width="454" height="454" ...>
<hg_view id="view_page2"              x="545"  y="0" width="454" height="454" ...>
<hg_view id="view_page3"              x="1090" y="0" width="454" height="454" ...>
```

---

## 输入表单（仅 LVGL）

> ⚠️ 文本输入 `hg_input`、复选 `hg_checkbox`、单选 `hg_radio`、开关 `hg_switch`、滑块 `hg_slider`
> **仅 LVGL 可用**（HoneyGUI 上是 planned，勿用）。仅当 `project.json` → `targetEngine` 为 `lvgl`
> 时才使用本模式。HoneyGUI 项目请用图片 toggle 按钮 / `hg_arc` / 自定义图片替代。

```xml
<!-- targetEngine = lvgl 时 -->
<hg_view id="view_login" entry="true" x="0" y="0" width="454" height="454"
         backgroundColor="#000000">
  <hg_label id="lbl_user" x="77" y="120" width="300" height="25"
            text="Username" fontSize="14" color="#CCCCCC" fontFile="/NotoSansSC-Regular.ttf" />
  <hg_input id="input_user" x="77" y="150" width="300" height="40" placeholder="Enter username" />

  <hg_checkbox id="chk_remember" x="77" y="220" width="200" height="24"
               text="Remember me" value="false" fontFile="/NotoSansSC-Regular.ttf" />

  <hg_slider id="slider_vol" x="77" y="280" width="300" height="20" min="0" max="100" value="50" />
</hg_view>
```

---

## 模式选择指南

| 用途 | 推荐模式 | 关键组件（HoneyGUI） |
|------|---------|----------------------|
| 多指标速览 | Dashboard | `hg_view` / `hg_window` 卡片 |
| 设置 / 偏好 | 设置列表 | `hg_list` + toggle 按钮 |
| 音视频播放 | 媒体播放控制 | `hg_image` + `hg_rect` 进度 + 图片按钮 |
| 应用启动器 | 导航 / 网格菜单 | `hg_view` + 坐标摆放 |
| 消息 / 提醒 | 通知中心 | `hg_list` |
| 健身追踪 | 活动圆环 | `hg_arc` |
| 计时 | 计时器 / 秒表 | `hg_timer_label` |
| 多页内容 | 多页滑动导航 | 平级 `hg_view` + `switchView` |
| 文本输入 / 表单 | 输入表单 | **仅 LVGL**（`hg_input` 等） |

## 通用布局建议

1. **层次**：用大小 / 颜色 / 位置引导注意力。
2. **间距**：一致的边距（常用 20 / 40px）。
3. **触摸目标**：交互元素 ≥ 44x44px。
4. **可读性**：高对比、正文 ≥16px。
5. **一致性**：相似屏幕复用相同结构。
6. **圆屏**：重要内容居中（边角会被裁切）。
